(* Type syntax is inspected without evaluating author expressions. *)
let rec tagged_payload_problem expression =
  let own = match expression with
    | Ast.List (_,Ast.Symbol (_,"Tagged") :: args) ->
        let discriminator,arms = match args with
          | Ast.Keyword (_,":tag") :: (Ast.Symbol (_,n) | Ast.Keyword (_,n)) :: rest ->
              (if String.starts_with ~prefix:":" n then n else ":" ^ n),rest
          | _ -> ":_tag",args in
        List.find_map (function
          | Ast.List (_,[_;Ast.Map (_,fields)]) -> List.find_map (fun (key,_) -> match key with
              | Ast.Keyword (s,n) when n=discriminator -> Some (s,"Tagged record payload must be disjoint from discriminator " ^ discriminator)
              | Ast.Symbol (s,"&") -> Some (s,"Tagged record payload requires a closed record; open-row disjointness is not supported")
              | _ -> None) fields
          | _ -> None) arms
    | _ -> None in
  match own with Some _ -> own | None ->
    let children = match expression with Ast.Map (_,fields) -> List.map snd fields | Ast.List (_,items) | Ast.Vector (_,items) -> items | _ -> [] in
    List.find_map tagged_payload_problem children

let metadata_keys = [":indexed";":doc";":default";":pattern";":min";":max";":min-length";":max-length";":format";":title";":identifier"]
let split expr = match expr with
  | Ast.List (span,(Ast.Symbol (_,h) as ctor) :: args) ->
      let minimum = if List.mem h ["Map";"Result";"Pick";"Omit";"Merge"] then 2 else if List.mem h ["List";"Option";"Id";"Brand"] then 1 else 0 in
      let rec loop index acc = function
        | (Ast.Keyword (_,n) :: _) as rest when index >= minimum && (not (List.mem h ["Union";"Tagged"]) || List.mem n metadata_keys) ->
            let base=match List.rev acc with [] -> ctor | args -> Ast.List (span,ctor :: args) in base,rest
        | arg :: rest -> loop (index+1) (arg :: acc) rest
        | [] -> expr,[] in
      loop 0 [] args
  | _ -> expr,[]
let rec strip expr =
  let base,_=split expr in match base with
  | Ast.List (s,items) -> Ast.List (s,List.map strip items)
  | Ast.Map (s,fields) -> Ast.Map (s,List.map (fun (k,v)->k,strip v) fields)
  | _ -> base
let rec errors ?(metadata_keys=[":indexed";":doc";":default"]) expr =
  let base,metadata=split expr in
  let rec check_metadata seen = function
    | [] -> []
    | Ast.Keyword (_,n) :: value :: rest ->
        let problems =
          (if List.mem n seen then ["Duplicate type metadata " ^ n] else []) @
          (if not (List.mem n metadata_keys) then ["Unknown type metadata " ^ n]
           else if n=":indexed" && (match value with Ast.Bool _ -> false | _ -> true) then [":indexed metadata expects Bool"]
           else if List.mem n [":doc";":pattern";":title";":identifier"] && (match value with Ast.String _ -> false | _ -> true) then [n ^ " metadata expects String"] else []) in
        problems @ check_metadata (n :: seen) rest
    | _ -> ["Type metadata expects :key value pairs"] in
  check_metadata [] metadata @ (match base with
  | Ast.Symbol (_,n) -> (match List.assoc_opt n ["Str","String";"Num","Number";"Nil","Unit";"Boolean","Bool";"Array","List";"Vector","List";"Optional","Option";"Float","Number";"Uint8Array","Bytes";"string","String";"integer","Int";"number","Number";"boolean","Bool"] with Some canonical -> ["Use " ^ canonical ^ " instead of " ^ n] | None -> [])
  | Ast.String _ | Ast.Int _ | Ast.Float _ | Ast.Bool _ | Ast.Keyword _ -> []
  | Ast.Map (_,fields) ->
      let seen=ref [] in List.concat_map (fun (k,v) ->
        match k with
        | Ast.Symbol (_,"&") -> (match v with Ast.Symbol (_,n) when String.length n > 0 && n.[0] >= 'a' && n.[0] <= 'z' -> [] | _ -> ["An open row requires a lowercase type variable"])
        | Ast.Keyword (_,n) -> let duplicate=List.mem n !seen in seen:=n :: !seen; (if duplicate then ["Duplicate record field " ^ n] else []) @ errors ~metadata_keys v
        | _ -> ["Record type fields require keyword keys"]) fields
  | Ast.List (_,Ast.Symbol (_,h) :: args) ->
      let arity=List.length args in
      errors ~metadata_keys (Ast.Symbol (Ast.expr_span base,h)) @
      (if List.mem h ["List";"Option";"Id"] && arity<>1 then [h ^ " expects one type argument"]
       else if List.mem h ["Map";"Result"] && arity<>2 then [h ^ " expects two type arguments"]
       else if h="Brand" then ["Brand is only allowed as a type declaration body"]
       else if h="Union" && arity=0 then ["Union requires at least one member"]
       else if h="->" && arity<1 then ["Function types require a return type"] else []) @
      (if List.mem h ["Effect";"Stream";"Fiber";"Layer"] then
          (if arity<1 || arity>3 then ["Effect expects a success type and optional error and requirement sets"] else []) @
          (match args with first :: sets -> (if h="Layer" then [] else errors ~metadata_keys first) @ List.concat_map (function Ast.Vector (_,items) when List.for_all (function Ast.Symbol _ -> true | _ -> false) items -> [] | _ -> ["Effect sets require vectors of type symbols"]) (if h="Layer" then args else sets) | [] -> [])
       else if List.mem h ["Pick";"Omit";"Merge"] then
          List.concat_map (errors ~metadata_keys) (match args with left :: right :: _ when h="Merge" -> [left;right] | left :: _ -> [left] | [] -> [])
       else if h="Tagged" then
          let arms=match args with Ast.Keyword (_,":tag") :: _ :: arms -> arms | _ -> args in
          let discriminator=match args with Ast.Keyword (_,":tag") :: (Ast.Symbol (_,n) | Ast.Keyword (_,n)) :: _ -> if String.starts_with ~prefix:":" n then n else ":" ^ n | _ -> ":_tag" in
          (if arms=[] then ["Tagged requires at least one constructor"] else []) @
          List.concat_map (function Ast.Symbol (_,n) when String.length n > 0 && n.[0] >= 'A' && n.[0] <= 'Z' -> [] | Ast.List (_,[Ast.Symbol (_,n);payload]) when String.length n > 0 && n.[0] >= 'A' && n.[0] <= 'Z' ->
            errors ~metadata_keys payload @ (match payload with Ast.Map (_,fields) ->
              (if List.exists (fun (k,_) -> match k with Ast.Keyword (_,n) -> n=discriminator | _ -> false) fields then ["Tagged record payload must be disjoint from discriminator " ^ discriminator] else []) @
              (if List.exists (fun (k,_) -> match k with Ast.Symbol (_,"&") -> true | _ -> false) fields then ["Tagged record payload requires a closed record; open-row disjointness is not supported"] else [])
              | _ -> [])
            | _ -> ["Tagged constructors require capitalized names and at most one payload type"]) arms
       else List.concat_map (errors ~metadata_keys) args)
  | _ -> ["Expected type syntax"])

let unknown_references known expression =
  let primitives=["String";"Int";"Number";"Bool";"Unit";"Json";"Any";"Unknown";"Never";"Symbol";"Keyword";"Type";"Syntax";"RuntimeExpr";"Bytes";"DateTime";"Duration";"List";"Option";"Map";"Record";"Union";"Tagged";"Id";"Brand";"Result";"->";"Effect";"Stream";"Layer";"Fiber";"Ref";"RefCell";"Scope";"OntologyRuntime"] in
  let rec visit expression = match fst (split expression) with
    | Ast.Symbol (_,n) -> if (String.length n > 0 && n.[0] >= 'a' && n.[0] <= 'z') || List.mem n primitives || known n then [] else ["Unknown type " ^ n]
    | Ast.Map (_,fields) -> List.concat_map (fun (_,value)->visit value) fields
    | Ast.List (_,Ast.Symbol (_,"Tagged") :: arms) ->
        let arms=match arms with Ast.Keyword (_,":tag") :: _ :: rest -> rest | _ -> arms in
        List.concat_map (function Ast.List (_,[_;payload]) -> visit payload | _ -> []) arms
    | Ast.List (_,Ast.Symbol (_,(("Pick" | "Omit" | "Merge") as op)) :: args) ->
        List.concat_map visit (match args with left :: right :: _ when op="Merge" -> [left;right] | left :: _ -> [left] | [] -> [])
    | Ast.List (_,items) | Ast.Vector (_,items) -> List.concat_map visit items
    | _ -> [] in visit expression

let rec valid_literal schema value = match strip schema,value with
  | Ast.List (_,Ast.Symbol (_,"Option") :: [_]),Value.VNil -> true
  | Ast.List (_,Ast.Symbol (_,"Option") :: [item]),value -> valid_literal item value
  | Ast.List (_,Ast.Symbol (_,"Union") :: members),value -> List.exists (fun member -> valid_literal member value) members
  | Ast.String (_,expected),Value.VString actual -> expected=actual
  | Ast.Keyword (_,expected),Value.VKeyword actual -> expected=actual
  | Ast.Int (_,expected),Value.VInt actual -> expected=actual
  | Ast.Bool (_,expected),Value.VBool actual -> expected=actual
  | (Ast.String _ | Ast.Keyword _ | Ast.Int _ | Ast.Bool _),_ -> false
  | _ -> true

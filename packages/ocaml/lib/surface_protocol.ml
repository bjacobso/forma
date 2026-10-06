(* Protocol descriptions are derived from canonical types; configuration stays data. *)
open Surface
let string s value = Ast.String (s,value)
let record s fields = Ast.Map (s,List.map (fun (key,value) -> kw s (":" ^ key),value) fields)
let optional t = head t = Some "Option"
let rec protocol_type types t =
  let t=match t with Ast.List (_,Ast.Symbol (_,n) :: _) when List.mem_assoc n types -> Surface_type_alias.resolve (fun n->List.assoc_opt n types) t | _ -> t in
  let descend=protocol_type types in
  let s=Ast.expr_span t in
  let config fields=record s fields in
  match t with
  | Ast.List (_,Ast.Symbol (_,"Option") :: [t]) -> descend t
  | Ast.String _ | Ast.Int _ | Ast.Float _ | Ast.Bool _ -> config ["literal",Ast.Vector (s,[t])]
  | Ast.Keyword (_,n) -> config ["literal",Ast.Vector (s,[string s (String.sub n 1 (String.length n-1))])]
  | Ast.Map (_,fields) ->
      config ["object",Ast.Map (s,List.map (fun (key,t) ->
        let entries=match descend t with Ast.Map (_,entries)->entries | _->[] in
        key,Ast.Map (s,entries @ [kw s ":required",Ast.Bool (s,head (Surface_type_alias.resolve (fun n->List.assoc_opt n types) t)<>Some "Option")])) fields)]
  | Ast.Symbol (_,n) -> let primitive=match n with
      | "String" | "Symbol" | "Keyword" -> Some "string" | "Int" | "Number" -> Some "number" | "Bool" -> Some "boolean" | "Unit" -> Some "null"
      | "Type" | "Syntax" | "RuntimeExpr" | "Any" | "Json" -> Some "unknown" | _ -> None in
      config [((match primitive with Some _ -> "type" | None -> "ref"),string s (Option.value ~default:n primitive))]
  | Ast.List (_,Ast.Symbol (_,"List") :: [t]) -> config ["array",descend t]
  | Ast.List (_,Ast.Symbol (_,("Map" | "Record")) :: args) -> config ["record",descend (List.hd (List.rev args))]
  | Ast.List (_,Ast.Symbol (_,"Union") :: args) -> config ["union",Ast.Vector (s,List.map descend args)]
  | Ast.List (_,Ast.Symbol (_,"Brand") :: args) -> descend (List.hd (List.rev args))
  | _ -> config ["type",string s "unknown"]

let type_extensions types type_name t =
  let s=Ast.expr_span t in
  let named fields=record s (("name",string s type_name)::fields) in
  match t with
  | Ast.Map (_,fields) ->
      let fields=List.map (fun (key,t) ->
        let fields=match protocol_type types t with Ast.Map (_,fields) -> fields | _ -> [] in
        key,Ast.Map (s,fields @ [kw s ":required",Ast.Bool (s,head (Surface_type_alias.resolve (fun n->List.assoc_opt n types) t)<>Some "Option")])) fields in
      "objects","protocol/object",named ["fields",Ast.Map (s,fields)]
  | Ast.List (_,Ast.Symbol (_,"Union") :: members) ->
      let literal=function Ast.String _ | Ast.Int _ | Ast.Float _ | Ast.Bool _ | Ast.Keyword _ -> true | _ -> false in
      if List.for_all literal members then
        let members=List.map (function Ast.Keyword (s,n) -> string s (String.sub n 1 (String.length n-1)) | t -> t) members in
        "enums","protocol/enum",named ["values",Ast.Vector (s,members)]
      else
        let members=List.mapi (fun i member ->
          let reference=match member with Ast.Symbol (_,n) -> Some n | _ -> None in
          let t=match reference with Some n -> Option.value ~default:member (List.assoc_opt n types) | _ -> member in
          let tag=match t with Ast.Map (_,fields) -> List.find_map (fun (key,value) -> if List.mem (name key) [Some ":kind";Some ":_tag"] then match value with Ast.String (_,v) -> Some v | Ast.Keyword (_,v) -> Some (String.sub v 1 (String.length v-1)) | _ -> None else None) fields | _ -> None in
          kw s (":" ^ Option.value ~default:(Option.value ~default:(string_of_int i) reference) tag),protocol_type types member) members in
        "unions","protocol/union",named ["members",Ast.Map (s,members)]
  | _ -> "types","protocol/type",named ["type",protocol_type types t]

let descriptor s name extension value =
  call s "define" [sym s ("__descriptor/" ^ name);record s ["descriptor-name",string s name;"extensions",record s [extension,value]]]

let program exprs =
  let types=List.filter_map (function
    | Ast.List (_,[Ast.Symbol (_,"type");Ast.Symbol (_,n);t]) -> Some (n,t)
    | Ast.List (s,[Ast.Symbol (_,"type");Ast.List (_,Ast.Symbol (_,n)::params);t]) -> Some (n,call s "__type-function" [Ast.Vector (s,params);t])
    | _ -> None) exprs in
  let descriptions=List.filter_map (fun (n,t) -> if head t=Some "__type-function" then None else Some (n,type_extensions types n t)) types in
  List.concat_map (fun e -> match e with
    | Ast.List (s,[Ast.Symbol (_,"type");Ast.Symbol (_,n);_]) ->
        let _,extension,value=List.assoc n descriptions in [e;descriptor s n extension value]
    | Ast.List (s,[Ast.Symbol (_,"define");Ast.Symbol (_,config_name);value]) when config_name <> "protocol" ->
        let value = match value with Ast.List (_,[Ast.Symbol (_,"quote");value]) -> value | value -> value in
        (match value with
         | Ast.Map (_,fields) -> (match List.find_opt (fun (key,_) -> name key = Some ":descriptor-name") fields with
             | Some (_,Ast.String (_,descriptor_name)) -> [e;call s "define" [sym s ("__metadata/" ^ descriptor_name);sym s config_name]]
             | _ -> [e])
         | _ -> [e])
    | Ast.List (s,[Ast.Symbol (_,"define");Ast.Symbol (_,"protocol");Ast.Map (_,fields)]) ->
        let module_name=List.find_map (fun (key,value) -> if name key=Some ":name" then match value with Ast.String (_,n) -> Some n | _ -> None else None) fields in
        (match module_name with None -> [e] | Some n ->
          let derived=List.map (fun category -> kw s (":" ^ category),Ast.Vector (s,List.filter_map (fun (n,(c,_,_)) -> if c=category then Some (string s n) else None) descriptions)) ["types";"objects";"enums";"unions"] in
          [e;descriptor s (n ^ "-protocol-module") "protocol/module" (Ast.Map (s,fields @ derived))])
    | _ -> [e]) exprs

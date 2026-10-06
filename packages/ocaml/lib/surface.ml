exception Invalid_form = Surface_error.Invalid_form
let invalid = Surface_error.invalid

(* Authoring errors raised by surface lowering, as located diagnostics. *)
let diagnostic_of_exn = function
  | Invalid_form (span, message) -> Some (span, "surface/invalid-form", message)
  | Constructor_scope.Ambiguous (span, message) ->
      Some (span, "surface/ambiguous-constructor", message)
  | _ -> None

let namespace_of n =
  let b = Buffer.create (String.length n) in
  String.iteri (fun i c ->
    if i > 0 && c >= 'A' && c <= 'Z' && ((n.[i-1] >= 'a' && n.[i-1] <= 'z') || (n.[i-1] >= '0' && n.[i-1] <= '9')) then Buffer.add_char b '-';
    Buffer.add_char b (Char.lowercase_ascii c)) n;
  Buffer.contents b

(* Unified surface sugar. Keep author spans on every projection. *)
let name = function Ast.Symbol (_, n) | Ast.Keyword (_, n) -> Some n | _ -> None
let head = function Ast.List (_, h :: _) -> name h | _ -> None
let sym span n = if n = "nil" then Ast.Nil span else Ast.Symbol (span, n)
let kw span n = Ast.Keyword (span, n)
let call span n args = Ast.List (span, sym span n :: args)
let is_upper n = String.length n > 0 && n.[0] >= 'A' && n.[0] <= 'Z'
let is_lower n = String.length n > 0 && (n.[0] >= 'a' && n.[0] <= 'z' || n.[0] = '_')
let literal = function Ast.Keyword _ | Ast.String _ | Ast.Int _ | Ast.Float _ | Ast.Bool _ -> true | _ -> false
let wire_literal = function Ast.Keyword (s, n) -> Ast.String (s, String.sub n 1 (String.length n - 1)) | e -> e
let rec fill span count items = if List.length items >= count || items = [] then items else fill span count (items @ [Ast.Vector (span, [])])

let rec type_expr ?(schema=false) ?(field=false) ?brand e =
  let s = Ast.expr_span e in
  match e with
  | Ast.Map (_, pairs) -> call s "Struct" (List.map (fun (k,t) -> call (Ast.expr_span t) "field" [k; type_expr ~schema:true ~field:true t]) pairs)
  | e when literal e -> call s "Literal" [wire_literal e]
  | Ast.List (_, Ast.Symbol (_, ("Literal" | "Enum")) :: _) -> e
  | Ast.List (_, Ast.Symbol (_, "Brand") :: [t]) when Option.is_some brand -> call s "Brand" [Option.get brand; type_expr ~schema:true t]
  | Ast.List (_, Ast.Symbol (_, "Union") :: arms) when List.for_all literal arms -> call s "Literal" (List.map wire_literal arms)
  | Ast.List (_, Ast.Symbol (_, "Tagged") :: arms) ->
      let tag, arms = match arms with (Ast.Keyword (_, ":tag") | Ast.Symbol (_, ":tag")) :: tag :: rest -> (tag,rest) | _ -> (sym s "_tag",arms) in
      let arm e = let a = Ast.expr_span e in
        let ctor, payload = match e with Ast.List (_, c :: p :: _) -> (c,Some p) | _ -> (e,None) in
        let payload = match payload with None -> call a "Struct" [] | Some (Ast.Map _ as p) -> type_expr ~schema:true p | Some p -> let ps = Ast.expr_span p in call ps "Struct" [call ps "field" [sym ps "value"; type_expr ~schema:true p]] in
        Ast.Vector (a,[ctor;payload]) in
      call s "TaggedUnion" (tag :: List.map arm arms)
  | Ast.List (_, Ast.Symbol (_, ("Effect" | "Stream" | "Fiber" | "Layer" as h)) :: args) ->
      call s h (fill s (if h = "Fiber" then 2 else 3) (List.mapi (fun i a -> if i = 0 && h <> "Layer" then type_expr a else a) args))
  | Ast.List (_, Ast.Symbol (_, "->") :: args) -> call s "->" (List.map type_expr args)
  | Ast.List (_, Ast.Symbol (_, ("Struct" | ":fields" as h)) :: fields)
  | Ast.List (_, Ast.Keyword (_, (":fields" as h)) :: fields) ->
      call s h (List.map (function
        | Ast.List (f,Ast.Symbol (_,"field") :: k :: t :: rest) -> call f "field" (k :: type_expr ~schema:true ~field:true t :: rest)
        | Ast.Vector (f,k :: t :: rest) -> Ast.Vector (f,k :: type_expr ~schema:true ~field:true t :: rest)
        | f -> f) fields)
  | Ast.List (_, Ast.Symbol (_, "Map") :: [k;v]) when not (literal v) ->
      call s "Map" [type_expr ~schema v;kw (Ast.expr_span k) ":key";type_expr ~schema k]
  | Ast.List (_, Ast.Symbol (_, h) :: args) ->
      let rec split acc = function
        | (Ast.Keyword _ as k) :: rest -> (List.rev acc,k :: rest)
        | a :: rest -> split (a :: acc) rest | [] -> (List.rev acc,[]) in
      let types, metadata = split [] args in
      let h = if h = "List" then "Array" else if schema && field && h = "Option" then "Optional" else h in
      call s h (List.mapi (fun i a -> if h = "Brand" && i = 0 then a else type_expr ~schema a) types @ metadata)
  | _ -> e

module Names = Set.Make(String)
let rec pattern_names = function
  | Ast.Symbol (_,n) when is_lower n && n <> "_" -> Names.singleton n
  | Ast.List (_,items) | Ast.Vector (_,items) -> List.fold_left (fun acc p -> Names.union acc (pattern_names p)) Names.empty items
  | Ast.Map (_,pairs) -> List.fold_left (fun acc (_,p) -> Names.union acc (pattern_names p)) Names.empty pairs
  | _ -> Names.empty
let module_names exprs = List.fold_left (fun acc -> function Ast.List (_,Ast.Symbol (_,"define") :: Ast.Symbol (_,n) :: _) -> Names.add n acc | _ -> acc) Names.empty exprs
let check_type ?(brand=false) t =
  let t = match t with Ast.List (_,Ast.Symbol (_,"Brand") :: [base]) when brand -> base | t -> t in
  match Type_syntax.errors ~metadata_keys:[":doc";":pattern";":title";":identifier"] t with [] -> () | errors -> raise (Invalid_form (Ast.expr_span t,String.concat "; " errors))
(* A parametric header is (Name a b ...): a capitalised name and distinct
   lowercase type parameters. *)
let check_type_header = function
  | Ast.List (_,Ast.Symbol (_,n) :: params) when is_upper n ->
      ignore (List.fold_left (fun seen p -> match p with
        | Ast.Symbol (_,v) when is_lower v && v <> "_" && not (List.mem v seen) -> v :: seen
        | p -> invalid (Ast.expr_span p) "Type parameters must be distinct lowercase symbols.") [] params)
  | Ast.List (_,h :: _) -> invalid (Ast.expr_span h) "A type name must be a capitalised symbol."
  | h -> invalid (Ast.expr_span h) "A type name must be a capitalised symbol."
let obsolete = ["def","define";"defn","define";"defmacro","macro";"lambda","fn";"let*","let"]
let rec body ?(bound=Names.empty) e =
  let s = Ast.expr_span e in
  let lower = body ~bound in
  match e with
  | Ast.List (_,Ast.Symbol (_,h) :: _) when List.mem_assoc h obsolete -> raise (Invalid_form (s,"Use " ^ List.assoc h obsolete ^ " instead of " ^ h))
  | Ast.Symbol (_, n) when String.contains n '.' ->
      (match String.split_on_char '.' n with x :: fields when Names.mem x bound -> List.fold_left (fun e f -> call s "get" [e; kw s (":" ^ f)]) (sym s x) fields | _ -> e)
  | Ast.Map (s,pairs) -> Ast.Map (s,List.map (fun (k,v) -> (k,lower v)) pairs)
  | Ast.Vector (s,items) -> Ast.Vector (s,List.map lower items)
  | Ast.List (_, [(Ast.Symbol (_,":") | Ast.Keyword (_,":"));value;t]) -> call s ":" [lower value;t]
  | Ast.List (_, Ast.Symbol (_, ("quote" | "quasiquote" | "type" | "__sum-type" | "__schema")) :: _) -> e
  | Ast.List (s, (Ast.Symbol (_, ("fn" | "lambda")) as h) :: (Ast.Vector _ as params) :: bodies) ->
      Ast.List (s,h :: params :: List.map (body ~bound:(Names.union bound (pattern_names params))) bodies)
  | Ast.List (s, (Ast.Symbol (_,"define") as h) :: id :: (Ast.Vector _ as params) :: bodies) when bodies <> [] ->
      Ast.List (s,h :: id :: params :: List.map (body ~bound:(Names.union bound (pattern_names params))) bodies)
  | Ast.List (s, (Ast.Symbol (_, ("let" | "do!")) as h) :: Ast.Vector (bs,bindings) :: bodies) ->
      let rec bindings_ bound = function
        | p :: value :: rest ->
            let value,bound = match p,value with
              | Ast.Keyword (_,":let"),Ast.Vector (vs,pure) -> let pure,bound = bindings_ bound pure in Ast.Vector (vs,pure),bound
              | _ -> body ~bound value,Names.union bound (pattern_names p) in
            let rest,bound = bindings_ bound rest in p :: value :: rest,bound
        | rest -> rest,bound in
      let bindings,bound = bindings_ bound bindings in
      Ast.List (s,h :: Ast.Vector (bs,bindings) :: List.map (body ~bound) bodies)
  | Ast.List (s, (Ast.Symbol (_, ("match" | "catch")) as h) :: value :: arms) ->
      let rec arms_ = function p :: rhs :: rest -> p :: body ~bound:(Names.union bound (pattern_names p)) rhs :: arms_ rest | rest -> rest in
      Ast.List (s,h :: lower value :: arms_ arms)
  | Ast.List (s,items) -> Ast.List (s,List.map lower items)
  | _ -> e

let core e =
  let s = Ast.expr_span e in
  match e with
  | Ast.List (_,[(Ast.Symbol (_,":") | Ast.Keyword (_,":"));_;t]) -> check_type t; body e
  | Ast.List (_, Ast.Symbol (_,("class" | "error" as kind)) :: (Ast.Symbol _ as n) :: fields) ->
      let fields,options = match fields with (Ast.Map _ as fields) :: options -> fields,options | options -> Ast.Map (s,[]),options in
      (match options with [] -> () | [Ast.Keyword (_,":status"); Ast.Int (_,status)] when kind="error" && status>=400 && status<=599 -> () | _ -> invalid s "error supports :status with an HTTP error status (400–599)");
      check_type fields;
      call s "__record-type" [n;fields;sym s kind]
  | Ast.List (_, [Ast.Symbol (_,"type"); n; (Ast.List (_, Ast.Symbol (_,"Tagged") :: arms) as tagged)]) ->
      check_type tagged;
      let n = match n with Ast.Symbol _ -> Ast.List (Ast.expr_span n,[n]) | _ -> check_type_header n; n in
      let tag,arms = match arms with Ast.Keyword (_,":tag") :: t :: rest -> t,rest | _ -> sym s "_tag",arms in
      call s "__sum-type" (n :: List.map (function Ast.Symbol _ as a -> Ast.List (Ast.expr_span a,[a]) | a -> a) arms @ [Ast.List (s,[kw s ":tag";tag])])
  | Ast.List (_, [Ast.Symbol (_,"type"); (Ast.List _ as n); t]) -> check_type_header n; check_type t; call s "__type-alias" [n;t]
  | Ast.List (_, [Ast.Symbol (_,"type"); n; t]) -> check_type ~brand:true t; call s "__sum-type" [n;t]
  | Ast.List (_, Ast.Symbol (_,"define") :: n :: (Ast.Vector _ as p) :: bodies) when bodies <> [] -> call s "define" [n;call s "fn" (p :: List.map body bodies)]
  | Ast.List (_, Ast.Symbol (_,"macro") :: Ast.List (p,h :: args) :: bodies) ->
      let args = match List.rev args with Ast.Symbol (_,"...") :: n :: rest -> List.rev rest @ [sym p "&";n] | _ -> args in
      call s "__macro" (h :: Ast.Vector (p,args) :: bodies)
  | Ast.List (_, Ast.Symbol (_,"typeclass") :: header :: members) ->
      let rec convert = function
        | Ast.Keyword (_,":extends") :: xs :: rest -> xs :: convert rest
        | Ast.List (s, (Ast.Symbol (_,":") | Ast.Keyword (_,":")) :: args) :: rest -> Ast.List (s,args) :: convert rest
        | m :: rest -> m :: convert rest | [] -> [] in
      call s "__typeclass" (header :: convert members)
  | Ast.List (s,Ast.Symbol (_,"instance") :: header :: members) ->
      Ast.List (s,sym s "instance" :: header :: List.map (function
        | Ast.List (ms,Ast.Symbol (_,"define") :: id :: (Ast.Vector _ as params) :: bodies) when bodies<>[] ->
            call ms "define" [id;call ms "fn" (params :: List.map body bodies)]
        | member -> body member) members)
  | _ -> body e
(* Validate authored grammar before any compiler projection introduces its
   private type constructors or declarations. Quoted syntax remains data. *)
let rec validate_syntax e =
  match e with
  | Ast.List (_,Ast.Symbol (_,h) :: _) when List.mem h ["quote";"quasiquote"] || String.starts_with ~prefix:"__" h -> ()
  | Ast.List (_,Ast.Symbol (_,h) :: _) when List.mem_assoc h obsolete -> raise (Invalid_form (Ast.expr_span e,"Use " ^ List.assoc h obsolete ^ " instead of " ^ h))
  | Ast.List (_,Ast.Symbol (_,h) :: _) when List.mem h ["type";"class";"error"] -> ignore (core e)
  | Ast.List (_,[(Ast.Symbol (_,":") | Ast.Keyword (_,":"));value;t]) -> check_type t; validate_syntax value
  | Ast.List (_,items) | Ast.Vector (_,items) -> List.iter validate_syntax items
  | Ast.Map (_,fields) -> List.iter (fun (_,value)->validate_syntax value) fields
  | _ -> ()
let validate_program = List.iter validate_syntax

let rec binding_patterns e =
  let s = Ast.expr_span e in
  let lower = binding_patterns in
  let plain = function Ast.Symbol (_,n) when (is_lower n && n <> "nil") || n = "&" -> true | _ -> false in
  match e with
  | Ast.List (_,Ast.Symbol (_,("quote" | "quasiquote" | "__sum-type" | "type" | ":")) :: _) -> e
  | Ast.List (s,(Ast.Symbol (_,("fn" | "lambda")) as h) :: Ast.Vector (ps,params) :: bodies) when bodies <> [] ->
      let patterns = ref [] in
      let params = List.mapi (fun i p -> if plain p then p else let temporary = sym (Ast.expr_span p) ("__argument_" ^ string_of_int (Ast.expr_span p).Ast.start_offset ^ "_" ^ string_of_int i) in patterns := !patterns @ [p,temporary]; temporary) params in
      let value = match bodies with [value] -> lower value | _ -> call s "do" (List.map lower bodies) in
      let value = List.fold_right (fun (p,v) body -> call (Ast.expr_span p) "match" [v;p;body]) !patterns value in
      Ast.List (s,[h;Ast.Vector (ps,params);value])
  | Ast.List (_,Ast.Symbol (_,"let") :: Ast.Vector (_,bindings) :: bodies) when List.exists (fun p -> not (plain p)) (List.filteri (fun i _ -> i mod 2 = 0) bindings) ->
      let rec wrap = function
        | p :: value :: rest -> let rest = wrap rest in if plain p then call (Ast.expr_span p) "let" [Ast.Vector (s,[p;lower value]);rest] else call (Ast.expr_span p) "match" [lower value;p;rest]
        | [] -> (match bodies with [value] -> lower value | _ -> call s "do" (List.map lower bodies))
        | _ -> invalid s "let expects pattern/value pairs" in wrap bindings
  | Ast.List (s,items) -> Ast.List (s,List.map lower items)
  | Ast.Vector (s,items) -> Ast.Vector (s,List.map lower items)
  | Ast.Map (s,pairs) -> Ast.Map (s,List.map (fun (k,v)->k,lower v) pairs)
  | _ -> e
let coerce_program ?(externals=[]) exprs =
  let aliases=List.filter_map (function
    | Ast.List (_, [Ast.Symbol (_,"__record-type");Ast.Symbol (_,n);t;_])
    | Ast.List (_, [Ast.Symbol (_,"__sum-type");Ast.Symbol (_,n);t]) -> Some (n,t)
    | Ast.List (s,[Ast.Symbol (_,"__type-alias");Ast.List (_,Ast.Symbol (_,n) :: params);t]) -> Some (n,call s "__type-function" [Ast.Vector (s,params);t])
    | _ -> None) exprs in
  let signatures=List.filter_map (function Ast.List (_, [(Ast.Symbol (_,":") | Ast.Keyword (_,":"));Ast.Symbol (_,n);t]) -> Some (n,t) | _ -> None) exprs @ externals in
  let constructors=List.concat_map (function
    | Ast.List (_, [Ast.Symbol (_,"__record-type");Ast.Symbol (_,n);fields;_]) -> [n,[fields]]
    | Ast.List (_,Ast.Symbol (_,"__sum-type") :: Ast.List (_,Ast.Symbol (_,owner) :: _) :: arms) -> List.concat_map (function Ast.List (_,Ast.Symbol (_,n) :: fields) -> [n,fields;(owner ^ "." ^ n),fields] | _ -> []) arms | _ -> []) exprs in
  let resolve seen t = Surface_type_alias.resolve ~seen (fun n -> List.assoc_opt n aliases) t in
  let result_type = function Ast.List (_,Ast.Symbol (_,"->") :: types) -> List.nth_opt types (List.length types-1) | _ -> None in
  let definitions=List.filter_map (function Ast.List (_, [Ast.Symbol (_,"define");Ast.Symbol (_,n);value]) -> Some (n,value) | _ -> None) exprs in
  let rec expression_type ?(seen=[]) locals e =
    let infer = expression_type ~seen locals in
    let option () = Some (call (Ast.expr_span e) "Option" [sym (Ast.expr_span e) "Unknown"]) in
    match (match head e with Some n -> Some n | None -> name e) with
    | Some ("Some" | "None" | "Option.Some" | "Option.None") -> option ()
    | _ -> match e with
      | Ast.Symbol (_,n) -> List.assoc_opt n locals
      | Ast.List (_, [Ast.Symbol (_,"get");owner;key]) -> Option.bind (infer owner) (fun t -> match resolve [] t with Ast.Map (_,fields) -> List.find_map (fun (k,t) -> if name k=name key then Some t else None) fields | _ -> None)
      | Ast.List (_,[(Ast.Symbol (_,":") | Ast.Keyword (_,":"));_;t]) -> Some t
      | Ast.List (_,Ast.Symbol (_,"if") :: _ :: branches)
      | Ast.List (_,Ast.Symbol (_,"match") :: _ :: branches) ->
          let branches=if head e=Some "match" then List.filteri (fun i _ -> i mod 2=1) branches else branches in
          let types=List.map infer branches in
          if types<>[] && List.for_all (function Some t -> head (resolve [] t)=Some "Option" | _ -> false) types then List.hd types else None
      | Ast.List (_,Ast.Symbol (_,"do") :: bodies) -> Option.bind (List.nth_opt bodies (List.length bodies-1)) infer
      | Ast.List (_,Ast.Symbol (_,"let") :: Ast.Vector (_,values) :: bodies) ->
          let rec bind locals = function p :: v :: rest ->
              let locals=match name p,expression_type ~seen locals v with Some n,Some t -> (n,t)::locals | _ -> locals in bind locals rest
            | _ -> locals in
          Option.bind (List.nth_opt bodies (List.length bodies-1)) (expression_type ~seen (bind locals values))
      | Ast.List (_,Ast.Symbol (_,n) :: args) -> (match Option.bind (List.assoc_opt n locals) result_type with
          | Some _ as t -> t
          | None when List.mem_assoc n aliases && List.mem_assoc n constructors -> Some (sym (Ast.expr_span e) n)
          | None when not (List.mem n seen) -> Option.bind (List.assoc_opt n definitions) (fun body ->
              match body with
              | Ast.List (_,Ast.Symbol (_,"fn") :: Ast.Vector (_,params) :: bodies) ->
                  let locals=List.fold_left (fun locals (p,arg) -> match name p,infer arg with Some n,Some t -> (n,t)::locals | _ -> locals) locals
                    (List.filter_map (fun (i,p) -> Option.map (fun arg -> p,arg) (List.nth_opt args i)) (List.mapi (fun i p -> i,p) params)) in
                  Option.bind (List.nth_opt bodies (List.length bodies-1)) (expression_type ~seen:(n::seen) locals)
              | _ -> expression_type ~seen:(n::seen) locals body)
          | _ -> None)
      | _ -> None in
  let rec visit ?(locals=signatures) ?expected e =
    let expected=Option.map (resolve []) expected in
    let child t e=visit ~locals ?expected:t e in
    match e with
    | e when (match expected with Some t -> head t=Some "Option" | _ -> false)
        && not (List.mem (Option.value ~default:"" (head e)) ["if";"match";"let";"do"])
        && (match expression_type locals e with Some t -> head (resolve [] t)<>Some "Option" | None -> true) ->
          let item=match expected with Some (Ast.List (_,[_;item])) -> item | _ -> assert false in
          call (Ast.expr_span e) "Option.Some" [visit ~locals ~expected:item e]
    | e when (match expected with Some t -> head t=Some "Map" | None -> false) && (match e with Ast.Map _ -> false | _ -> head e<>Some "__dictionary" && not (List.mem (Option.value ~default:"" (head e)) ["if";"let";"do";"match";":"])) ->
        call (Ast.expr_span e) "__dictionary" [visit ~locals e]
    | Ast.Map (s,pairs) ->
        let declared=match expected with Some (Ast.Map (_,fields)) -> fields | _ -> [] in
        let label k=match k with Ast.String (_,s) -> Some (Value.string_json s) | _ -> name k in
        let pairs=List.map (fun (k,v) -> let t=Option.map (fun (_,t)->resolve [] t) (List.find_opt (fun (key,_)->label key=label k) declared) in
          let value=child t v in k,value) pairs in
        let absent=List.filter_map (fun (k,t) -> if head (resolve [] t)=Some "Option" && not (List.exists (fun (key,_)->label key=label k) pairs) then Some (k,sym s "Option.None") else None) declared in
        let record=Ast.Map (s,pairs @ absent) in (match expected with Some t when head t=Some "Map" -> call s "__dictionary" [record] | _ -> record)
    | Ast.Vector (s,items) -> let item=match expected with Some (Ast.List (_, [Ast.Symbol (_,"List");t])) -> Some t | _ -> None in Ast.Vector (s,List.map (child item) items)
    | Ast.List (_,Ast.Symbol (_,("quote" | "quasiquote" | "__sum-type" | "__type-alias" | "__record-type" | "__schema")) :: _) -> e
    | Ast.List (_,[(Ast.Symbol (_,":") | Ast.Keyword (_,":"));Ast.Symbol (_,n);_]) when List.mem_assoc n signatures -> e
    | Ast.List (s,[(Ast.Symbol (_,":") | Ast.Keyword (_,":")) as h;value;t]) -> Ast.List (s,[h;visit ~locals ~expected:t value;t])
    | Ast.List (s,[(Ast.Symbol (_,"define") as h);(Ast.Symbol (_,n) as id);value]) -> Ast.List (s,[h;id;child (List.assoc_opt n signatures) value])
    | Ast.List (s,(Ast.Symbol (_,"fn") as h) :: params :: bodies) when (match expected with Some t -> head t=Some "->" | _ -> false) ->
        let ret=match expected with Some (Ast.List (_,items)) -> List.nth_opt items (List.length items-1) | _ -> None in
        let locals = match params,expected with Ast.Vector (_,params),Some (Ast.List (_, _ :: types)) -> List.fold_left (fun locals (p,t) -> match name p with Some n -> (n,t) :: locals | _ -> locals) locals (List.mapi (fun i p -> p,List.nth_opt types i) params |> List.filter_map (function p,Some t -> Some (p,t) | _ -> None)) | _ -> locals in
        Ast.List (s,h :: params :: List.mapi (fun i e->visit ~locals ?expected:(if i=List.length bodies-1 then ret else None) e) bodies)
    | Ast.List (s,(Ast.Symbol (_,"let") as h) :: Ast.Vector (bs,bindings) :: bodies) ->
        let rec bind locals values = function
          | p :: value :: rest ->
              let t=expression_type locals value in
              let value=visit ~locals value in
              let locals=match name p,t with Some n,Some t -> (n,t) :: locals | _ -> locals in
              bind locals (values @ [p;value]) rest
          | _ -> locals,values in
        let locals,bindings=bind locals [] bindings in
        Ast.List (s,h :: Ast.Vector (bs,bindings) :: List.mapi (fun i e -> visit ~locals ?expected:(if i=List.length bodies-1 then expected else None) e) bodies)
    | Ast.List (s,(Ast.Symbol (_,"match") as h) :: value :: arms) ->
        let rec cases = function pattern :: result :: rest -> pattern :: visit ~locals ?expected result :: cases rest | rest -> rest in
        Ast.List (s,h :: visit ~locals value :: cases arms)
    | Ast.List (s,(Ast.Symbol (_,"if") as h) :: condition :: branches) -> Ast.List (s,h :: visit ~locals condition :: List.map (child expected) branches)
    | Ast.List (s,(Ast.Symbol (_,("do" | "let")) as h) :: args) -> Ast.List (s,h :: List.mapi (fun i e -> child (if i=List.length args-1 then expected else None) e) args)
    | Ast.List (s,(Ast.Symbol (_,n) as h) :: args) ->
        let params=match List.assoc_opt n constructors with Some p -> p | None -> (match List.assoc_opt n locals with Some (Ast.List (_,Ast.Symbol (_,"->") :: types)) -> List.filteri (fun i _ -> i<List.length types-1) types | _ -> []) in
        Ast.List (s,h :: List.mapi (fun i e -> child (List.nth_opt params i) e) args)
    | Ast.List (s,items) -> Ast.List (s,List.map (visit ~locals) items)
    | _ -> e in
  List.map visit exprs

let core_program exprs = let bound = module_names exprs in coerce_program (Constructor_scope.program (List.map (fun e -> binding_patterns (core (body ~bound e))) exprs))

let effect_result = function
  | Ast.List (_,Ast.Symbol (_,"Effect") :: _) -> true
  | Ast.List (_,Ast.Symbol (_,"->") :: args) -> (match List.rev args with result :: _ -> head result = Some "Effect" | [] -> false)
  | _ -> false

(* Constructor values use the same canonical record inside ascriptions. *)
let rec effect_body ?(ascribed=false) constructors e =
  let s = Ast.expr_span e in
  let lower = effect_body ~ascribed constructors in
  let alias = function "__map-get" -> "get" | "Some" | "Option.Some" -> "some" | "None" | "Option.None" -> "none" | "Ok" | "Result.Ok" -> "success" | "Err" | "Result.Err" -> "failure" | n -> n in
  match e with
  | Ast.List (_,[(Ast.Symbol (_,":") | Ast.Keyword (_,":"));value;t]) -> call s ":" [effect_body ~ascribed:true constructors value;type_expr t]
  | Ast.List (_,Ast.Symbol (_,("quote" | "quasiquote" | ":")) :: _) -> e
  | Ast.Symbol (_,n) when List.mem_assoc n constructors && snd (List.assoc n constructors) = None -> let tag,_ = List.assoc n constructors in Ast.Map (s,[kw s (":" ^ tag),Ast.String (s,List.hd (List.rev (String.split_on_char '.' n)))])
  | Ast.List (_,Ast.Symbol (_,n) :: args) when List.mem_assoc n constructors ->
      let tag,_ = List.assoc n constructors in
      let fields = match args with [Ast.Map (_,pairs)] -> List.map (fun (k,v)->k,lower v) pairs | [v] -> [kw (Ast.expr_span v) ":value",lower v] | [] -> [] | _ -> [] in
      Ast.Map (s,(kw s (":" ^ tag),Ast.String (s,List.hd (List.rev (String.split_on_char '.' n)))) :: fields)
  | Ast.List (s,(Ast.Symbol (_, ("match" | "catch")) as h) :: value :: arms) ->
      let rec arms_ = function
        | p :: rhs :: rest ->
            let p,rhs = match p with
              | Ast.List (ps,Ast.Symbol (_,n) :: [Ast.Map (_,pairs)]) when List.mem_assoc n constructors ->
                  let temp = sym ps ("__pattern_" ^ string_of_int ps.Ast.start_offset) in
                  let bindings = List.concat_map (fun (k,v)->[v;call (Ast.expr_span v) "get" [temp;k]]) pairs in
                  Ast.List (ps,[sym ps (List.hd (List.rev (String.split_on_char '.' n)));temp]),call (Ast.expr_span rhs) "let" [Ast.Vector (ps,bindings);lower rhs]
              | Ast.List (ps,Ast.Symbol (_,n) :: [binder]) when List.mem_assoc n constructors && (match snd (List.assoc n constructors) with Some (Ast.Map _) -> false | _ -> true) ->
                  let temp=sym ps ("__pattern_" ^ string_of_int ps.Ast.start_offset) in
                  let binding=Ast.Vector (ps,[binder;call ps "get" [temp;kw ps ":value"]]) in
                  Ast.List (ps,[sym ps (List.hd (List.rev (String.split_on_char '.' n)));temp]),call (Ast.expr_span rhs) "let" [binding;lower rhs]
              | Ast.List (ps,Ast.Symbol (_,n) :: args) when List.mem_assoc n constructors ->
                  Ast.List (ps,sym ps (List.hd (List.rev (String.split_on_char '.' n))) :: args),lower rhs
              | Ast.Symbol (ps,n) when List.mem_assoc n constructors -> sym ps (List.hd (List.rev (String.split_on_char '.' n))),lower rhs
              | Ast.Symbol (ps,n) when is_lower n && n <> "_" && not (List.mem n ["some";"none";"success";"failure"]) && not (ascribed && name h = Some "match") -> call ps "_" [p],lower rhs
              | _ -> p,lower rhs in
            p :: rhs :: arms_ rest
        | rest -> rest in
      Ast.List (s,h :: lower value :: arms_ arms)
  | Ast.Symbol (s,n) -> Ast.Symbol (s,alias n)
  | Ast.List (s,items) -> Ast.List (s,List.map lower items)
  | Ast.Vector (s,items) -> Ast.Vector (s,List.map lower items)
  | Ast.Map (s,pairs) -> Ast.Map (s,List.map (fun (k,v)->k,lower v) pairs)
  | _ -> e

let effect_program exprs =
  let internal = List.exists (fun e -> List.mem (Option.value ~default:"" (head e)) ["__schema";"__service";"__operation";"__layer"]) exprs in
  let normalized=if internal then exprs else Constructor_scope.program (List.map (fun e -> binding_patterns (core (body ~bound:(module_names exprs) e))) exprs) in
  let exprs=List.map2 (fun original normalized -> if head original=Some "define" then normalized else original) exprs normalized in
  let constructors = List.concat_map (function
    | Ast.List (_, [Ast.Symbol (_,"type");owner;Ast.List (_,Ast.Symbol (_,"Tagged") :: arms)]) ->
      let tag,arms = match arms with Ast.Keyword (_,":tag") :: t :: rest -> Option.value ~default:"_tag" (name t),rest | _ -> "_tag",arms in
      let owner=Option.value ~default:"" (match name owner with Some _ as n -> n | None -> head owner) in
      List.filter_map (function Ast.Symbol (_,n) -> Some (owner ^ "." ^ n,(tag,None)) | Ast.List (_,Ast.Symbol (_,n) :: [payload]) -> Some (owner ^ "." ^ n,(tag,Some payload)) | _ -> None) arms
    | _ -> []) exprs in
  let lower_body e = effect_body constructors (body ~bound:(module_names exprs) e) in
  let signatures = List.filter_map (function Ast.List (_, [(Ast.Symbol (_,":") | Ast.Keyword (_,":"));Ast.Symbol (_,n);t]) -> Some (n,t) | _ -> None) exprs in
  let bound = module_names exprs in
  let convert e = let e = body ~bound e in let s = Ast.expr_span e in match e with
    | Ast.List (_, Ast.Symbol (_, "__schema") :: _) -> e
    | Ast.List (_, [Ast.Symbol (_, "type");n;t]) -> call s "__schema" [n; type_expr ~schema:true ~brand:n t]
    | Ast.List (_, Ast.Symbol (_, ("__error" | "__class")) :: _ :: _ :: _ :: _) -> e
    | Ast.List (_, Ast.Symbol (_, ("error" | "class" | "__error" | "__class" as h)) :: n :: args) ->
        let t,options = match args with (Ast.Map _ as t) :: options -> type_expr ~schema:true t,options | (Ast.List (_,(Ast.Symbol (_,("Struct" | ":fields")) | Ast.Keyword (_,":fields")) :: _) as t) :: options -> type_expr ~schema:true t,options | options -> call s "Struct" [],options in
        let fields = match t with Ast.List (s,Ast.Symbol (_,"Struct") :: fields) -> Ast.List (s,kw s ":fields" :: fields) | _ -> t in
        call s (if h = "error" || h = "__error" then "__error" else "__class") (n :: fields :: options)
    | Ast.List (_, Ast.Symbol (_,"service") :: n :: members) ->
        let method_ = function
          | Ast.List (m,[(Ast.Symbol (_,":") | Ast.Keyword (_,":"));n;t]) ->
              let t = type_expr t in
              let params,result = match t with Ast.List (_,Ast.Symbol (_,"->") :: args) -> (match List.rev args with result :: params -> (List.rev params,result) | [] -> ([],t)) | _ -> ([],t) in
              let params = List.concat (List.mapi (fun i t -> [sym (Ast.expr_span t) ("arg" ^ string_of_int i);t]) params) in
              Ast.List (m,[n;Ast.Vector (m,params);result] @ (if head t = Some "->" then [] else [kw m ":value"]))
          | m -> invalid (Ast.expr_span m) "service members require (: name Type)" in
        call s "__service" [n;Ast.List (s,kw s ":methods" :: List.map method_ members)]
    | Ast.List (_, [(Ast.Symbol (_,":") | Ast.Keyword (_,":"));n;t]) -> call s ":" [n;type_expr t]
    | Ast.List (_, Ast.Symbol (_,"define") :: (Ast.Symbol (_,n) as id) :: args) when (match List.assoc_opt n signatures with Some t -> effect_result t | None -> false) ->
        let params,bodies = match args with (Ast.Vector _ as p) :: bodies when bodies <> [] -> (p,bodies) | [Ast.List (_, Ast.Symbol (_,"fn") :: p :: bodies)] -> (p,bodies) | bodies -> (Ast.Vector (s,[]),bodies) in
        call s "__operation" (id :: params :: List.map (fun e -> effect_body constructors (body ~bound:(Names.union bound (pattern_names params)) e)) bodies)
    | Ast.List (_,Ast.Symbol (_,"define") :: n :: (Ast.Vector _ as params) :: bodies) when bodies <> [] ->
        call s "define" [n;call s "fn" (params :: List.map (fun e -> effect_body constructors (body ~bound:(Names.union bound (pattern_names params)) e)) bodies)]
    | Ast.List (_,Ast.Symbol (_,"layer") :: n :: args) ->
        (match args with [value] -> call s "__layer" [n;lower_body value] | _ ->
          (* Only the defines the provided service declares are methods; the
             other defines are private helpers bound around every method. *)
          let definition_name = function Ast.List (_,Ast.Symbol (_,"define") :: id :: _) -> name id | _ -> None in
          let definitions = List.filter (fun a -> definition_name a <> None) args in
          let rec provided = function (Ast.Keyword (_,":provides") | Ast.Symbol (_,":provides")) :: service :: _ -> name service | _ :: rest -> provided rest | [] -> None in
          let exported = Option.bind (provided args) (fun service -> List.find_map (function
            | Ast.List (_,Ast.Symbol (_,"service") :: Ast.Symbol (_,m) :: members) when m = service ->
                Some (List.filter_map (function Ast.List (_,_ :: member :: _) -> name member | _ -> None) members)
            | _ -> None) exprs) in
          let helpers = match exported with
            | None -> []
            | Some exported -> List.filter (fun d -> match definition_name d with Some n -> not (List.mem n exported) | None -> false) definitions in
          let split_definition d = match d with
            | Ast.List (_,_ :: id :: (Ast.Vector _ as params) :: bodies) when bodies <> [] -> id,Some params,bodies
            | Ast.List (_,_ :: id :: bodies) -> id,None,bodies
            | _ -> d,None,[] in
          let helper_bindings = List.concat_map (fun d -> match split_definition d with
            | id,Some params,bodies -> [id;Ast.List (Ast.expr_span d,sym (Ast.expr_span d) "fn" :: params :: bodies)]
            | id,None,value :: _ -> [id;value]
            | id,None,[] -> [id;Ast.Nil (Ast.expr_span d)]) helpers in
          let helper_names = List.fold_left (fun acc d -> match definition_name d with Some n -> Names.add n acc | None -> acc) Names.empty helpers in
          let rec setup_names = function
            | Ast.Keyword (_, ":setup") :: (Ast.Vector _ as bindings) :: rest -> Names.union (pattern_names bindings) (setup_names rest)
            | _ :: rest -> setup_names rest
            | [] -> Names.empty in
          let methods = List.filter_map (fun d ->
            if List.memq d helpers then None else
            let ms = Ast.expr_span d in
            let id,params,bodies = split_definition d in
            let params = Option.value ~default:(Ast.Vector (ms,[])) params in
            let bodies = if helper_bindings = [] then bodies else [call ms "let" [Ast.Vector (ms,helper_bindings);call ms "do" bodies]] in
            let scope = Names.union (setup_names args) (Names.union bound (Names.union helper_names (pattern_names params))) in
            Some (Ast.List (ms,id :: params :: List.map (fun e -> effect_body constructors (body ~bound:scope e)) bodies))) definitions in
          let rec sections = function
            | (Ast.Keyword _ as key) :: value :: rest -> call (Ast.expr_span key) (Option.get (name key)) [lower_body value] :: sections rest
            | d :: rest when definition_name d <> None -> sections rest
            | e :: rest -> lower_body e :: sections rest | [] -> [] in
          call s "__layer" (n :: sections args @ [call s ":methods" methods]))
    | _ -> lower_body e in
  List.map convert exprs

let rec pure_bindings e =
  let s = Ast.expr_span e in
  match e with
  | Ast.List (_,Ast.Symbol (_,"do!") :: Ast.Vector (bs,bindings) :: bodies) ->
      let rec split before = function
        | (Ast.Keyword (_,":let") | Ast.Symbol (_,":let")) :: (Ast.Vector _ as pure) :: rest ->
            let body = if rest = [] then (match bodies with [value] -> pure_bindings value | _ -> call s "do" (List.map pure_bindings bodies)) else pure_bindings (call s "do!" (Ast.Vector (bs,rest) :: bodies)) in
            let body = call s "let" [pure;body] in
            if before = [] then body else call s "do!" [Ast.Vector (bs,List.rev before);body]
        | p :: value :: rest -> split (pure_bindings value :: p :: before) rest
        | _ -> call s "do!" (Ast.Vector (bs,bindings) :: List.map pure_bindings bodies) in split [] bindings
  | Ast.List (_,Ast.Symbol (_,("quote" | "quasiquote" | ":" | "__sum-type")) :: _) -> e
  | Ast.List (s,items) -> Ast.List (s,List.map pure_bindings items)
  | Ast.Map (s,pairs) -> Ast.Map (s,List.map (fun (k,v)->k,pure_bindings v) pairs)
  | Ast.Vector (s,items) -> Ast.Vector (s,List.map pure_bindings items)
  | _ -> e
let type_program exprs =
  let exprs = Surface_action.program exprs in
  let signatures = List.filter_map (function Ast.List (_, [(Ast.Symbol (_,":") | Ast.Keyword (_,":"));Ast.Symbol (_,n);t]) -> Some (n,t) | _ -> None) exprs in
  let effect_surface = List.exists (fun e -> List.mem (Option.value ~default:"" (head e)) ["service";"layer";"__operation";"__service"] || match e with Ast.List (_,[(Ast.Symbol (_,":") | Ast.Keyword (_,":"));_;t]) -> effect_result t | _ -> false) exprs in
  (if effect_surface then List.map2 (fun original normalized -> if List.mem (Option.value ~default:"" (head original)) ["class";"error"] then original else normalized) exprs (effect_program exprs) else exprs) |> core_program |> List.map pure_bindings |> List.map (function
    | Ast.List (s,Ast.Symbol (_,"__operation") :: (Ast.Symbol (_,n) as id) :: Ast.Vector (_,[]) :: bodies) when (match List.assoc_opt n signatures with Some t -> head t = Some "Effect" | _ -> false) ->
      call s "define" [id;(match bodies with [value] -> value | _ -> call s "do" bodies)]
    | e -> e)

let runtime_constructors = function
  | Ast.List (s,[Ast.Symbol (_,"__type-alias");Ast.List (_,Ast.Symbol (_,n) :: params);t]) ->
      Some [call s "define" [sym s ("__type/" ^ n);call s "quote" [call s "__type-function" [Ast.Vector (s,params);t]]]]
  | Ast.List (s,[Ast.Symbol (_,"__record-type");(Ast.Symbol (_,n) as id);fields;Ast.Symbol (_,kind)]) ->
      let value=sym s "__record_value" in
      let result=if kind="error" then call s "assoc" [value;kw s ":_tag";Ast.String (s,n)] else value in
      let keys = match fields with Ast.Map (_, pairs) -> List.filter_map (fun (key,t) -> if head t=Some "Option" then None else Some key) pairs | _ -> [] in
      let spec=Ast.Map (s,[kw s ":discriminator",Ast.String (s,"_tag");kw s ":record",Ast.Bool (s,true);kw s ":class",Ast.Bool (s,kind="class");kw s ":arity",Ast.Int (s,1);kw s ":fields",Ast.Vector (s,keys)]) in
      Some [call s "define" [sym s ("__type/" ^ n);call s "quote" [fields]];call s "define" [sym s ("__type-kind/" ^ n);kw s (":" ^ kind)];call s "define" [sym s ("__constructor/" ^ n);spec];call s "define" [id;call s "fn" [Ast.Vector (s,[value]);result]]]
  | Ast.List (_, Ast.Symbol (_,"__sum-type") :: Ast.List (_,Ast.Symbol (_,type_name) :: _) :: arms) ->
      let discriminator = List.find_map (function Ast.List (_, [Ast.Keyword (_,":tag");t]) -> name t | _ -> None) arms |> Option.value ~default:"_tag" in
      Some (List.concat_map (function
        | Ast.List (s,(Ast.Symbol (_,n) as ctor) :: fields) ->
            let params = List.mapi (fun i f -> sym (Ast.expr_span f) ("__payload" ^ string_of_int i)) fields in
            let record = match fields with [Ast.Map _] -> true | _ -> false in
            let pairs = [kw s (":" ^ discriminator), Ast.String (s,n)] in
            let pairs = match params with [p] when not record -> pairs @ [kw s ":value",p] | _::_::_ -> pairs @ [kw s ":values",Ast.Vector (s,params)] | _ -> pairs in
            let value = match fields,params with [Ast.Map _],[p] -> call s "assoc" [p;kw s (":" ^ discriminator);Ast.String (s,n)] | _ -> Ast.Map (s,pairs) in
            let value = if params = [] then value else call s "fn" [Ast.Vector (s,params);value] in
            let spec = Ast.Map (s,[kw s ":discriminator",Ast.String (s,discriminator);kw s ":record",Ast.Bool (s,record);kw s ":arity",Ast.Int (s,List.length params)]) in
            [call s "define" [sym s ("__constructor/" ^ n);spec];call s "define" [sym s ("__constructor/" ^ type_name ^ "." ^ n);spec];call s "define" [ctor;value];call s "define" [sym s (type_name ^ "." ^ n);value]]
        | _ -> []) arms)
  | Ast.List (s,[Ast.Symbol (_,"__sum-type");Ast.Symbol (_,n);t]) ->
      let hidden = call s "define" [sym s ("__type/" ^ n);call s "quote" [t]] in
      let constructors = if head t = Some "Brand" then [call s "define" [sym s n;call s "fn" [Ast.Vector (s,[sym s "__brand_value"]);sym s "__brand_value"]]] else [] in
      Some (hidden :: constructors)
  | Ast.List (_, Ast.Symbol (_,"__sum-type") :: _) -> Some []
  | _ -> None

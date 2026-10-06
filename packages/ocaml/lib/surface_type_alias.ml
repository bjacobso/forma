(* Resolve the outer alias lazily so recursive record schemas remain finite. *)
let name = function Ast.Symbol (_,n) -> Some n | _ -> None
let head = function Ast.List (_,h :: _) -> name h | _ -> None
let rec substitute bindings = function
  | Ast.Symbol (_,n) as t -> Option.value ~default:t (List.assoc_opt n bindings)
  | Ast.Map (s,fields) -> Ast.Map (s,List.map (fun (key,t) -> key,substitute bindings t) fields)
  | Ast.List (s,items) -> Ast.List (s,List.map (substitute bindings) items)
  | Ast.Vector (s,items) -> Ast.Vector (s,List.map (substitute bindings) items)
  | t -> t
let rec resolve ?(seen=[]) lookup t =
  let owner=match name t with Some _ as n -> n | None -> head t in
  match Option.bind owner lookup with
  | None -> t
  | Some definition ->
      let owner=Option.get owner in
      let span=Ast.expr_span t in
      if List.mem owner seen then Surface_error.invalid span ("Cyclic type alias " ^ owner);
      let seen=owner :: seen in
      (match definition with
       | Ast.List (_, [Ast.Symbol (_,"__type-function");Ast.Vector (_,params);body]) ->
           let args=match t with Ast.List (_, _ :: args) -> args | _ -> [] in
           if List.length args<>List.length params then
             Surface_error.invalid span (Printf.sprintf "Type %s expects %d type argument%s, found %d" owner (List.length params) (if List.length params=1 then "" else "s") (List.length args));
           let bindings=List.map2 (fun param arg -> match name param with
             | Some n -> n,arg
             | None -> Surface_error.invalid (Ast.expr_span param) "Type parameters must be distinct lowercase symbols.") params args in
           resolve ~seen lookup (substitute bindings body)
       | _ when Option.is_some (name t) -> resolve ~seen lookup definition
       | _ -> t)
let environment_lookup env n =
  Option.bind (Env.lookup ("__type/" ^ n) env) (fun value ->
    match Quote.syntax_of_value value with Ok t -> Some t | Error _ -> None)
let optional env t = head (resolve (environment_lookup env) t)=Some "Option"

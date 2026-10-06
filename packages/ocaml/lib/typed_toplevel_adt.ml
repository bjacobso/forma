type diagnostic = Type_diagnostic.t

let diagnostic = Type_diagnostic.make

let lower_diagnostics diagnostics =
  List.map
    (fun (diagnostic : Lower.diagnostic) ->
      Type_diagnostic.make ?span:diagnostic.span diagnostic.code
        diagnostic.message)
    diagnostics

let result_type name type_params =
  match type_params with
  | [] -> Type_expr.TNamed name
  | _ -> Type_expr.TNamedApp (name, List.map snd type_params)

let rec field_type env type_params expr =
  match expr with
  | Ast.Symbol (_, name) -> (
      match List.assoc_opt name type_params with
      | Some ty -> Ok ty
      | None -> resolve_field_type env expr)
  | _ -> resolve_field_type env expr

and resolve_field_type env expr =
  match Lower_type.parse_type_expr expr with
  | Error diagnostics -> Error (lower_diagnostics diagnostics)
  | Ok type_expr -> Type_resolve.resolve env type_expr

let rec constructor_type env result_ty type_params = function
  | Ast.List (_, Ast.Symbol (_, _name) :: fields) -> (
      match field_types env type_params fields with
      | Error _ as error -> error
      | Ok [] -> Ok result_ty
      | Ok field_tys -> Ok (Type_expr.TFn (field_tys, result_ty)))
  | bad ->
      Error
        [
          diagnostic ~span:(Ast.expr_span bad) "typecheck/define-type"
            "__sum-type constructor must be a list headed by a symbol.";
        ]

and field_types env type_params fields =
  let rec loop acc = function
    | [] -> Ok (List.rev acc)
    | field :: rest -> (
        match field_type env type_params field with
        | Error _ as error -> error
        | Ok ty -> loop (ty :: acc) rest)
  in
  loop [] fields

let bindings name type_param_names constructors env =
  let constructors = List.filter (fun e -> Surface.head e <> Some ":tag") constructors in
  let type_params =
    List.map (fun name -> (name, Type_expr.fresh_tyvar ())) type_param_names
  in
  let type_param_ids =
    List.filter_map
      (function _, Type_expr.TVar id -> Some id | _ -> None)
      type_params
  in
  let env = List.fold_left (fun env (n,t) -> Type_env.bind n (Type_env.Forall ([],t,[],Type_env.Plain)) env) env type_params in
  let result_ty = result_type name type_params in
  let rec loop env = function
    | [] -> Ok (List.filter (fun (n,_) -> not (List.mem_assoc n type_params)) env)
    | (Ast.List (_, Ast.Symbol (_, constructor_name) :: _) as constructor)
      :: rest -> (
        match constructor_type env result_ty type_params constructor with
        | Error _ as error -> error
        | Ok constructor_ty ->
            loop
              (Type_env.bind constructor_name
                 (Type_env.Forall
                    (type_param_ids, constructor_ty, [], Type_env.Plain))
                 (Type_env.bind (name ^ "." ^ constructor_name) (Type_env.Forall (type_param_ids,constructor_ty,[],Type_env.Plain)) env))
              rest)
    | bad :: _ ->
        Error
          [
            diagnostic ~span:(Ast.expr_span bad) "typecheck/define-type"
              "__sum-type constructor must be a list headed by a symbol.";
          ]
  in
  loop
    (Type_env.bind name
       (Type_env.Forall (type_param_ids, result_ty, [], Type_env.Plain))
       (Type_env.bind ("__type/" ^ name) (Type_env.Forall ([],Type_expr.TNamed name,[],Type_env.Plain)) env))
    constructors

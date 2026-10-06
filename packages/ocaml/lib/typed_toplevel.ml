type diagnostic = Type_diagnostic.t
type env = Type_env.env

type callbacks = {
  infer_toplevel_core :
    env -> Core_ast.expr -> (Type_expr.ty * env, diagnostic list) result;
  infer_core_expr :
    env -> Core_ast.expr -> (Type_expr.ty, diagnostic list) result;
}

type expression_type = { form_index : int; span : Ast.span; typ : Type_expr.ty }
let diagnostic = Type_diagnostic.make
let with_span = Type_diagnostic.with_span
let plain_scheme ty = Type_env.Forall ([], ty, [], Type_env.Plain)
let lower_diagnostics diagnostics =
  List.map
    (fun (diagnostic : Lower.diagnostic) ->
      Type_diagnostic.make ?span:diagnostic.span diagnostic.code
        diagnostic.message)
    diagnostics

let lower_toplevel_pair expr next =
  match next with
  | Some next ->
      Lower.program [ expr; next ]
      |> Result.map (fun program -> (program, true))
  | None ->
      Lower.program [ expr ] |> Result.map (fun program -> (program, false))

let lower_single_toplevel expr =
  Lower.program [ expr ] |> Result.map (fun program -> (program, false))
type class_info = {
  name : string;
  type_param_ids : int list;
  methods : class_method list;
}

and class_method = {
  name : string;
  ty : Type_expr.ty;
  local_type_param_ids : int list;
}
let parse_typeclass_param = function
  | Ast.Symbol (_, name) -> Ok name
  | Ast.List
      ( _,
        [
          Ast.Symbol (_, name); (Ast.Symbol (_, ":") | Ast.Keyword (_, ":")); _;
        ] ) ->
      Ok name
  | bad ->
      Error
        [
          diagnostic ~span:(Ast.expr_span bad) "typecheck/define-typeclass"
            "__typeclass parameters must be symbols or (name : kind) \
             forms.";
        ]

let parse_typeclass_header = function
  | Ast.List (_, Ast.Symbol (_, name) :: params) ->
      let rec loop acc = function
        | [] -> Ok (name, List.rev acc)
        | param :: rest -> (
            match parse_typeclass_param param with
            | Error _ as error -> error
            | Ok param_name -> loop (param_name :: acc) rest)
      in
      loop [] params
  | bad ->
      Error
        [
          diagnostic ~span:(Ast.expr_span bad) "typecheck/define-typeclass"
            "__typeclass header must be (ClassName params...).";
        ]

let parse_typeclass_method_type env type_param_bindings type_param_ids =
  function
  | Ast.List (_, [ Ast.Symbol (_, method_name); type_expr_ast ]) -> (
      match Lower_type.parse_type_expr type_expr_ast with
      | Error diagnostics -> Error (lower_diagnostics diagnostics)
      | Ok type_expr -> (
          let implicit_param_names =
            Typed_toplevel_typevars.collect_implicit [] type_expr
            |> List.filter (fun name ->
                not (List.mem_assoc name type_param_bindings))
            |> List.sort_uniq String.compare
          in
          let implicit_bindings =
            List.map
              (fun name -> (name, Type_expr.fresh_tyvar ()))
              implicit_param_names
          in
          let implicit_param_ids =
            List.filter_map
              (function _, Type_expr.TVar id -> Some id | _ -> None)
              implicit_bindings
          in
          let env =
            List.fold_left
              (fun env (name, ty) -> Type_env.bind name (plain_scheme ty) env)
              env
              (implicit_bindings @ type_param_bindings)
          in
          match Type_resolve.resolve env type_expr with
          | Error _ as error -> error
          | Ok ty ->
              Ok
                ( {
                    name = method_name;
                    ty;
                    local_type_param_ids = implicit_param_ids;
                  },
                  Type_env.Forall
                    (type_param_ids @ implicit_param_ids, ty, [], Type_env.Plain)
                )))
  | bad ->
      Error
        [
          diagnostic ~span:(Ast.expr_span bad) "typecheck/define-typeclass"
            "__typeclass methods must be (name type) forms.";
        ]

let build_class_info env name type_param_names methods =
  let type_param_tys =
    List.map
      (fun param_name -> (param_name, Type_expr.fresh_tyvar ()))
      type_param_names
  in
  let type_param_ids =
    List.filter_map
      (function _, Type_expr.TVar id -> Some id | _ -> None)
      type_param_tys
  in
  let rec loop acc = function
    | [] -> Ok { name; type_param_ids; methods = List.rev acc }
    | method_decl :: rest -> (
        match
          parse_typeclass_method_type env type_param_tys type_param_ids
            method_decl
        with
        | Error _ as error -> error
        | Ok (method_info, _) -> loop (method_info :: acc) rest)
  in
  loop [] methods

let bind_class_methods env class_info =
  List.fold_left
    (fun env (method_info : class_method) ->
      Type_env.bind_typeclass_method method_info.name class_info.name
        class_info.type_param_ids
        (Type_env.Forall
           ( class_info.type_param_ids @ method_info.local_type_param_ids,
             method_info.ty,
             [
               {
                 Type_env.class_name = class_info.name;
                 args =
                   List.map
                     (fun type_param_id -> Type_expr.TVar type_param_id)
                     class_info.type_param_ids;
               };
             ],
             Type_env.Plain ))
        env)
    env class_info.methods

let registry_bind class_info registry =
  (class_info.name, class_info) :: List.remove_assoc class_info.name registry
let parse_instance_header = function
  | Ast.List (_, Ast.Symbol (_, class_name) :: type_args) ->
      Ok (class_name, type_args)
  | bad ->
      Error
        [
          diagnostic ~span:(Ast.expr_span bad) "typecheck/instance"
            "instance header must be (ClassName types...).";
        ]

let resolve_instance_type_args env type_args =
  let rec loop acc = function
    | [] -> Ok (List.rev acc)
    | type_arg :: rest -> (
        match Lower_type.parse_type_expr type_arg with
        | Error diagnostics -> Error (lower_diagnostics diagnostics)
        | Ok type_expr -> (
            match Type_resolve.resolve env type_expr with
            | Error _ as error -> error
            | Ok ty -> loop (ty :: acc) rest))
  in
  loop [] type_args
let parse_instance_method = function
  | Ast.List (_, [ Ast.Symbol (_, "define"); Ast.Symbol (_, name); body ]) ->
      Ok (name, body)
  | bad ->
      Error
        [
          diagnostic ~span:(Ast.expr_span bad) "typecheck/instance"
            "instance methods must be (define name expr) forms.";
        ]
let lower_instance_method_body body =
  match Lower.program [ body ] with
  | Error diagnostics -> Error (lower_diagnostics diagnostics)
  | Ok [ lowered ] -> Ok lowered
  | Ok _ ->
      Error
        [
          diagnostic ~span:(Ast.expr_span body) "typecheck/instance"
            "Expected one lowered instance method body.";
        ]

let check_instance_methods callbacks env class_info type_args methods =
  if List.length type_args <> List.length class_info.type_param_ids then
    Error
      [
        diagnostic "typecheck/instance"
          (Printf.sprintf
             "Instance for %S expects %d type arguments, received %d."
             class_info.name
             (List.length class_info.type_param_ids)
             (List.length type_args));
      ]
  else
    let type_subst = List.combine class_info.type_param_ids type_args in
    let rec loop = function
      | [] -> Ok ()
      | method_decl :: rest -> (
          match parse_instance_method method_decl with
          | Error _ as error -> error
          | Ok (method_name, body) -> (
              match
                List.find_opt
                  (fun (method_info : class_method) ->
                    method_info.name = method_name)
                  class_info.methods
              with
              | None -> loop rest
              | Some method_info -> (
                  match lower_instance_method_body body with
                  | Error _ as error -> error
                  | Ok lowered_body -> (
                      match callbacks.infer_core_expr env lowered_body with
                      | Error _ as error -> error
                      | Ok actual_ty -> (
                          let expected_ty =
                            Type_expr.apply_subst type_subst method_info.ty
                          in
                          match Type_unify.unify expected_ty actual_ty with
                          | Error _ as error -> error
                          | Ok _ -> loop rest)))))
    in
    loop methods

let type_toplevel callbacks registry env expr rest =
  let result =
    match Typed_mechanics_toplevel.type_toplevel registry env expr with
    | Some result -> result
    | None -> (
    match expr with
    | Ast.List (_, Ast.Symbol (_, "__type-alias") :: _) ->
        Typed_structural_alias.infer_structural_alias env expr
        |> Result.map (fun (ty,env) -> ty,registry,env,false)
    | Ast.List (_, Ast.Symbol (_, "__typeclass") :: header :: body) -> (
        let methods =
          match body with
          | Ast.Vector _ :: methods -> methods
          | methods -> methods
        in
        match parse_typeclass_header header with
        | Error _ as error -> error
        | Ok (name, type_param_names) -> (
            match build_class_info env name type_param_names methods with
            | Error _ as error -> error
            | Ok class_info ->
                Ok
                  ( Type_expr.TDeclaration,
                    registry_bind class_info registry,
                    bind_class_methods env class_info,
                    false )))
    | Ast.List (_, Ast.Symbol (_, "__typeclass") :: _) ->
        Error
          [
            diagnostic "typecheck/define-typeclass"
              "__typeclass expects a header followed by method \
               declarations.";
          ]
    | Ast.List (_, Ast.Symbol (_, "instance") :: args) -> (
        let parsed =
          match args with
          | Ast.Vector _ :: header :: methods -> Ok (header, methods)
          | header :: methods -> Ok (header, methods)
          | [] ->
              Error
                [
                  diagnostic "typecheck/instance"
                    "instance expects a class header and method definitions.";
                ]
        in
        match parsed with
        | Error _ as error -> error
        | Ok (header, methods) -> (
            match parse_instance_header header with
            | Error _ as error -> error
            | Ok (class_name, type_arg_exprs) -> (
                match List.assoc_opt class_name registry with
                | None ->
                    Error
                      [
                        diagnostic "typecheck/unknown-typeclass"
                          (Printf.sprintf "Unknown type class %S." class_name);
                      ]
                | Some class_info -> (
                    match resolve_instance_type_args env type_arg_exprs with
                    | Error _ as error -> error
                    | Ok type_args -> (
                        match
                          check_instance_methods callbacks env class_info
                            type_args methods
                        with
                        | Error _ as error -> error
                        | Ok () ->
                            Ok
                              ( Type_expr.TDeclaration,
                                registry,
                                Type_env.bind_typeclass_instance class_name
                                  type_args env,
                                false ))))))
    | Ast.List
        ( _,
          Ast.Symbol (_, "__sum-type")
          :: Ast.List (_, Ast.Symbol (_, name) :: type_params)
          :: constructors ) -> (
        let type_param_names =
          List.map
            (function
              | Ast.Symbol (_, name) -> Ok name
              | bad ->
                  Error
                    [
                      diagnostic ~span:(Ast.expr_span bad)
                        "typecheck/define-type"
                        "__sum-type parameters must be symbols.";
                    ])
            type_params
        in
        let rec collect acc = function
          | [] -> Ok (List.rev acc)
          | Ok name :: rest -> collect (name :: acc) rest
          | (Error _ as error) :: _ -> error
        in
        match collect [] type_param_names with
        | Error _ as error -> error
        | Ok type_param_names -> (
            match
              Typed_toplevel_adt.bindings name type_param_names constructors env
            with
            | Error _ as error -> error
            | Ok env -> Ok (Type_expr.TDeclaration, registry, env, false)))
    | Ast.List
        (_, Ast.Symbol (_, "__form-descriptor") :: Ast.Symbol (_, name) :: _clauses)
      ->
        Ok
          ( Type_expr.TFormDescriptor,
            registry,
            Type_env.bind name (plain_scheme Type_expr.TFormDescriptor) env,
            false )
    | Ast.List (_, Ast.Symbol (_, "__form-descriptor") :: _) ->
        Error
          [
            diagnostic "typecheck/define-form"
              "__form-descriptor expects a symbol name followed by descriptor \
               clauses.";
          ]
    | Ast.List (_, Ast.Symbol (_, "__form-hook") :: Ast.Symbol (_, name) :: _clauses)
      ->
        let scheme =
          plain_scheme (Type_expr.TFn ([ Type_expr.TAny ], Type_expr.TAny))
        in
        Ok
          ( Type_expr.TFn ([ Type_expr.TAny ], Type_expr.TAny),
            registry,
            Type_env.bind name scheme env,
            false )
    | Ast.List (_, Ast.Symbol (_, "__form-hook") :: _) ->
        Error
          [
            diagnostic "typecheck/meta-fn"
              "__form-hook expects a symbol name followed by descriptor clauses.";
          ]
    | Ast.List
        ( _,
          Ast.Symbol (_, "__protocol-descriptor") :: Ast.Symbol (_, name) :: _clauses
        ) ->
        Ok
          ( Type_expr.TProtocolDescriptor,
            registry,
            Type_env.bind name (plain_scheme Type_expr.TProtocolDescriptor) env,
            false )
    | Ast.List (_, Ast.Symbol (_, "__protocol-descriptor") :: _) ->
        Error
          [
            diagnostic "typecheck/define-protocol"
              "__protocol-descriptor expects a symbol name followed by descriptor \
               clauses.";
          ]
    | Ast.List
        ( _,
          Ast.Symbol
            ( _,
              ( "__projection-plan" | "__projection-primitive"
              | "__payload-contract" ) )
          :: Ast.Symbol (_, name)
          :: _clauses ) ->
        Ok
          ( Type_expr.TDeclaration,
            registry,
            Type_env.bind name (plain_scheme Type_expr.TDeclaration) env,
            false )
    | Ast.List
        ( _,
          Ast.Symbol
            ( _,
              ( "__projection-plan" | "__projection-primitive"
              | "__payload-contract" ) )
          :: _ ) ->
        Error
          [
            diagnostic "typecheck/define-payload-contract"
              "__payload-contract expects a symbol name followed by \
               payload descriptor clauses.";
          ]
    | Ast.List
        ( _,
          Ast.Symbol (_, ("defmacro" | "__macro"))
          :: Ast.Symbol (_, name)
          :: Ast.Vector (_, _params)
          :: _body ) ->
        Ok
          ( Type_expr.TMacro,
            registry,
            Type_env.bind name (plain_scheme Type_expr.TMacro) env,
            false )
    | Ast.List (_, Ast.Symbol (_, ("defmacro" | "__macro")) :: _) ->
        Error
          [
            diagnostic "typecheck/define-macro"
              "__macro expects a symbol name, parameter vector, and body \
               forms.";
          ]
    | Ast.List
        (_, [ (Ast.Symbol (_, ":") | Ast.Keyword (_, ":")); Ast.Symbol _; _ ])
      -> (
        let next = match rest with next :: _ -> Some next | [] -> None in
        match lower_toplevel_pair expr next with
        | Error diagnostics -> Error (lower_diagnostics diagnostics)
        | Ok (program, consumed_next) -> (
            match program with
            | [ lowered ] -> (
                match callbacks.infer_toplevel_core env lowered with
                | Error _ as error -> error
                | Ok (ty, env) -> Ok (ty, registry, env, consumed_next))
            | _ ->
                Error
                  [
                    diagnostic ~span:(Ast.expr_span expr) "typecheck/lower"
                      "Expected one lowered top-level form.";
                  ]))
    | Ast.List (_, Ast.Symbol (_, op) :: args) -> (
        match Type_env.lookup op env with
        | Some Type_expr.TFormDescriptor ->
            let env =
              match Descriptor.declaration_binding_name args with
              | Some name ->
                  Type_env.bind name (plain_scheme Type_expr.TDeclaration) env
              | None -> env
            in
            Ok (Type_expr.TDeclaration, registry, env, false)
        | _ -> (
            match lower_single_toplevel expr with
            | Error diagnostics -> Error (lower_diagnostics diagnostics)
            | Ok (program, consumed_next) -> (
                match program with
                | [ lowered ] -> (
                    match callbacks.infer_toplevel_core env lowered with
                    | Error _ as error -> error
                    | Ok (ty, env) -> Ok (ty, registry, env, consumed_next))
                | _ ->
                    Error
                      [
                        diagnostic ~span:(Ast.expr_span expr) "typecheck/lower"
                          "Expected one lowered top-level form.";
                      ])))
    | _ -> (
        match lower_single_toplevel expr with
        | Error diagnostics -> Error (lower_diagnostics diagnostics)
        | Ok (program, consumed_next) -> (
            match program with
            | [ lowered ] -> (
                match callbacks.infer_toplevel_core env lowered with
                | Error _ as error -> error
                | Ok (ty, env) -> Ok (ty, registry, env, consumed_next))
            | _ ->
                Error
                  [
                    diagnostic ~span:(Ast.expr_span expr) "typecheck/lower"
                      "Expected one lowered top-level form.";
                  ])))
  in
  Result.map_error (with_span (Ast.expr_span expr)) result

let prebind_top_level_definitions env exprs =
  List.fold_left
    (fun env expr ->
      match expr with
      | Ast.List
          ( _,
            Ast.Symbol (_, ("define" | "__operation"))
            :: Ast.Symbol (_, name) :: _ ) ->
          Type_env.bind name (plain_scheme (Type_expr.fresh_tyvar ())) env
      | _ -> env)
    env exprs

let collect_expression_types callbacks env exprs =
  let signatures = List.filter_map (fun e -> Option.map (fun (n,_) -> n,e) (Lower_type.type_signature e)) exprs in
  let definitions = List.filter_map Lower_type.definition_name exprs in
  let rec loop registry env form_index acc last = function
    | [] -> Ok (List.rev acc, Type_expr.ty_to_string last, env)
    | expr :: rest ->
        let signature = Lower_type.type_signature expr in
        (match signature with
        | Some (n,_) when not (List.mem n definitions) -> Error [diagnostic ~span:(Ast.expr_span expr) "typecheck/signature" ("No definition for signature " ^ n)]
        | Some (n,_) when List.length (List.filter (fun (m,_) -> m=n) signatures) > 1 -> Error [diagnostic ~span:(Ast.expr_span expr) "typecheck/signature" "Duplicate module signature."]
        | Some (n,_) when (match rest with next :: _ -> Lower_type.definition_name next <> Some n | [] -> true) ->
            loop registry env (form_index+1) acc last rest
        | _ ->
            let result = match Lower_type.definition_name expr with
              | Some n when List.mem_assoc n signatures ->
                  (match Lower.program [List.assoc n signatures; expr] with
                   | Error ds -> Error (lower_diagnostics ds)
                   | Ok [lowered] -> Result.map (fun (ty,env) -> ty,registry,env,false) (callbacks.infer_toplevel_core env lowered)
                   | _ -> assert false)
              | _ -> type_toplevel callbacks registry env expr rest in
            match result with
            | Error _ as error -> error
            | Ok (ty, registry, env, consumed_next) ->
                let acc = { form_index; span = Ast.expr_span expr; typ = ty } :: acc in
                let rest = if consumed_next then List.tl rest else rest in
                let form_index = form_index + if consumed_next then 2 else 1 in
                loop registry env form_index acc ty rest)
  in
  loop [] (prebind_top_level_definitions env exprs) 0 [] Type_expr.TNil exprs

let typecheck_program_with_env callbacks env exprs =
  match collect_expression_types callbacks env exprs with
  | Error _ as error -> error
  | Ok (_expression_types, display, env) -> Ok (display, env)
let typecheck_program_with_env_all = collect_expression_types

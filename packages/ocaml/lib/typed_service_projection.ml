type diagnostic = Type_diagnostic.t

let diagnostic = Type_diagnostic.make

let plain_scheme ty = Type_env.Forall ([], ty, [], Type_env.Plain)

let lower_diagnostics diagnostics =
  List.map
    (fun (diagnostic : Lower.diagnostic) ->
      Type_diagnostic.make ?span:diagnostic.span diagnostic.code
        diagnostic.message)
    diagnostics

let append_operation_requirement operation_requirement type_expr =
  match type_expr with
  | Core_ast.TEApp
      ( span,
        (Core_ast.TESym (_, "Effect") as callee),
        [ success; errors; Core_ast.TEApp (req_span, req_callee, req_args) ]
      ) -> (
      match req_callee with
      | Core_ast.TESym (_, "RequirementSet") ->
          let operation_requirement_exists =
            List.exists
              (function
                | Core_ast.TESym (_, name)
                  when name = operation_requirement ->
                    true
                | _ -> false)
              req_args
          in
          Ok
            (Core_ast.TEApp
               ( span,
                 callee,
                 [
                   success;
                   errors;
                   Core_ast.TEApp
                     ( req_span,
                       req_callee,
                       req_args
                       @
                       (if operation_requirement_exists then []
                        else
                          [ Core_ast.TESym (req_span, operation_requirement) ]) );
                 ] ))
      | _ ->
          Error
            [
              diagnostic ~span:req_span "typecheck/define-service"
                "service method Effect requirements must be a requirement \
                 set.";
            ])
  | _ ->
      Error
        [
          diagnostic "typecheck/define-service"
            "service methods must return an Effect type.";
        ]

let rec parse_param_types acc = function
  | [] -> Ok (List.rev acc)
  | Ast.Symbol (_, _) :: type_expr :: rest -> (
      match Lower_type.parse_type_expr type_expr with
      | Error diagnostics -> Error (lower_diagnostics diagnostics)
      | Ok type_expr -> parse_param_types (type_expr :: acc) rest)
  | name :: _ ->
      Error
        [
          diagnostic ~span:(Ast.expr_span name) "typecheck/define-service"
            "service method params must be [name Type ...] pairs.";
        ]

let rec parse_method service_name = function
  | Ast.List (s,[n;params;result;Ast.Keyword (_,":value")]) ->
      parse_method service_name (Ast.List (s,[n;params;result])) |> Result.map (function n,Core_ast.TEFun (_,[],result) -> n,result | pair -> pair)
  | Ast.List
      ( span,
        [
          Ast.Symbol (_, method_name);
          Ast.Vector (_, params);
          return_expr;
        ] ) -> (
      match
        ( parse_param_types [] params,
          Lower_type.parse_type_expr return_expr
          |> Result.map_error lower_diagnostics )
      with
      | Error diagnostics, _ | _, Error diagnostics -> Error diagnostics
      | Ok params, Ok return_type -> (
          let operation_requirement = service_name ^ "." ^ method_name in
          match append_operation_requirement operation_requirement return_type with
          | Error _ as error -> error
          | Ok return_type ->
              Ok
                ( method_name,
                  Core_ast.TEFun (span, params, return_type) )))
  | bad ->
      Error
        [
          diagnostic ~span:(Ast.expr_span bad) "typecheck/define-service"
            "service methods must be (name [param Type ...] ReturnEffect).";
        ]

let parse_methods service_name = function
  | Ast.List (_, Ast.Keyword (_, ":methods") :: methods)
  | Ast.List (_, Ast.Symbol (_, ":methods") :: methods) ->
      let rec loop acc = function
        | [] -> Ok (List.rev acc)
        | method_expr :: rest -> (
            match parse_method service_name method_expr with
            | Error _ as error -> error
            | Ok method_ -> loop (method_ :: acc) rest)
      in
      loop [] methods
  | bad ->
      Error
        [
          diagnostic ~span:(Ast.expr_span bad) "typecheck/define-service"
            "__service expects a (:methods ...) block.";
        ]

let bind env service_name methods_expr =
  match parse_methods service_name methods_expr with
  | Error _ as error -> error
  | Ok methods ->
      let rec loop env = function
        | [] -> Ok env
        | (method_name, method_type_expr) :: rest -> (
            match Type_resolve.resolve env method_type_expr with
            | Error _ as error -> error
            | Ok method_type ->
                loop
                  (Type_env.bind
                     (service_name ^ "." ^ method_name)
                     (plain_scheme method_type) env)
                  rest)
      in
      loop env methods

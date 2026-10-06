let diagnostic = Type_diagnostic.make

let plain_scheme ty = Type_env.Forall ([], ty, [], Type_env.Plain)

let type_toplevel registry env = function
  | Ast.List (_, [Ast.Symbol (_,"__record-type");Ast.Symbol (_,name);fields;Ast.Symbol (_,kind)]) ->
      Some (Typed_nominal_record.bind env name fields (kind="error")
        |> Result.map (fun env -> Type_expr.TDeclaration,registry,env,false))
  | Ast.List (_, [ Ast.Symbol (_, "module"); Ast.Symbol (_, _) ]) ->
      Some (Ok (Type_expr.TDeclaration, registry, env, false))
  | Ast.List (_, Ast.Symbol (_, "module") :: _) ->
      Some
        (Error
           [
             diagnostic "typecheck/module" "module expects a module name.";
           ])
  | Ast.List
      ( _,
        [ Ast.Symbol (_, "__schema"); Ast.Symbol (_, name); schema_expr ]
      ) -> (
      if Typed_schema_projection.is_projection_expr schema_expr then
        match Typed_schema_projection.bind env name schema_expr with
        | Error _ as error -> Some error
        | Ok env -> Some (Ok (Type_expr.TDeclaration, registry, env, false))
      else
        match Type_env.lookup "__schema" env with
        | Some Type_expr.TFormDescriptor ->
            Some
              (Ok
                 ( Type_expr.TDeclaration,
                   registry,
                   Type_env.bind name (plain_scheme Type_expr.TDeclaration) env,
                   false ))
        | _ ->
            Some
              (Error
                 [
                   diagnostic "typecheck/define-schema"
                     "__schema expects a schema name and schema \
                      expression.";
                 ]))
  | Ast.List
      ( _,
        [
          Ast.Symbol (_, "__service");
          Ast.Symbol (_, name);
          methods_expr;
        ] ) -> (
      match Typed_service_projection.bind env name methods_expr with
      | Error _ as error -> Some error
      | Ok env -> Some (Ok (Type_expr.TDeclaration, registry, env, false)))
  | Ast.List
      ( _,
        [ Ast.Symbol (_, "__error"); Ast.Symbol (_, name); fields_expr ]
      ) -> (
      match Typed_error_projection.bind env name fields_expr with
      | Error _ as error -> Some error
      | Ok env -> Some (Ok (Type_expr.TDeclaration, registry, env, false)))
  | Ast.List (_, Ast.Symbol (_, "__service") :: _) ->
      Some
        (Error
           [
             diagnostic "typecheck/define-service"
               "__service expects a service name and (:methods ...) \
                block.";
           ])
  | _ -> None

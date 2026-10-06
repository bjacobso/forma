type diagnostic = Type_diagnostic.t
type env = Type_env.env

type callbacks = {
  infer_toplevel_core :
    env -> Core_ast.expr -> (Type_expr.ty * env, diagnostic list) result;
  annotate_expr :
    env -> Core_ast.expr -> (Typed_core.annotation list, diagnostic list) result;
}

let span_value span =
  Value.VMap
    [
      (Value.VKeyword ":source-id", Value.VString span.Ast.source_id);
      (Value.VKeyword ":start-offset", Value.VInt span.start_offset);
      (Value.VKeyword ":end-offset", Value.VInt span.end_offset);
    ]

let rec core_expr_value expr =
  let base kind fields =
    Value.VMap
      ((Value.VKeyword ":kind", Value.VString kind)
      :: (Value.VKeyword ":span", span_value (Core_ast.expr_span expr))
      :: fields)
  in
  match expr with
  | Core_ast.Lit (_, literal) ->
      base "literal"
        [
          ( Value.VKeyword ":value",
            match literal with
            | Core_ast.LNil -> Value.VNil
            | Core_ast.LBool value -> Value.VBool value
            | Core_ast.LInt value -> Value.VInt value
            | Core_ast.LFloat value -> Value.VFloat value
            | Core_ast.LString value -> Value.VString value
            | Core_ast.LKeyword value -> Value.VKeyword value
            | Core_ast.LSymbol value -> Value.VSymbol value
            | Core_ast.LQuoted value -> Quote.value_of_syntax value );
        ]
  | Core_ast.Var (_, name) ->
      base "variable" [ (Value.VKeyword ":name", Value.VSymbol name) ]
  | Core_ast.App (_, Core_ast.Var (_, name), args) ->
      base "application"
        [
          (Value.VKeyword ":form", Value.VSymbol name);
          (Value.VKeyword ":args", Value.VList (List.map core_expr_value args));
        ]
  | Core_ast.App (_, callee, args) ->
      base "application"
        [
          (Value.VKeyword ":callee", core_expr_value callee);
          (Value.VKeyword ":args", Value.VList (List.map core_expr_value args));
        ]
  | Core_ast.Ascribe (_, value, _) ->
      base "ascription" [ (Value.VKeyword ":value", core_expr_value value) ]
  | Core_ast.Record (_, fields) ->
      let field_value (field : Core_ast.field) =
        Value.VMap
          [
            (Value.VKeyword ":label", Value.VString field.label);
            (Value.VKeyword ":value", core_expr_value field.value);
          ]
      in
      base "record"
        [
          (Value.VKeyword ":fields", Value.VList (List.map field_value fields));
        ]
  | _ -> base "expression" []

and descriptor_value_of_core_expr expr =
  match expr with
  | Core_ast.Lit (_, literal) -> (
      match literal with
      | Core_ast.LNil -> Value.VNil
      | Core_ast.LBool value -> Value.VBool value
      | Core_ast.LInt value -> Value.VInt value
      | Core_ast.LFloat value -> Value.VFloat value
      | Core_ast.LString value -> Value.VString value
      | Core_ast.LKeyword value -> Value.VKeyword value
            | Core_ast.LSymbol value -> Value.VSymbol value
            | Core_ast.LQuoted value -> Quote.value_of_syntax value)
  | Core_ast.Var (_, name) -> Value.VSymbol name
  | Core_ast.App (_, Core_ast.Var (_, "__vector"), args) ->
      Value.VVector (List.map descriptor_value_of_core_expr args)
  | Core_ast.App (_, Core_ast.Var (_, "list"), args) ->
      Value.VList (List.map descriptor_value_of_core_expr args)
  | Core_ast.App (_, Core_ast.Var (_, name), args) ->
      Value.VMap
        [
          (Value.VKeyword ":kind", Value.VString "application");
          (Value.VKeyword ":form", Value.VSymbol name);
          ( Value.VKeyword ":args",
            Value.VList (List.map descriptor_value_of_core_expr args) );
        ]
  | Core_ast.App (_, callee, args) ->
      Value.VMap
        [
          (Value.VKeyword ":kind", Value.VString "application");
          (Value.VKeyword ":callee", descriptor_value_of_core_expr callee);
          ( Value.VKeyword ":args",
            Value.VList (List.map descriptor_value_of_core_expr args) );
        ]
  | Core_ast.Ascribe (_, value, _) -> descriptor_value_of_core_expr value
  | Core_ast.Record (_, fields) ->
      Value.VMap
        (List.map
           (fun (field : Core_ast.field) ->
             ( Value.VKeyword (":" ^ field.label),
               descriptor_value_of_core_expr field.value ))
           fields)
  | _ -> core_expr_value expr

and descriptor_declaration_binding = function
  | Core_ast.App (_, Core_ast.Var (_, form_name), args) ->
      let declaration =
        Descriptor.application_values form_name
          (List.map descriptor_value_of_core_expr args)
      in
      Option.map
        (fun name -> (name, declaration))
        (Eval_slot.declaration_name declaration)
  | Core_ast.Ascribe (_, value, _) -> descriptor_declaration_binding value
  | _ -> None

let declaration_lookup declarations name = List.assoc_opt name declarations

let replace_root_annotation_type ty = function
  | [] -> []
  | annotation :: rest -> { annotation with Typed_core.typ = ty } :: rest

let annotate_descriptor_result callbacks env expr ty =
  if Descriptor_protocol.is_application env expr then
    Ok [ Typed_core.annotation expr ty ]
  else
    match expr with
    | Core_ast.Ascribe (_, value, _) -> (
        match callbacks.annotate_expr env value with
        | Error _ as error -> error
        | Ok value_annotations ->
            Ok
              (Typed_core.annotation expr ty
              :: replace_root_annotation_type ty value_annotations))
    | _ -> (
        match callbacks.annotate_expr env expr with
        | Error _ as error -> error
        | Ok expr_annotations ->
            Ok (replace_root_annotation_type ty expr_annotations))

let typecheck_with_descriptor_hooks callbacks descriptor_hooks env program =
  let rec loop env declarations last annotations = function
    | [] ->
        Ok
          ( { Typed_core.result_type = last; annotations = List.rev annotations },
            env )
    | expr :: rest -> (
        let with_source_declarations thunk =
          let outer_lookup = Eval_meta.current_lookup_declaration () in
          let lookup =
            match outer_lookup with
            | Some lookup ->
                Eval_meta_util.overlay_lookup_option
                  (declaration_lookup declarations)
                  lookup
            | None -> declaration_lookup declarations
          in
          Eval_meta.with_lookup_declaration lookup thunk
        in
        match
          with_source_declarations (fun () ->
              Descriptor_protocol.check_for_expr descriptor_hooks env expr)
        with
        | Error _ as error -> error
        | Ok (Some ty) -> (
            match annotate_descriptor_result callbacks env expr ty with
            | Error _ as error -> error
            | Ok expr_annotations -> (
                match
                  with_source_declarations (fun () ->
                      Descriptor_protocol.bindings_for_expr descriptor_hooks env
                        expr)
                with
                | Error _ as error -> error
                | Ok bindings ->
                    let declarations =
                      match descriptor_declaration_binding expr with
                      | Some binding -> binding :: declarations
                      | None -> declarations
                    in
                    loop (bindings @ env) declarations ty
                      (List.rev_append expr_annotations annotations)
                      rest))
        | Ok None -> (
            match
              with_source_declarations (fun () ->
                  Descriptor_protocol.infer_for_expr descriptor_hooks env expr)
            with
            | Error _ as error -> error
            | Ok (Some ty) -> (
                match annotate_descriptor_result callbacks env expr ty with
                | Error _ as error -> error
                | Ok expr_annotations -> (
                    match
                      with_source_declarations (fun () ->
                          Descriptor_protocol.bindings_for_expr descriptor_hooks
                            env expr)
                    with
                    | Error _ as error -> error
                    | Ok bindings ->
                        let declarations =
                          match descriptor_declaration_binding expr with
                          | Some binding -> binding :: declarations
                          | None -> declarations
                        in
                        loop (bindings @ env) declarations ty
                          (List.rev_append expr_annotations annotations)
                          rest))
            | Ok None -> (
                match callbacks.infer_toplevel_core env expr with
                | Error _ as error -> error
                | Ok (ty, next_env) -> (
                    match callbacks.annotate_expr env expr with
                    | Error _ as error -> error
                    | Ok expr_annotations ->
                        let declarations =
                          match descriptor_declaration_binding expr with
                          | Some binding -> binding :: declarations
                          | None -> declarations
                        in
                        loop next_env declarations ty
                          (List.rev_append expr_annotations annotations)
                          rest))))
  in
  loop env [] Type_expr.TNil [] program

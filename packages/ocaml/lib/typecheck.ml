open Type_expr
open Type_env
open Type_unify

type expression_type = Typed_toplevel.expression_type = {
  form_index : int;
  span : Ast.span;
  typ : Type_expr.ty;
}

let rec infer_expr env expr =
  let result =
    match expr with
    | Core_ast.Lit (_, Core_ast.LNil) -> Ok ([], TNil)
    | Core_ast.Lit (_, Core_ast.LBool _) -> Ok ([], TBool)
    | Core_ast.Lit (_, Core_ast.LInt _) -> Ok ([], TInt)
    | Core_ast.Lit (_, Core_ast.LFloat _) -> Ok ([], TFloat)
    | Core_ast.Lit (_, Core_ast.LString _) -> Ok ([], TString)
    | Core_ast.Lit (_, Core_ast.LKeyword name) -> Ok ([], TNamed name)
    | Core_ast.Lit (_, Core_ast.LQuoted _) -> Ok ([], TSyntax)
    | Core_ast.Lit (_, Core_ast.LSymbol _) -> Ok ([], TSymbol)
    | Core_ast.Var (node, symbol) -> (
        match Type_env.lookup_scheme symbol env with
        | Some scheme ->
            let ty, _ =
              Type_env.instantiate_with_subst_at node.Core_ast.span scheme
            in
            Ok ([], ty)
        | None -> (
            match
              if Type_env.builtins_enabled env then
                Typed_builtin.builtin_value_type symbol
              else None
            with
            | Some ty -> Ok ([], ty)
            | None ->
                Error
                  [
                    Type_diagnostic.make "typecheck/unbound-symbol"
                      (Printf.sprintf "Unbound symbol %S." symbol);
                  ]))
    | Core_ast.Record (_, fields) ->
        Typed_record_builtin.infer_record
          Typed_record_builtin.{ infer_expr }
          env fields
    | Core_ast.Get (_, record, label) -> (
        match infer_expr env record with
        | Error _ as error -> error
        | Ok (subst, record_ty) ->
            let record_ty=match Type_expr.apply_subst subst record_ty with
              | Type_expr.TNamed n -> Option.value ~default:record_ty (Type_env.lookup ("__record/" ^ n) env)
              | _ -> record_ty in
            Typed_record_builtin.infer_get_field subst record_ty label)
    | Core_ast.Lam (_, params, rest_param, body) ->
        infer_lambda env params rest_param body
    | Core_ast.App (_, Core_ast.Var (_, "succeed"), args) ->
        infer_operational_succeed env args
    | Core_ast.App (node, Core_ast.Var (_, op), args) ->
        infer_typeclass_named_application env node.Core_ast.span op args
    | Core_ast.App (_, callee, args) ->
        Typed_apply.infer_application Typed_apply.{ infer_expr; check_expr } env callee args
    | Core_ast.Let (_, bindings, body) -> infer_let env bindings body
    | Core_ast.EffectDo (_, bindings, body) -> infer_effect_do env bindings body
    | Core_ast.EffectFail (node, error_name, payload) ->
        infer_effect_fail env node.span error_name payload
    | Core_ast.EffectCatch (node, body, error_name, binding, handler) ->
        infer_effect_catch env node.span body error_name binding handler
    | Core_ast.If (_, condition, consequent, alternate) ->
        infer_if env condition consequent alternate
    | Core_ast.Def (_, name, signature, value) ->
        infer_definition env name signature value
    | Core_ast.Ascribe (_, value, type_expr) ->
        infer_ascription env value type_expr
    | Core_ast.Match (_, scrutinee, arms) ->
        Typed_match.infer_match Typed_match.{ infer_expr } env scrutinee arms
    | Core_ast.TypeDef _ -> Ok ([], TDeclaration)
    | Core_ast.DslForm _ -> Ok ([], TDeclaration)
  in
  Result.map_error (Type_diagnostic.with_span (Core_ast.expr_span expr)) result

and infer_typeclass_named_application env span op args =
  match Type_env.lookup_scheme op env with
  | Some
      (Type_env.Forall
         (_, (TMacro | TFormDescriptor | TProtocolDescriptor), _, _)) ->
      Typed_builtin.infer_named_application
        Typed_builtin.
          {
            infer_expr; check_expr;
            infer_apply = Typed_apply.infer_apply Typed_apply.{ infer_expr; check_expr };
          }
        env op args
  | Some scheme when args = [] && Surface.is_upper op -> (
      let ty = Type_env.instantiate scheme in
      match ty with TFn ([],result) -> Ok ([],result) | _ -> Ok ([],ty))
  | Some scheme -> (
      let callee_span =
        {
          span with
          start_offset = span.start_offset + 1;
          end_offset = span.start_offset + 1 + String.length op;
        }
      in
      let callee_ty, _ =
        Type_env.instantiate_with_subst_at callee_span scheme
      in
      match
        Typed_apply.infer_apply Typed_apply.{ infer_expr; check_expr } env [] callee_ty args
      with
      | Error _ as error -> error
      | Ok (subst, ty) -> Type_env.discharge_and_return env subst (subst, ty))
  | _ when Type_env.builtins_enabled env ->
      Typed_builtin.infer_named_application
        Typed_builtin.
          {
            infer_expr; check_expr;
            infer_apply = Typed_apply.infer_apply Typed_apply.{ infer_expr; check_expr };
          }
        env op args
  | _ ->
      Error
        [
          Type_diagnostic.make ~span "typecheck/unknown-form"
            (Printf.sprintf "Unknown form or function %S." op);
        ]

and infer_if env condition consequent alternate =
  match infer_expr env condition with
  | Error _ as error -> error
  | Ok (condition_subst, condition_ty) -> (
      match assign condition_ty TBool with Error _ as e -> e | Ok bool_subst -> let condition_subst=compose_subst bool_subst condition_subst in
      let env = apply_subst_env condition_subst env in
      match infer_expr env consequent with
      | Error _ as error -> error
      | Ok (consequent_subst, consequent_ty) -> (
          let subst = compose_subst consequent_subst condition_subst in
          let env = apply_subst_env subst env in
          match alternate with
          | Core_ast.Lit (_, Core_ast.LNil) ->
              Ok (subst, apply_subst subst consequent_ty)
          | _ -> (
              match infer_expr env alternate with
              | Error _ as error -> error
              | Ok (alternate_subst, alternate_ty) -> (
                  let subst = compose_subst alternate_subst subst in
                  let consequent_ty = apply_subst subst consequent_ty in
                  let alternate_ty = apply_subst subst alternate_ty in
                  match consequent with
                  | Core_ast.Lit (_, Core_ast.LNil) ->
                      Ok (subst, apply_subst subst alternate_ty)
                  | _ ->
                  let consequent_effect = effect_parts consequent_ty in
                  let alternate_effect = effect_parts alternate_ty in
                  match (consequent_effect, alternate_effect) with
                  | None, None -> (
                      match join consequent_ty alternate_ty with
                      | Error _ as error -> error
                      | Ok (unify_subst,joined) ->
                          let subst = compose_subst unify_subst subst in
                          Ok (subst, apply_subst subst joined))
                  | _ -> (
                      let consequent_success, consequent_errors, consequent_req =
                        match consequent_effect with
                        | Some parts -> parts
                        | None -> (consequent_ty, [], [])
                      in
                      let alternate_success, alternate_errors, alternate_req =
                        match alternate_effect with
                        | Some parts -> parts
                        | None -> (alternate_ty, [], [])
                      in
                      match unify consequent_success alternate_success with
                      | Error _ as error -> error
                      | Ok unify_subst ->
                          let subst = compose_subst unify_subst subst in
                          Ok
                            ( subst,
                              effect_type
                                (apply_subst subst consequent_success)
                                (merge_type_sets consequent_errors
                                   alternate_errors)
                                (merge_type_sets consequent_req alternate_req)
                            ))))))

and infer_let env bindings body =
  match infer_let_bindings env bindings with
  | Error _ as error -> error
  | Ok (subst, env) -> (
      match infer_expr env body with
      | Error _ as error -> error
      | Ok (body_subst, ty) -> Ok (compose_subst body_subst subst, ty))

and infer_let_bindings env bindings =
  let rec loop subst env = function
    | [] -> Ok (subst, env)
    | (binding : Core_ast.binding) :: rest -> (
        let pending_start = Type_env.pending_constraints_count () in
        match infer_expr env binding.Core_ast.expr with
        | Error _ as error -> error
        | Ok (value_subst, value_ty) ->
            let subst = compose_subst value_subst subst in
            let env = apply_subst_env subst env in
            let scheme =
              generalize_binding env (apply_subst subst value_ty) pending_start
            in
            loop subst (Type_env.bind binding.name scheme env) rest)
  in
  loop [] env bindings

and effect_set_items set_name = function
  | TNamedApp (name, items) when name = set_name -> Some items
  | TApp (TNamed name, items) when name = set_name -> Some items
  | _ -> None

and effect_parts = function
  | TNamedApp ("Effect", [ success; errors; requirements ])
  | TApp (TNamed "Effect", [ success; errors; requirements ]) -> (
      match
        ( effect_set_items "ErrorSet" errors,
          effect_set_items "RequirementSet" requirements )
      with
      | Some errors, Some requirements -> Some (success, errors, requirements)
      | _ -> None)
  | _ -> None

and merge_type_sets left right =
  let rec loop seen acc = function
    | [] -> List.rev acc
    | ty :: rest ->
        let key = ty_to_string ty in
        if List.mem key seen then loop seen acc rest
        else loop (key :: seen) (ty :: acc) rest
  in
  loop [] [] (left @ right)

and effect_type success errors requirements =
  TNamedApp
    ( "Effect",
      [
        success;
        TNamedApp ("ErrorSet", errors);
        TNamedApp ("RequirementSet", requirements);
      ] )

and infer_operational_succeed env = function
  | [ value ] -> (
      match infer_expr env value with
      | Error _ as error -> error
      | Ok (subst, value_ty) ->
          Ok (subst, effect_type (apply_subst subst value_ty) [] []))
  | _ ->
      Error
        [
          Type_diagnostic.make "typecheck/effect-succeed"
            "succeed expects exactly one value.";
        ]

and infer_effect_fail env span error_name payload =
  match Type_env.lookup error_name env with
  | None ->
      Error
        [
          Type_diagnostic.make ~span "typecheck/effect-fail"
            (Printf.sprintf "Unknown error type %s." error_name);
        ]
  | Some expected_payload -> (
      match infer_expr env payload with
      | Error _ as error -> error
      | Ok (payload_subst, payload_ty) -> (
          let expected_payload = match Type_env.lookup ("__record/" ^ error_name) env with
            | Some (TRecord fields) -> TRecord (List.remove_assoc ":_tag" fields)
            | _ -> expected_payload in
          let expected_payload = apply_subst payload_subst expected_payload in
          let payload_ty = apply_subst payload_subst payload_ty in
          match unify expected_payload payload_ty with
          | Error _ as error -> error
          | Ok unify_subst ->
              let subst = compose_subst unify_subst payload_subst in
              Ok
                ( subst,
                  effect_type (fresh_tyvar ()) [ TNamed error_name ] [] )))

and infer_effect_catch env span body error_name binding handler =
  match infer_expr env body with
  | Error _ as error -> error
  | Ok (body_subst, body_ty) -> (
      let body_ty = apply_subst body_subst body_ty in
      match effect_parts body_ty with
      | None ->
          Error
            [
              Type_diagnostic.make ~span "typecheck/effect-catch"
                (Printf.sprintf "catch expects Effect, received %s."
                   (ty_to_string body_ty));
            ]
      | Some (body_success, body_errors, body_requirements) ->
          let handles_error =
            List.exists
              (function TNamed name -> String.equal name error_name | _ -> false)
              body_errors
          in
          if not handles_error then
            Error
              [
                Type_diagnostic.make ~span "typecheck/effect-catch"
                  (Printf.sprintf "Impossible catch: %s is not in %s."
                     error_name (ty_to_string body_ty));
              ]
          else
            match Type_env.lookup error_name env with
            | None ->
                Error
                  [
                    Type_diagnostic.make ~span "typecheck/effect-catch"
                      (Printf.sprintf "Unknown error type %s." error_name);
                  ]
            | Some error_payload -> (
                let error_payload = match Type_env.lookup ("__type/" ^ error_name) env with Some t -> t | None -> error_payload in
                let handler_env =
                  Type_env.bind binding.Core_ast.name
                    (Forall
                       ( [],
                         apply_subst body_subst error_payload,
                         [],
                         Plain ))
                    (apply_subst_env body_subst env)
                in
                match infer_expr handler_env handler with
                | Error _ as error -> error
                | Ok (handler_subst, handler_ty) ->
                    let subst = compose_subst handler_subst body_subst in
                    let handler_ty = apply_subst subst handler_ty in
                    let handler_success, handler_errors, handler_requirements =
                      match effect_parts handler_ty with
                      | Some parts -> parts
                      | None -> (handler_ty, [], [])
                    in
                    let body_success = apply_subst subst body_success in
                    (match unify body_success handler_success with
                    | Error _ as error -> error
                    | Ok result_subst ->
                        let subst = compose_subst result_subst subst in
                        let remaining_errors =
                          List.filter
                            (function
                              | TNamed name -> not (String.equal name error_name)
                              | _ -> true)
                            body_errors
                        in
                        Ok
                          ( subst,
                            effect_type (apply_subst subst body_success)
                              (merge_type_sets remaining_errors handler_errors)
                              (merge_type_sets body_requirements
                                 handler_requirements) ))))

and infer_effect_do env bindings body =
  let rec loop subst env errors requirements = function
    | [] -> (
        match infer_expr env body with
        | Error _ as error -> error
        | Ok (body_subst, body_ty) ->
            let subst = compose_subst body_subst subst in
            let body_ty = apply_subst subst body_ty in
            let success, errors, requirements =
              match effect_parts body_ty with
              | Some (success, body_errors, body_requirements) ->
                  ( success,
                    merge_type_sets errors body_errors,
                    merge_type_sets requirements body_requirements )
              | None -> (body_ty, errors, requirements)
            in
            Ok (subst, effect_type success errors requirements))
    | (binding : Core_ast.binding) :: rest -> (
        match infer_expr env binding.expr with
        | Error _ as error -> error
        | Ok (binding_subst, binding_ty) -> (
            let subst = compose_subst binding_subst subst in
            let binding_ty = apply_subst subst binding_ty in
            match effect_parts binding_ty with
            | None ->
                Error
                  [
                    Type_diagnostic.make ~span:binding.node.span
                      "typecheck/effect-bind"
                      (Printf.sprintf "Effect bind expects Effect, received %s."
                         (ty_to_string binding_ty));
                  ]
            | Some (success, binding_errors, binding_requirements) ->
                loop subst
                  (Type_env.bind binding.name (Forall ([], success, [], Plain))
                     (apply_subst_env subst env))
                  (merge_type_sets errors binding_errors)
                  (merge_type_sets requirements binding_requirements)
                  rest))
  in
  loop [] env [] [] bindings

and infer_lambda ?expected env params rest_param body =
  let param_tys,rest_ty,return_hint=match expected with
    | Some (TFn (args,result)) when List.length args=List.length params -> args,fresh_tyvar (),Some result
    | Some (TVariadicFn (args,rest,result)) when List.length args=List.length params -> args,rest,Some result
    | _ -> List.map (fun _ -> fresh_tyvar ()) params,fresh_tyvar (),None in
  let param_bindings =
    List.map2
      (fun (param : Core_ast.param) ty ->
        (param.name, Forall ([], ty, [], Plain)))
      params param_tys
  in
  let rest_binding =
    match rest_param with
    | None -> []
    | Some (param : Core_ast.param) ->
        [ (param.name, Forall ([], TList rest_ty, [], Plain)) ]
  in
  let local_env = rest_binding @ param_bindings @ env in
  match (match return_hint with Some expected -> check_expr local_env body expected | None -> infer_expr local_env body) with
  | Error _ as error -> error
  | Ok (body_subst, body_ty) ->
      Ok
        ( body_subst,
          (let params=List.map (apply_subst body_subst) param_tys and result=apply_subst body_subst body_ty in
           match rest_param with None -> TFn (params,result) | Some _ -> TVariadicFn (params,apply_subst body_subst rest_ty,result)) )

and check_expr env value expected =
  let finish (subst,actual) = match assign (apply_subst subst actual) (apply_subst subst expected) with Error _ as e -> e | Ok s -> let subst=compose_subst s subst in Ok (subst,apply_subst subst expected) in
  let result = match value,expected with
  | _,TVar _ -> (match infer_expr env value with Error _ as e -> e | Ok result -> finish result)
  | Core_ast.Lit (_,lit),expected ->
      let precise=match lit with Core_ast.LInt n -> TNamed (string_of_int n) | Core_ast.LFloat n -> TNamed (string_of_float n) | Core_ast.LString s -> TNamed (Value.string_json s) | Core_ast.LQuoted _ -> TSyntax | Core_ast.LSymbol _ -> TSymbol | Core_ast.LKeyword s -> TNamed s | Core_ast.LBool b -> TNamed (string_of_bool b) | Core_ast.LNil -> TNil in
      (match assign precise expected with Ok s -> Ok (s,apply_subst s expected) | Error _ -> (match infer_expr env value with Error _ as e -> e | Ok result -> finish result))
  | Core_ast.Lam (_,params,rest,body),(TFn _ | TVariadicFn _) -> (match infer_lambda ~expected env params rest body with Error _ as e -> e | Ok result -> finish result)
  | Core_ast.App (_, Core_ast.Var (_,"__dictionary"), [Core_ast.Record (_,fields)]), TNamedApp ("Map",[key;item]) ->
      let rec loop subst = function
        | [] -> Ok (subst,apply_subst subst expected)
        | (field:Core_ast.field) :: rest ->
            let label=field.label in
            let literal=if String.starts_with ~prefix:":" label then TNamed label else TNamed (Value.string_json (if String.starts_with ~prefix:"\000str:" label then String.sub label 5 (String.length label-5) else label)) in
            (match assign literal (apply_subst subst key) with Error _ as e -> e | Ok ks ->
              let subst=compose_subst ks subst in
              match check_expr (apply_subst_env subst env) field.value (apply_subst subst item) with Error _ as e -> e | Ok (s,_) -> loop (compose_subst s subst) rest) in
      loop [] fields
  | Core_ast.Record (_,fields),(TRecord expected_fields | TOpenRecord (expected_fields,_)) ->
      let rec loop subst acc = function [] -> finish (subst,TRecord acc) | (field:Core_ast.field) :: rest ->
        let inferred=match List.assoc_opt field.label expected_fields with Some t -> check_expr (apply_subst_env subst env) field.value (apply_subst subst t) | None -> infer_expr (apply_subst_env subst env) field.value in
        match inferred with Error _ as e -> e | Ok (s,t) -> loop (compose_subst s subst) ((field.label,t) :: acc) rest in loop [] [] fields
  | Core_ast.If (_,condition,yes,no),expected -> (match check_expr env condition TBool with Error _ as e -> e | Ok (s,_) -> match check_expr (apply_subst_env s env) yes expected with Error _ as e -> e | Ok (ys,_) -> let subst=compose_subst ys s in match check_expr (apply_subst_env subst env) no (apply_subst subst expected) with Error _ as e -> e | Ok (ns,t) -> Ok (compose_subst ns subst,t))
  | _ -> (match infer_expr env value with Error _ as e -> e | Ok result -> finish result)

  in Result.map_error (Type_diagnostic.with_span (Core_ast.expr_span value)) result

and infer_definition env _name signature value =
  match signature with None -> infer_expr env value | Some signature -> (match Type_resolve.resolve_polymorphic env signature with Error _ as e -> e | Ok (env,expected) -> check_expr env value expected)

and infer_ascription env value type_expr =
  match Type_resolve.resolve env type_expr with Error _ as e -> e | Ok expected -> check_expr env value expected

let typed_analysis_callbacks =
  Typed_analysis.{ infer_expr; check_expr; pattern_bindings = Typed_match.pattern_bindings }

let infer_toplevel_core env expr =
  Typed_analysis.infer_toplevel_core typed_analysis_callbacks env expr

let annotate_expr env expr =
  Typed_analysis.annotate_expr typed_analysis_callbacks env expr

let infer_core_expr env expr =
  Type_env.with_pending_reset (fun () ->
      match infer_expr env expr with
      | Error _ as error -> error
      | Ok (subst, ty) -> Type_env.discharge_and_apply env subst ty)

let typecheck_core_program_typed_with_descriptor_infer
    (descriptor_hooks : Descriptor_protocol.descriptor_hooks) env program =
  Typed_program.typecheck_with_descriptor_hooks
    { infer_toplevel_core; annotate_expr }
    descriptor_hooks env program

let typecheck_program_with_env env exprs =
  try Type_env.with_pending_reset (fun () ->
      Typed_toplevel.typecheck_program_with_env
        Typed_toplevel.{ infer_toplevel_core; infer_core_expr }
        env (Surface.type_program (Surface_form.program exprs)))
  with Constructor_scope.Ambiguous (span,message) -> Error [Type_diagnostic.make ~span "surface/ambiguous-constructor" message]

let typecheck_program_with_env_all env exprs =
  try Type_env.with_pending_reset (fun () ->
      Typed_toplevel.typecheck_program_with_env_all
        Typed_toplevel.{ infer_toplevel_core; infer_core_expr }
        env (Surface.type_program (Surface_form.program exprs)))
  with Constructor_scope.Ambiguous (span,message) -> Error [Type_diagnostic.make ~span "surface/ambiguous-constructor" message]

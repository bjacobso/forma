type diagnostic = Type_diagnostic.t
type env = Type_env.env

type callbacks = {
  infer_expr :
    env ->
    Core_ast.expr ->
    (Type_expr.subst * Type_expr.ty, diagnostic list) result;
  check_expr : env -> Core_ast.expr -> Type_expr.ty -> (Type_expr.subst * Type_expr.ty, diagnostic list) result;
  pattern_bindings : Core_ast.pattern -> env;
}

let infer_toplevel_core callbacks env expr =
  match expr with
  | Core_ast.TypeDef (_, name, Some type_expr) -> (
      match Type_resolve.resolve env type_expr with
      | Error _ as error -> error
      | Ok (Type_expr.TNamedApp ("Brand", [base])) ->
          let branded = Type_expr.TNamedApp ("Brand", [Type_expr.TNamed name;base]) in
          let plain t = Type_env.Forall ([],t,[],Type_env.Plain) in
          Ok (Type_expr.TDeclaration, env |> Type_env.bind ("__type/" ^ name) (plain branded) |> Type_env.bind name (plain (Type_expr.TFn ([base],branded))))
      | Ok ty ->
          Ok (Type_expr.TDeclaration, Type_env.bind name (Type_env.Forall ([], ty, [], Type_env.Plain)) env))
  | Core_ast.TypeDef (_, name, None) ->
      Ok
        ( Type_expr.TDeclaration,
          Type_env.bind name
            (Type_env.Forall ([], Type_expr.TAny, [], Type_env.Plain))
            env )
  | Core_ast.Def (_, name, signature, value) ->
      let expected = match signature with None -> Ok (env,None) | Some t -> Type_resolve.resolve_polymorphic env t |> Result.map (fun (env,t)->env,Some t) in
      (match expected with Error _ as e -> e | Ok (signature_env,expected) ->
        let recursive_ty = Option.value ~default:(Type_expr.fresh_tyvar ()) expected in
        let recursive_env = Type_env.bind name (Type_env.Forall ([],recursive_ty,[],Type_env.Plain)) signature_env in
        let pending_start = Type_env.pending_constraints_count () in
        let inferred = match expected with Some t -> callbacks.check_expr recursive_env value t | None -> callbacks.infer_expr recursive_env value in
        match inferred with Error _ as e -> e | Ok (subst,ty) ->
          match Type_unify.unify (Type_expr.apply_subst subst recursive_ty) (Type_expr.apply_subst subst ty) with
          | Error _ as e -> e | Ok recursive_subst ->
            let subst = Type_expr.compose_subst recursive_subst subst in
            let ty = Type_expr.apply_subst subst ty in
            let env = Type_env.apply_subst_env subst env in
            Ok (ty,Type_env.bind name (Type_env.generalize_binding env ty pending_start) env))
  | _ -> (
      match callbacks.infer_expr env expr with
      | Error _ as error -> error
      | Ok (subst, ty) -> Ok (ty, Type_env.apply_subst_env subst env))

let rec annotate_expr callbacks env expr =
  match callbacks.infer_expr env expr with
  | Error _ as error -> error
  | Ok (subst, ty) -> (
      let ty = Type_expr.apply_subst subst ty in
      let env = Type_env.apply_subst_env subst env in
      let root = Typed_core.annotation expr ty in
      match annotate_children callbacks env expr ty with
      | Error _ as error -> error
      | Ok children -> Ok (root :: children))

and annotate_children callbacks env expr ty =
  match expr with
  | Core_ast.Lit _ | Core_ast.Var _ | Core_ast.TypeDef _ -> Ok []
  | Core_ast.Lam (_, params, rest_param, body) ->
      annotate_lambda_body callbacks env ty params rest_param body
  | Core_ast.App (_, callee, args) -> (
      match
        ( annotate_callee callbacks env callee,
          annotate_expr_list callbacks env args )
      with
      | Error diagnostics, _ | _, Error diagnostics -> Error diagnostics
      | Ok callee_annotations, Ok arg_annotations ->
          Ok (callee_annotations @ arg_annotations))
  | Core_ast.Let (_, bindings, body) -> (
      match annotate_let_bindings callbacks env bindings with
      | Error _ as error -> error
      | Ok (binding_annotations, env) -> (
          match annotate_expr callbacks env body with
          | Error _ as error -> error
          | Ok body_annotations -> Ok (binding_annotations @ body_annotations)))
  | Core_ast.EffectDo (_, bindings, body) -> (
      match annotate_effect_bindings callbacks env bindings with
      | Error _ as error -> error
      | Ok (binding_annotations, env) -> (
          match annotate_expr callbacks env body with
          | Error _ as error -> error
          | Ok body_annotations -> Ok (binding_annotations @ body_annotations)))
  | Core_ast.EffectFail (_, _, payload) -> annotate_expr callbacks env payload
  | Core_ast.EffectCatch (_, body, error_name, binding, handler) -> (
      match annotate_expr callbacks env body with
      | Error _ as error -> error
      | Ok body_annotations ->
          let error_ty = Option.value (Type_env.lookup error_name env) ~default:Type_expr.TAny in
          let handler_env =
            Type_env.bind binding.name
              (Type_env.Forall ([], error_ty, [], Type_env.Plain))
              env
          in
          (match annotate_expr callbacks handler_env handler with
          | Error _ as error -> error
          | Ok handler_annotations -> Ok (body_annotations @ handler_annotations)))
  | Core_ast.If (_, condition, consequent, alternate) ->
      annotate_expr_list callbacks env [ condition; consequent; alternate ]
  | Core_ast.Record (_, fields) ->
      fields
      |> List.map (fun (field : Core_ast.field) -> field.value)
      |> annotate_expr_list callbacks env
  | Core_ast.Get (_, record, _) -> annotate_expr callbacks env record
  | Core_ast.Def (_, _, Some _, value)
  | Core_ast.Ascribe (_, value, _) -> annotate_checked_expr callbacks env value ty
  | Core_ast.Def (_, _, None, value) -> annotate_expr callbacks env value
  | Core_ast.Match (_, scrutinee, arms) -> (
      match annotate_expr callbacks env scrutinee with
      | Error _ as error -> error
      | Ok scrutinee_annotations -> (
          match annotate_match_arms callbacks env arms with
          | Error _ as error -> error
          | Ok arm_annotations -> Ok (scrutinee_annotations @ arm_annotations)))
  | Core_ast.DslForm (_, form) ->
      form.children
      |> List.map (fun (child : Core_ast.dsl_child) -> child.expr)
      |> annotate_expr_list callbacks env

and annotate_checked_expr callbacks env expr expected =
  match callbacks.check_expr env expr expected with
  | Error _ as error -> error
  | Ok (subst, ty) ->
      let ty = Type_expr.apply_subst subst ty in
      let env = Type_env.apply_subst_env subst env in
      (match annotate_children callbacks env expr ty with
       | Error _ as error -> error
       | Ok children -> Ok (Typed_core.annotation expr ty :: children))

and annotate_lambda_body callbacks env ty params rest_param body =
  let param_tys =
    match ty with
    | Type_expr.TFn (param_tys, _)
    | Type_expr.TVariadicFn (param_tys,_,_)
      when List.length param_tys = List.length params ->
        param_tys
    | _ -> List.map (fun _ -> Type_expr.TAny) params
  in
  let param_bindings =
    List.map2
      (fun (param : Core_ast.param) ty ->
        (param.name, Type_env.Forall ([], ty, [], Type_env.Plain)))
      params param_tys
  in
  let rest_binding =
    match rest_param with
    | None -> []
    | Some (param : Core_ast.param) ->
        [
          ( param.name,
            Type_env.Forall
              ([], Type_expr.TList (match ty with Type_expr.TVariadicFn (_,rest,_) -> rest | _ -> Type_expr.TAny), [], Type_env.Plain) );
        ]
  in
  annotate_expr callbacks (rest_binding @ param_bindings @ env) body

and annotate_callee callbacks env callee =
  match callee with
  | Core_ast.Var (_, name) ->
      let ty, symbol =
        match Type_env.lookup name env with
        | Some ty -> (ty, Typed_core.symbol "reference" name)
        | None -> (Type_expr.TAny, Typed_core.symbol "builtin" name)
      in
      Ok [ Typed_core.annotation ~symbol callee ty ]
  | _ -> annotate_expr callbacks env callee

and annotate_expr_list callbacks env exprs =
  let rec loop acc = function
    | [] -> Ok (List.rev acc)
    | expr :: rest -> (
        match annotate_expr callbacks env expr with
        | Error _ as error -> error
        | Ok annotations -> loop (List.rev_append annotations acc) rest)
  in
  loop [] exprs

and annotate_let_bindings callbacks env bindings =
  let rec loop env acc = function
    | [] -> Ok (List.rev acc, env)
    | (binding : Core_ast.binding) :: rest -> (
        let pending_start = Type_env.pending_constraints_count () in
        match
          ( callbacks.infer_expr env binding.expr,
            annotate_expr callbacks env binding.expr )
        with
        | Error diagnostics, _ | _, Error diagnostics -> Error diagnostics
        | Ok (subst, ty), Ok annotations ->
            let env = Type_env.apply_subst_env subst env in
            let ty = Type_expr.apply_subst subst ty in
            let env =
              Type_env.bind binding.name
                (Type_env.generalize_binding env ty pending_start)
                env
            in
            loop env (List.rev_append annotations acc) rest)
  in
  loop env [] bindings

and effect_success_type = function
  | Type_expr.TNamedApp ("Effect", [ success; _; _ ])
  | Type_expr.TApp (Type_expr.TNamed "Effect", [ success; _; _ ]) ->
      success
  | _ -> Type_expr.TAny

and annotate_effect_bindings callbacks env bindings =
  let rec loop env acc = function
    | [] -> Ok (List.rev acc, env)
    | (binding : Core_ast.binding) :: rest -> (
        match
          ( callbacks.infer_expr env binding.expr,
            annotate_expr callbacks env binding.expr )
        with
        | Error diagnostics, _ | _, Error diagnostics -> Error diagnostics
        | Ok (subst, ty), Ok annotations ->
            let env = Type_env.apply_subst_env subst env in
            let ty = Type_expr.apply_subst subst ty in
            let env =
              Type_env.bind binding.name
                (Type_env.Forall ([], effect_success_type ty, [], Type_env.Plain))
                env
            in
            loop env (List.rev_append annotations acc) rest)
  in
  loop env [] bindings

and annotate_match_arms callbacks env arms =
  let rec loop acc = function
    | [] -> Ok (List.rev acc)
    | (arm : Core_ast.match_arm) :: rest -> (
        let env = callbacks.pattern_bindings arm.pattern @ env in
        match annotate_expr callbacks env arm.body with
        | Error _ as error -> error
        | Ok annotations -> loop (List.rev_append annotations acc) rest)
  in
  loop [] arms

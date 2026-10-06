open Type_expr

type typeclass_constraint = { class_name : string; args : Type_expr.ty list }
type typeclass_method = { class_name : string; class_var_ids : int list }

type binding_info =
  | Plain
  | TypeclassMethod of typeclass_method
  | TypeclassInstance of { class_name : string; type_args : Type_expr.ty list }

type pending_constraint = {
  requirement : typeclass_constraint;
  span : Ast.span;
}

type scheme =
  | Forall of int list * ty * typeclass_constraint list * binding_info

type env = (string * scheme) list

let pending_constraints : pending_constraint list ref = ref []

let typeclass_instance_key class_name =
  Printf.sprintf "__typeclass_instance__:%s" class_name

let disabled_builtin_scheme_key = "__oo_disabled_builtin_scheme__"

let free_constraint ({ args; _ } : typeclass_constraint) =
  List.concat_map free_ty args |> List.sort_uniq Int.compare

let apply_subst_constraint subst ({ class_name; args } : typeclass_constraint) =
  { class_name; args = List.map (apply_subst subst) args }

let rec normalize_typeclass_instance_ty = function
  | TNamed "Vector" -> TNamed "List"
  | TNamedApp ("Vector", args) ->
      TNamedApp ("List", List.map normalize_typeclass_instance_ty args)
  | TList item -> TNamedApp ("List", [ normalize_typeclass_instance_ty item ])
  | TVector item -> TNamedApp ("List", [ normalize_typeclass_instance_ty item ])
  | TOpenRecord (fields,tail) -> TOpenRecord (List.map (fun (label,t)->label,normalize_typeclass_instance_ty t) fields,normalize_typeclass_instance_ty tail)
  | TRecord fields ->
      TRecord
        (List.map
           (fun (label, ty) -> (label, normalize_typeclass_instance_ty ty))
           fields)
  | TFn (params, result) ->
      TFn
        ( List.map normalize_typeclass_instance_ty params,
          normalize_typeclass_instance_ty result )
  | TVariadicFn (params, rest, result) ->
      TVariadicFn
        ( List.map normalize_typeclass_instance_ty params,
          normalize_typeclass_instance_ty rest,
          normalize_typeclass_instance_ty result )
  | TApp (callee, args) ->
      TApp
        ( normalize_typeclass_instance_ty callee,
          List.map normalize_typeclass_instance_ty args )
  | TNamedApp (name, args) ->
      TNamedApp (name, List.map normalize_typeclass_instance_ty args)
  | ty -> ty

let concrete_type = function TVar _ -> false | _ -> true

let concrete_constraint ({ args; _ } : typeclass_constraint) =
  List.for_all concrete_type args

let instance_matches expected_type_args actual_type_args =
  match
    Type_unify.unify_many
      (List.map normalize_typeclass_instance_ty expected_type_args)
      (List.map normalize_typeclass_instance_ty actual_type_args)
  with
  | Ok _ -> true
  | Error _ -> false

let free_scheme (Forall (vars, ty, constraints, _)) =
  (free_ty ty |> List.filter (fun var -> not (List.mem var vars)))
  @ (List.concat_map free_constraint constraints
    |> List.filter (fun var -> not (List.mem var vars)))
  |> List.sort_uniq Int.compare

let free_env env =
  env
  |> List.concat_map (fun (_, scheme) -> free_scheme scheme)
  |> List.sort_uniq Int.compare

let apply_subst_scheme subst (Forall (vars, ty, constraints, info)) =
  let subst = List.filter (fun (var, _) -> not (List.mem var vars)) subst in
  Forall
    ( vars,
      apply_subst subst ty,
      List.map (apply_subst_constraint subst) constraints,
      info )

let apply_subst_env subst env =
  List.map (fun (name, scheme) -> (name, apply_subst_scheme subst scheme)) env

let instantiate_with_subst (Forall (vars, ty, _, _)) =
  let subst = List.map (fun var -> (var, fresh_tyvar ())) vars in
  (apply_subst subst ty, subst)

let instantiate_with_subst_at span (Forall (vars, ty, constraints, _)) =
  let subst = List.map (fun var -> (var, fresh_tyvar ())) vars in
  let ty = apply_subst subst ty in
  let constraints = List.map (apply_subst_constraint subst) constraints in
  if constraints <> [] then
    pending_constraints :=
      !pending_constraints
      @ List.map (fun requirement -> { requirement; span }) constraints;
  (ty, subst)

let instantiate scheme = fst (instantiate_with_subst scheme)

let generalize env ty =
  let vars =
    free_ty ty
    |> List.filter (fun var -> not (List.mem var (free_env env)))
    |> List.sort_uniq Int.compare
  in
  Forall (vars, ty, [], Plain)

let pending_constraints_count () = List.length !pending_constraints
let reset_pending_constraints () = pending_constraints := []

let with_pending_reset f =
  reset_pending_constraints ();
  match f () with
  | Ok _ as ok ->
      reset_pending_constraints ();
      ok
  | Error _ as error ->
      reset_pending_constraints ();
      error

let generalize_binding env ty pending_start =
  let vars =
    free_ty ty
    |> List.filter (fun var -> not (List.mem var (free_env env)))
    |> List.sort_uniq Int.compare
  in
  let retained_pending, binding_pending =
    let rec split index acc = function
      | rest when index <= 0 -> (List.rev acc, rest)
      | [] -> (List.rev acc, [])
      | value :: rest -> split (index - 1) (value :: acc) rest
    in
    split pending_start [] !pending_constraints
  in
  if binding_pending = [] || vars = [] then Forall (vars, ty, [], Plain)
  else
    let uses_generalized_vars pending_constraint =
      List.exists
        (fun var -> List.mem var vars)
        (free_constraint pending_constraint.requirement)
    in
    let only_generalized_vars pending_constraint =
      List.for_all
        (fun var -> List.mem var vars)
        (free_constraint pending_constraint.requirement)
    in
    let scheme_constraints, deferred_pending =
      List.partition
        (fun pending_constraint ->
          uses_generalized_vars pending_constraint
          && only_generalized_vars pending_constraint)
        binding_pending
    in
    pending_constraints := retained_pending @ deferred_pending;
    Forall
      ( vars,
        ty,
        List.map
          (fun pending_constraint -> pending_constraint.requirement)
          scheme_constraints,
        Plain )

let lookup name env =
  match List.assoc_opt name env with
  | Some scheme -> Some (instantiate scheme)
  | None -> None

let lookup_scheme name env = List.assoc_opt name env

let builtins_enabled env =
  match lookup_scheme disabled_builtin_scheme_key env with
  | None -> true
  | Some _ -> false

let lookup_typeclass_method name env =
  match lookup_scheme name env with
  | Some (Forall (_, _, _, TypeclassMethod info)) -> Some info
  | _ -> None

let lookup_typeclass_instances class_name env =
  List.filter_map
    (function
      | _, Forall (_, _, _, TypeclassInstance info)
        when info.class_name = class_name ->
          Some info.type_args
      | _ -> None)
    env

let discharge_pending_constraints env subst =
  let env = apply_subst_env subst env in
  let diagnostics = ref [] in
  let retained = ref [] in
  let pending = !pending_constraints in
  List.iter
    (fun ({ requirement; span } as pending_constraint) ->
      let requirement = apply_subst_constraint subst requirement in
      let instances = lookup_typeclass_instances requirement.class_name env in
      if instances = [] then
        retained := { pending_constraint with requirement } :: !retained
      else if not (concrete_constraint requirement) then
        retained := { pending_constraint with requirement } :: !retained
      else if
        List.exists
          (fun instance_type_args ->
            instance_matches instance_type_args requirement.args)
          instances
      then ()
      else
        diagnostics :=
          Type_diagnostic.make ~span "typecheck/missing-instance"
            (Printf.sprintf "No instance found for %s %s."
               requirement.class_name
               (String.concat " " (List.map ty_to_string requirement.args)))
          :: !diagnostics)
    pending;
  pending_constraints := List.rev !retained;
  match List.rev !diagnostics with
  | [] -> Ok ()
  | diagnostics -> Error diagnostics

let discharge_and_return env subst value =
  match discharge_pending_constraints env subst with
  | Error _ as error -> error
  | Ok () -> Ok value

let discharge_and_apply env subst ty =
  discharge_and_return env subst (apply_subst subst ty)

let bind name scheme env = (name, scheme) :: env

let disable_builtins env =
  bind disabled_builtin_scheme_key (Forall ([], TNil, [], Plain)) env

let bind_typeclass_method name class_name class_var_ids
    (Forall (vars, ty, constraints, _)) env =
  bind name
    (Forall
       (vars, ty, constraints, TypeclassMethod { class_name; class_var_ids }))
    env

let bind_typeclass_instance class_name type_args env =
  bind
    (typeclass_instance_key class_name)
    (Forall ([], TDeclaration, [], TypeclassInstance { class_name; type_args }))
    env

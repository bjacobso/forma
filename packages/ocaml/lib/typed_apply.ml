type diagnostic = Type_diagnostic.t

open Type_expr
open Type_env
open Type_unify

type env = Type_env.env

type callbacks = {
  infer_expr : env -> Core_ast.expr -> (subst * ty, diagnostic list) result;
  check_expr : env -> Core_ast.expr -> ty -> (subst * ty, diagnostic list) result;
}

let diagnostic = Type_diagnostic.make

let rec infer_application callbacks env callee args =
  match callbacks.infer_expr env callee with
  | Error _ as error -> error
  | Ok (callee_subst, callee_ty) -> (
      match infer_apply callbacks env callee_subst callee_ty args with
      | Error _ as error -> error
      | Ok (subst, ty) ->
          Type_env.discharge_pending_constraints env subst
          |> Result.map (fun () -> (subst, ty)))

and infer_apply callbacks env initial_subst callee_ty args =
  let rec infer_args subst env acc = function
    | [] -> Ok (subst, List.rev acc)
    | arg :: rest -> (
        let expected=match apply_subst subst callee_ty with TFn (params,_) -> List.nth_opt params (List.length acc) | TVariadicFn (params,rest,_) -> Some (Option.value ~default:rest (List.nth_opt params (List.length acc))) | _ -> None in
        match (match expected with Some t -> callbacks.check_expr env arg t | None -> callbacks.infer_expr env arg) with
        | Error _ as error -> error
        | Ok (arg_subst, arg_ty) ->
            let subst = compose_subst arg_subst subst in
            infer_args subst
              (apply_subst_env subst env)
              (apply_subst subst arg_ty :: acc)
              rest)
  in
  match
    infer_args initial_subst (apply_subst_env initial_subst env) [] args
  with
  | Error _ as error -> error
  | Ok (subst, arg_tys) -> infer_apply_args subst callee_ty arg_tys

and infer_apply_args subst callee_ty arg_tys =
  match apply_subst subst callee_ty with
  | TFn (param_tys, result_ty) ->
      infer_known_function_apply subst param_tys result_ty arg_tys
  | TVariadicFn (param_tys, rest_ty, result_ty) ->
      infer_known_variadic_function_apply subst param_tys rest_ty result_ty
        arg_tys
  | callee_ty -> (
      let result_ty = fresh_tyvar () in
      match unify callee_ty (TFn (arg_tys, result_ty)) with
      | Error _ as error -> error
      | Ok unify_subst ->
          let subst = compose_subst unify_subst subst in
          Ok (subst, apply_subst subst result_ty))

and infer_known_function_apply subst param_tys result_ty arg_tys =
  let rec split count acc values =
    match (count, values) with
    | 0, rest -> Ok (List.rev acc, rest)
    | _, [] -> Error [ diagnostic "typecheck/arity" "Arity mismatch." ]
    | n, value :: rest -> split (n - 1) (value :: acc) rest
  in
  let arg_count = List.length arg_tys in
  let param_count = List.length param_tys in
  if arg_count > param_count then
    Error
      [
        diagnostic "typecheck/arity"
          (Printf.sprintf "Function expects %d arguments, received %d."
             param_count arg_count);
      ]
  else
    match split arg_count [] param_tys with
    | Error _ as error -> error
    | Ok (provided_param_tys, remaining_param_tys) -> (
        match assign_many arg_tys provided_param_tys with
        | Error _ as error -> error
        | Ok unify_subst ->
            let subst = compose_subst unify_subst subst in
            let remaining_param_tys =
              List.map (apply_subst subst) remaining_param_tys
            in
            let result_ty = apply_subst subst result_ty in
            let ty =
              match remaining_param_tys with
              | [] -> result_ty
              | _ -> TFn (remaining_param_tys, result_ty)
            in
            Ok (subst, ty))

and infer_known_variadic_function_apply subst param_tys rest_ty result_ty
    arg_tys =
  let rec split count acc values =
    match (count, values) with
    | 0, rest -> Ok (List.rev acc, rest)
    | _, [] -> Error [ diagnostic "typecheck/arity" "Arity mismatch." ]
    | n, value :: rest -> split (n - 1) (value :: acc) rest
  in
  let arg_count = List.length arg_tys in
  let param_count = List.length param_tys in
  if arg_count < param_count then
    match split arg_count [] param_tys with
    | Error _ as error -> error
    | Ok (provided_param_tys, remaining_param_tys) -> (
        match assign_many arg_tys provided_param_tys with
        | Error _ as error -> error
        | Ok unify_subst ->
            let subst = compose_subst unify_subst subst in
            Ok
              ( subst,
                TVariadicFn
                  ( List.map (apply_subst subst) remaining_param_tys,
                    apply_subst subst rest_ty,
                    apply_subst subst result_ty ) ))
  else
    let extra_count = arg_count - param_count in
    let expected_arg_tys =
      param_tys @ List.init extra_count (fun _ -> rest_ty)
    in
    match assign_many arg_tys expected_arg_tys with
    | Error _ as error -> error
    | Ok unify_subst ->
        let subst = compose_subst unify_subst subst in
        Ok (subst, apply_subst subst result_ty)

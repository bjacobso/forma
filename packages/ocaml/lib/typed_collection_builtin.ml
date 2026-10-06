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

let infer_collection callbacks env wrap items =
  let rec loop subst env item_ty = function
    | [] -> Ok (subst, wrap (apply_subst subst item_ty))
    | item :: rest -> (match callbacks.infer_expr env item with Error _ as e -> e | Ok (s,ty) ->
        let subst=compose_subst s subst in
        match join (apply_subst subst item_ty) (apply_subst subst ty) with Error _ as e -> e | Ok (s,joined) ->
          let subst=compose_subst s subst in loop subst (apply_subst_env subst env) joined rest) in
  loop [] env (fresh_tyvar ()) items

let collection_item subst collection_ty =
  match apply_subst subst collection_ty with
  | TList item -> Ok (subst, `List, apply_subst subst item)
  | TVector item -> Ok (subst, `Vector, apply_subst subst item)
  | TAny -> Ok (subst, `List, TAny)
  | TVar _ as collection_var -> (
      let item_ty = fresh_tyvar () in
      match unify collection_var (TList item_ty) with
      | Error _ as error -> error
      | Ok collection_subst ->
          let subst = compose_subst collection_subst subst in
          Ok (subst, `List, apply_subst subst item_ty))
  | other ->
      Error
        [
          diagnostic "typecheck/type-mismatch"
            (Printf.sprintf "Expected List, received %s." (ty_to_string other));
        ]

let item_type_of_collection subst collection_ty =
  match collection_item subst collection_ty with
  | Error _ as error -> error
  | Ok (_, _, item_ty) -> Ok item_ty

let wrap_collection kind item =
  match kind with `List -> TList item | `Vector -> TVector item

let infer_first callbacks env = function
  | [ collection ] -> (
      match callbacks.infer_expr env collection with
      | Error _ as error -> error
      | Ok (collection_subst, collection_ty) -> (
          match item_type_of_collection collection_subst collection_ty with
          | Error _ as error -> error
          | Ok item_ty -> Ok (collection_subst, item_ty)))
  | _ -> Error [ diagnostic "typecheck/arity" "first expects one argument." ]

let infer_count callbacks env = function
  | [ collection ] -> (match callbacks.infer_expr env collection with
      | Error _ as error -> error
      | Ok (subst,ty) -> (match apply_subst subst ty with
          | TRecord _ | TOpenRecord _ | TString -> Ok (subst,TInt)
          | _ -> match collection_item subst ty with Error _ as error -> error | Ok (subst,_,_) -> Ok (subst,TInt)))
  | _ -> Error [ diagnostic "typecheck/arity" "count expects one argument." ]

let infer_nth callbacks env = function
  | [ collection; index ] -> (
      match callbacks.infer_expr env collection with
      | Error _ as error -> error
      | Ok (collection_subst, collection_ty) -> (
          let env = apply_subst_env collection_subst env in
          match callbacks.infer_expr env index with
          | Error _ as error -> error
          | Ok (index_subst, index_ty) -> (
              let subst = compose_subst index_subst collection_subst in
              match unify (apply_subst subst index_ty) TInt with
              | Error _ as error -> error
              | Ok index_unify_subst -> (
                  let subst = compose_subst index_unify_subst subst in
                  match item_type_of_collection subst collection_ty with
                  | Error _ as error -> error
                  | Ok item_ty -> Ok (subst, item_ty)))))
  | _ -> Error [ diagnostic "typecheck/arity" "nth expects two arguments." ]

let infer_rest callbacks env = function
  | [ collection ] -> (
      match callbacks.infer_expr env collection with
      | Error _ as error -> error
      | Ok (collection_subst, collection_ty) -> (
          match collection_item collection_subst collection_ty with
          | Error _ as error -> error
          | Ok (subst, kind, item) -> Ok (subst, wrap_collection kind item)))
  | _ -> Error [ diagnostic "typecheck/arity" "rest expects one argument." ]

let function_candidate = function TFn _ | TAny | TVar _ -> true | _ -> false

let infer_higher_order_args callbacks env op args =
  match args with
  | [ (Core_ast.Lam _ as fn); collection ]
  | [ collection; (Core_ast.Lam _ as fn) ] -> (
      match callbacks.infer_expr env collection with
      | Error _ as error -> error
      | Ok (subst, collection_ty) -> (
          match collection_item subst collection_ty with
          | Error _ as error -> error
          | Ok (subst, _, item_ty) -> (
              match callbacks.check_expr (apply_subst_env subst env) fn (TFn ([item_ty], fresh_tyvar ())) with
              | Error _ as error -> error
              | Ok (fn_subst, fn_ty) -> Ok (compose_subst fn_subst subst, fn_ty, collection_ty))))
  | [ left; right ] -> (
      match callbacks.infer_expr env left with
      | Error _ as error -> error
      | Ok (left_subst, left_ty) -> (
          let env = apply_subst_env left_subst env in
          match callbacks.infer_expr env right with
          | Error _ as error -> error
          | Ok (right_subst, right_ty) ->
              let subst = compose_subst right_subst left_subst in
              let left_ty = apply_subst subst left_ty in
              let right_ty = apply_subst subst right_ty in
              if function_candidate left_ty then Ok (subst, left_ty, right_ty)
              else if function_candidate right_ty then
                Ok (subst, right_ty, left_ty)
              else
                Error
                  [
                    diagnostic "typecheck/type-mismatch"
                      (op ^ " expects a function and a list or vector.");
                  ]))
  | _ ->
      Error
        [
          diagnostic "typecheck/arity"
            (op ^ " expects exactly two arguments: function and collection.");
        ]

let infer_map callbacks env op args =
  match infer_higher_order_args callbacks env op args with
  | Error _ as error -> error
  | Ok (subst, fn_ty, collection_ty) -> (
      match collection_item subst collection_ty with
      | Error _ as error -> error
      | Ok (subst, kind, item_ty) -> (
          let result_ty = fresh_tyvar () in
          match unify fn_ty (TFn ([ item_ty ], result_ty)) with
          | Error _ as error -> error
          | Ok fn_subst ->
              let subst = compose_subst fn_subst subst in
              Ok (subst, wrap_collection kind (apply_subst subst result_ty))))

let infer_filter callbacks env op args =
  match infer_higher_order_args callbacks env op args with
  | Error _ as error -> error
  | Ok (subst, fn_ty, collection_ty) -> (
      match collection_item subst collection_ty with
      | Error _ as error -> error
      | Ok (subst, kind, item_ty) -> (
          match unify fn_ty (TFn ([ item_ty ], TAny)) with
          | Error _ as error -> error
          | Ok fn_subst ->
              let subst = compose_subst fn_subst subst in
              Ok (subst, wrap_collection kind (apply_subst subst item_ty))))

let infer_flat_map callbacks env op args =
  match infer_higher_order_args callbacks env op args with
  | Error _ as error -> error
  | Ok (subst, fn_ty, collection_ty) -> (
      match collection_item subst collection_ty with
      | Error _ as error -> error
      | Ok (subst, kind, item_ty) -> (
          let result_item_ty = fresh_tyvar () in
          let result_collection_ty = fresh_tyvar () in
          match unify fn_ty (TFn ([ item_ty ], result_collection_ty)) with
          | Error _ as error -> error
          | Ok fn_subst -> (
              let subst = compose_subst fn_subst subst in
              match collection_item subst result_collection_ty with
              | Error _ as error -> error
              | Ok (_, _, mapper_item_ty) -> (
                  match
                    unify
                      (apply_subst subst result_item_ty)
                      (apply_subst subst mapper_item_ty)
                  with
                  | Error _ as error -> error
                  | Ok item_subst ->
                      let subst = compose_subst item_subst subst in
                      Ok
                        ( subst,
                          wrap_collection kind
                            (apply_subst subst result_item_ty) )))))

let infer_append_result subst left_ty right_ty =
  match (apply_subst subst left_ty, apply_subst subst right_ty) with
  | TList left_item, TList right_item -> (
      match unify left_item right_item with
      | Error _ as error -> error
      | Ok item_subst ->
          let subst = compose_subst item_subst subst in
          Ok (subst, TList (apply_subst subst left_item)))
  | TVector left_item, TVector right_item -> (
      match unify left_item right_item with
      | Error _ as error -> error
      | Ok item_subst ->
          let subst = compose_subst item_subst subst in
          Ok (subst, TVector (apply_subst subst left_item)))
  | TAny, _ | _, TAny -> Ok (subst, TList TAny)
  | left, right ->
      Error
        [
          diagnostic "typecheck/type-mismatch"
            (Printf.sprintf "Expected %s to match %s." (ty_to_string left)
               (ty_to_string right));
        ]

let infer_append callbacks env = function
  | [ left; right ] -> (
      match callbacks.infer_expr env left with
      | Error _ as error -> error
      | Ok (left_subst, left_ty) -> (
          let env = apply_subst_env left_subst env in
          match callbacks.infer_expr env right with
          | Error _ as error -> error
          | Ok (right_subst, right_ty) ->
              let subst = compose_subst right_subst left_subst in
              infer_append_result subst left_ty right_ty))
  | _ -> Error [ diagnostic "typecheck/arity" "append expects two arguments." ]

let infer_concat_strings callbacks env args =
  let rec loop subst env = function
    | [] -> Ok (subst, TString)
    | expr :: rest -> (
        match callbacks.infer_expr env expr with
        | Error _ as error -> error
        | Ok (expr_subst, ty) -> (
            let subst = compose_subst expr_subst subst in
            match unify (apply_subst subst ty) TString with
            | Error _ as error -> error
            | Ok string_subst ->
                let subst = compose_subst string_subst subst in
                loop subst (apply_subst_env subst env) rest))
  in
  loop [] env args

let infer_concat_collections callbacks env args =
  let item_ty = fresh_tyvar () in
  let rec loop subst env = function
    | [] -> Ok (subst, TList (apply_subst subst item_ty))
    | expr :: rest -> (
        match callbacks.infer_expr env expr with
        | Error _ as error -> error
        | Ok (expr_subst, collection_ty) -> (
            let subst = compose_subst expr_subst subst in
            match collection_item subst collection_ty with
            | Error _ as error -> error
            | Ok (subst, _, collection_item_ty) -> (
                match
                  unify
                    (apply_subst subst collection_item_ty)
                    (apply_subst subst item_ty)
                with
                | Error _ as error -> error
                | Ok item_subst ->
                    let subst = compose_subst item_subst subst in
                    loop subst (apply_subst_env subst env) rest)))
  in
  loop [] env args

let infer_concat callbacks env args =
  match infer_concat_strings callbacks env args with
  | Ok _ as ok -> ok
  | Error _ -> infer_concat_collections callbacks env args

let infer_reduce_with subst fn_ty initial_ty collection_ty =
  match collection_item subst collection_ty with
  | Error _ as error -> error
  | Ok (subst, _, item_ty) -> (
      let acc_ty = apply_subst subst initial_ty in
      let result_ty = fresh_tyvar () in
      match unify fn_ty (TFn ([ acc_ty; item_ty ], result_ty)) with
      | Error _ as error -> error
      | Ok fn_subst ->
          let subst = compose_subst fn_subst subst in
          let result_ty = apply_subst subst result_ty in
          match unify (apply_subst subst acc_ty) result_ty with
          | Error _ as error -> error
          | Ok acc_subst ->
              let subst = compose_subst acc_subst subst in
              Ok (subst, apply_subst subst result_ty))

let infer_reduce_result subst first_ty initial_ty third_ty =
  let first_ty = apply_subst subst first_ty in
  let third_ty = apply_subst subst third_ty in
  if function_candidate first_ty then
    infer_reduce_with subst first_ty initial_ty third_ty
  else if function_candidate third_ty then
    infer_reduce_with subst third_ty initial_ty first_ty
  else
    Error
      [
        diagnostic "typecheck/type-mismatch"
          "reduce expects a function, initial value, and list or vector.";
      ]

let infer_reduce callbacks env = function
  | [ (Core_ast.Lam _ as fn); initial; collection ]
  | [ collection; initial; (Core_ast.Lam _ as fn) ] -> (
      match callbacks.infer_expr env initial with
      | Error _ as error -> error
      | Ok (subst, initial_ty) -> (
          match callbacks.infer_expr (apply_subst_env subst env) collection with
          | Error _ as error -> error
          | Ok (s, collection_ty) ->
              let subst = compose_subst s subst in
              match collection_item subst collection_ty with
              | Error _ as error -> error
              | Ok (subst, _, item_ty) ->
                  let acc_ty = apply_subst subst initial_ty in
                  match callbacks.check_expr (apply_subst_env subst env) fn (TFn ([acc_ty; item_ty], acc_ty)) with
                  | Error _ as error -> error
                  | Ok (s, fn_ty) -> infer_reduce_with (compose_subst s subst) fn_ty acc_ty collection_ty))
  | [ first; initial; third ] -> (
      match callbacks.infer_expr env first with
      | Error _ as error -> error
      | Ok (first_subst, first_ty) -> (
          let env = apply_subst_env first_subst env in
          match callbacks.infer_expr env initial with
          | Error _ as error -> error
          | Ok (initial_subst, initial_ty) -> (
              let subst = compose_subst initial_subst first_subst in
              let env = apply_subst_env subst env in
              match callbacks.infer_expr env third with
              | Error _ as error -> error
              | Ok (third_subst, third_ty) ->
                  let subst = compose_subst third_subst subst in
                  infer_reduce_result subst first_ty initial_ty third_ty)))
  | _ ->
      Error
        [
          diagnostic "typecheck/arity"
            "reduce expects a function, initial value, and list or vector.";
        ]

let rec infer_conj_values callbacks subst env kind item_ty = function
  | [] -> Ok (subst, wrap_collection kind (apply_subst subst item_ty))
  | value :: rest -> (
      match callbacks.infer_expr env value with
      | Error _ as error -> error
      | Ok (value_subst, value_ty) -> (
          let subst = compose_subst value_subst subst in
          match
            unify (apply_subst subst value_ty) (apply_subst subst item_ty)
          with
          | Error _ as error -> error
          | Ok item_subst ->
              let subst = compose_subst item_subst subst in
              infer_conj_values callbacks subst
                (apply_subst_env subst env)
                kind item_ty rest))

let infer_conj callbacks env = function
  | collection :: values -> (
      match callbacks.infer_expr env collection with
      | Error _ as error -> error
      | Ok (collection_subst, collection_ty) -> (
          match collection_item collection_subst collection_ty with
          | Error _ as error -> error
          | Ok (subst, kind, item_ty) ->
              infer_conj_values callbacks subst
                (apply_subst_env subst env)
                kind item_ty values))
  | [] ->
      Error
        [
          diagnostic "typecheck/arity"
            "conj expects a list or vector followed by values.";
        ]

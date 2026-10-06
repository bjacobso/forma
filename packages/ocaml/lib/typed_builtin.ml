type diagnostic = Type_diagnostic.t

open Type_expr
open Type_env
open Type_unify

type env = Type_env.env

type callbacks = {
  infer_expr : env -> Core_ast.expr -> (subst * ty, diagnostic list) result;
  infer_apply :
    env ->
    subst ->
    ty ->
    Core_ast.expr list ->
    (subst * ty, diagnostic list) result;
}

let diagnostic = Type_diagnostic.make
let env_lookup = Type_env.lookup

let unary_list_type result_builder =
  let item_ty = fresh_tyvar () in
  TFn ([ TList item_ty ], result_builder item_ty)

let map_type () =
  let item_ty = fresh_tyvar () in
  let result_ty = fresh_tyvar () in
  TFn ([ TFn ([ item_ty ], result_ty); TList item_ty ], TList result_ty)

let filter_type () =
  let item_ty = fresh_tyvar () in
  TFn ([ TFn ([ item_ty ], TAny); TList item_ty ], TList item_ty)

let flat_map_type () =
  let item_ty = fresh_tyvar () in
  let result_ty = fresh_tyvar () in
  TFn ([ TFn ([ item_ty ], TList result_ty); TList item_ty ], TList result_ty)

let nth_type () =
  let item_ty = fresh_tyvar () in
  TFn ([ TList item_ty; TInt ], item_ty)

let builtin_value_type = function
  | "Some" | "Option.Some" -> let a=fresh_tyvar () in Some (TFn ([a],TNamedApp ("Option",[a])))
  | "None" | "Option.None" -> Some (TNamedApp ("Option",[fresh_tyvar ()]))
  | "Ok" | "Result.Ok" -> let a=fresh_tyvar () and e=fresh_tyvar () in Some (TFn ([a],TNamedApp ("Result",[a;e])))
  | "Err" | "Result.Err" -> let a=fresh_tyvar () and e=fresh_tyvar () in Some (TFn ([e],TNamedApp ("Result",[a;e])))
  | "starts-with?" | "ends-with?" -> Some (TFn ([TString;TString],TBool))
  | "upper" | "lower" | "trim" -> Some (TFn ([TString],TString))
  | "split" -> Some (TFn ([TString;TString],TList TString))
  | "map" | "list/map" -> Some (map_type ())
  | "filter" | "list/filter" -> Some (filter_type ())
  | "flat-map" | "list/flat-map" -> Some (flat_map_type ())
  | "count" -> Some (unary_list_type (fun _ -> TInt))
  | "first" -> Some (unary_list_type Fun.id)
  | "rest" -> Some (unary_list_type (fun item_ty -> TList item_ty))
  | "nth" -> Some (nth_type ())
  | _ -> None

let typed_record_callbacks (callbacks : callbacks) :
    Typed_record_builtin.callbacks =
  Typed_record_builtin.{ infer_expr = callbacks.infer_expr }

let infer_sequence callbacks env exprs =
  let rec loop subst env last = function
    | [] -> Ok (subst, apply_subst subst last)
    | expr :: rest -> (
        match callbacks.infer_expr env expr with
        | Error _ as error -> error
        | Ok (expr_subst, ty) ->
            let subst = compose_subst expr_subst subst in
            loop subst (apply_subst_env subst env) ty rest)
  in
  loop [] env TNil exprs

let infer_unary callbacks env expected result = function
  | [ expr ] -> (
      match callbacks.infer_expr env expr with
      | Error _ as error -> error
      | Ok (subst, ty) -> (
          match unify (apply_subst subst ty) expected with
          | Error _ as error -> error
          | Ok unify_subst -> Ok (compose_subst unify_subst subst, result)))
  | _ -> Error [ diagnostic "typecheck/arity" "Expected one argument." ]

let infer_args_return callbacks env args result =
  match infer_sequence callbacks env args with
  | Error _ as error -> error
  | Ok (subst, _) -> Ok (subst, result)

let infer_numeric callbacks env op args =
  let rec loop subst env saw_float = function
    | [] -> Ok (subst, if op = "/" || saw_float then TFloat else TInt)
    | expr :: rest -> (
        match callbacks.infer_expr env expr with
        | Error _ as error -> error
        | Ok (expr_subst, ty) -> (
            let subst = compose_subst expr_subst subst in
            let ty = apply_subst subst ty in
            let numeric_ty = match ty with TFloat -> TFloat | _ -> TInt in
            match unify ty numeric_ty with
            | Error _ as error -> error
            | Ok unify_subst ->
                let subst = compose_subst unify_subst subst in
                loop subst
                  (apply_subst_env subst env)
                  (saw_float || numeric_ty = TFloat)
                  rest))
  in
  let arity = List.length args in
  if ((op = "/" && arity < 2) || (List.mem op ["-";"min";"max"] && arity < 1)
      || (List.mem op ["floor";"ceil";"round";"abs"] && arity <> 1) || (op = "mod" && arity <> 2)) then
    Error [diagnostic "typecheck/arity" ("Invalid argument count for " ^ op)]
  else loop [] env false args |> Result.map (fun (subst,t) -> subst, if List.mem op ["floor";"ceil";"round"] then TInt else t)

let infer_comparison callbacks env op args =
  match args with
  | [ left; right ] -> (
      match infer_numeric callbacks env op [ left; right ] with
      | Error _ as error -> error
      | Ok (subst, _) -> Ok (subst, TBool))
  | _ ->
      Error
        [
          diagnostic "typecheck/arity"
            (Printf.sprintf "%s expects exactly two arguments." op);
        ]

let infer_equality callbacks env = function
  | [ left; right ] -> (
      match (callbacks.infer_expr env left, callbacks.infer_expr env right) with
      | Error diagnostics, _ | _, Error diagnostics -> Error diagnostics
      | Ok (left_subst, left_ty), Ok (right_subst, right_ty) -> (
          let subst = compose_subst right_subst left_subst in
          match
            let rec keyword = function TKeyword -> true | TNamed n -> String.starts_with ~prefix:":" n | TNamedApp ("Union",members) -> List.for_all keyword members | _ -> false in
            let left=apply_subst subst left_ty and right=apply_subst subst right_ty in
            if keyword left && keyword right then Ok [] else unify left right
          with
          | Error _ as error -> error
          | Ok unify_subst -> Ok (compose_subst unify_subst subst, TBool)))
  | _ ->
      Error [ diagnostic "typecheck/arity" "= expects exactly two arguments." ]

let infer_builtin_application_fallback callbacks env op args =
  match op with
  | "Some" | "Option.Some" | "Ok" | "Result.Ok" | "Err" | "Result.Err" -> (match builtin_value_type op with Some t -> callbacks.infer_apply env [] t args | None -> assert false)
  | "quote" | "quasiquote" -> Ok ([], TSyntax)
  | "and" | "or" -> infer_args_return callbacks env args TAny
  | "not" -> infer_unary callbacks env TAny TBool args
  | "__vector" ->
      Typed_collection_builtin.infer_collection
        Typed_collection_builtin.{ infer_expr = callbacks.infer_expr }
        env
        (fun ty -> TList ty)
        args
  | "+" | "-" | "*" | "/" | "mod" | "floor" | "ceil" | "round" | "abs" | "min" | "max" -> infer_numeric callbacks env op args
  | "=" | "!=" -> infer_equality callbacks env args
  | "<" | "<=" | ">" | ">=" -> infer_comparison callbacks env op args
  | "list" ->
      Typed_collection_builtin.infer_collection
        Typed_collection_builtin.{ infer_expr = callbacks.infer_expr }
        env
        (fun ty -> TList ty)
        args
  | "starts-with?" | "ends-with?" -> callbacks.infer_apply env [] (TFn ([TString;TString],TBool)) args
  | "upper" | "lower" | "trim" -> callbacks.infer_apply env [] (TFn ([TString],TString)) args
  | "split" -> (match args with
      | [left;right] -> callbacks.infer_apply env [] (TFn ([TString;TString],TList TString)) [left;right]
      | _ -> Error [diagnostic "typecheck/arity" "split expects a string and separator."])
  | "str" | "format" -> infer_args_return callbacks env args TString
  | "count" ->
      Typed_collection_builtin.infer_count
        Typed_collection_builtin.{ infer_expr = callbacks.infer_expr }
        env args
  | "first" ->
      Typed_collection_builtin.infer_first
        Typed_collection_builtin.{ infer_expr = callbacks.infer_expr }
        env args
  | "nth" ->
      Typed_collection_builtin.infer_nth
        Typed_collection_builtin.{ infer_expr = callbacks.infer_expr }
        env args
  | "rest" ->
      Typed_collection_builtin.infer_rest
        Typed_collection_builtin.{ infer_expr = callbacks.infer_expr }
        env args
  | "map" | "list/map" ->
      Typed_collection_builtin.infer_map
        Typed_collection_builtin.{ infer_expr = callbacks.infer_expr }
        env op args
  | "filter" | "list/filter" ->
      Typed_collection_builtin.infer_filter
        Typed_collection_builtin.{ infer_expr = callbacks.infer_expr }
        env op args
  | "append" ->
      Typed_collection_builtin.infer_append
        Typed_collection_builtin.{ infer_expr = callbacks.infer_expr }
        env args
  | "concat" ->
      Typed_collection_builtin.infer_concat
        Typed_collection_builtin.{ infer_expr = callbacks.infer_expr }
        env args
  | "flat-map" | "list/flat-map" ->
      Typed_collection_builtin.infer_flat_map
        Typed_collection_builtin.{ infer_expr = callbacks.infer_expr }
        env op args
  | "reduce" | "list/reduce" ->
      Typed_collection_builtin.infer_reduce
        Typed_collection_builtin.{ infer_expr = callbacks.infer_expr }
        env args
  | "into" -> infer_args_return callbacks env args TMap
  | "__dictionary" -> (match args with
      | [e] -> (match callbacks.infer_expr env e with
          | Error _ as e -> e
          | Ok (subst,(TNamedApp ("Map",_) as t)) -> Ok (subst,t)
          | Ok (subst,TRecord fields) ->
              let key=match List.map (fun (label,_) -> TNamed (if String.starts_with ~prefix:":" label then label else Value.string_json (if String.starts_with ~prefix:"\000str:" label then String.sub label 5 (String.length label-5) else label))) fields with [] -> fresh_tyvar () | [t] -> t | ts -> TNamedApp ("Union",ts) in
              let rec values subst current = function [] -> Ok (subst,TNamedApp ("Map",[key;current])) | (_,t) :: rest -> (match join (apply_subst subst current) (apply_subst subst t) with Error _ as e -> e | Ok (s,t) -> values (compose_subst s subst) t rest) in
              (match fields with [] -> Ok (subst,TNamedApp ("Map",[key;fresh_tyvar ()])) | (_,t) :: rest -> values subst t rest)
          | Ok _ -> Error [diagnostic "typecheck/expected-map" "Map construction requires a record or map."])
      | _ -> Error [diagnostic "typecheck/arity" "Map construction expects one value."])
  | "get" | "__map-get" -> (match args with
      | [record;key] -> (match callbacks.infer_expr env record with Error _ as e -> e | Ok (subst,record_ty) ->
          match callbacks.infer_expr (apply_subst_env subst env) key with Error _ as e -> e | Ok (key_subst,key_ty) ->
            let subst=compose_subst key_subst subst in
            match apply_subst subst record_ty with
            | TNamedApp ("Map",[key;item]) -> assign (apply_subst subst key_ty) key |> Result.map (fun s -> let subst=compose_subst s subst in subst,TNamedApp ("Option",[apply_subst subst item]))
            | TVar _ as variable -> let item=fresh_tyvar () in
                unify variable (TNamedApp ("Map",[apply_subst subst key_ty;item])) |> Result.map (fun s -> let subst=compose_subst s subst in subst,TNamedApp ("Option",[apply_subst subst item]))
            | TOpenRecord _ -> Error [diagnostic "typecheck/open-record" "Computed lookup requires a closed record or a typed Map."]
            | TRecord fields ->
                let key_kinds=List.sort_uniq compare (List.map (fun (label,_) -> if String.starts_with ~prefix:":" label then TKeyword else TString) fields) in
                let expected=match key_kinds with [key] -> key | keys -> TNamedApp ("Union",if keys=[] then [TKeyword;TString] else keys) in
                (match assign (apply_subst subst key_ty) expected with Error _ as e -> e | Ok s ->
                  let subst=compose_subst s subst in
                  Ok (subst,TNamedApp ("Option",[Typed_record_builtin.record_values_item_type subst fields])))
            | TList item | TVector item -> assign (apply_subst subst key_ty) TInt |> Result.map (fun s -> let subst=compose_subst s subst in subst,apply_subst subst item)
            | _ -> Ok (subst,TAny))
      | _ -> Error [diagnostic "typecheck/arity" "get expects a collection and key"])
  | "path" -> infer_args_return callbacks env args TAny
  | "get-in" ->
      Typed_record_builtin.infer_get_in
        (typed_record_callbacks callbacks)
        env args
  | "assoc" ->
      Typed_record_builtin.infer_assoc
        (typed_record_callbacks callbacks)
        env args
  | "merge" ->
      Typed_record_builtin.infer_merge
        (typed_record_callbacks callbacks)
        env args
  | "dissoc" ->
      Typed_record_builtin.infer_dissoc
        (typed_record_callbacks callbacks)
        env args
  | "select-keys" ->
      Typed_record_builtin.infer_select_keys
        (typed_record_callbacks callbacks)
        env args
  | "keys" ->
      Typed_record_builtin.infer_keys
        (typed_record_callbacks callbacks)
        env args
  | "values" | "vals" ->
      Typed_record_builtin.infer_values
        (typed_record_callbacks callbacks)
        env args
  | "conj" ->
      Typed_collection_builtin.infer_conj
        Typed_collection_builtin.{ infer_expr = callbacks.infer_expr }
        env args
  | "empty?" | "contains?" | "set/contains?" | "keyword?" | "symbol?" | "nil?" | "string?" | "number?"
  | "boolean?" | "list?" | "map?" | "fn?" ->
      infer_args_return callbacks env args TBool
  | "keyword/name" -> infer_args_return callbacks env args TString
  | "keyword" -> infer_args_return callbacks env args TKeyword
  | "sym" -> infer_args_return callbacks env args TSymbol
  | "meta/get" | "attribute-type" | "declaration-hole" | "declaration-fields" | "row-of" | "meta" | "type/base" | "type/kind" | "type/metadata" | "form/ensure" | "form/project" -> infer_args_return callbacks env args TAny
  | "gensym" -> infer_args_return callbacks env args TSymbol
  | "sexpr-sym-name" -> infer_args_return callbacks env args TString
  | "sexpr-list?" -> infer_args_return callbacks env args TBool
  | "meta/entries" | "sexpr-items" -> infer_args_return callbacks env args (TList TAny)
  | "meta/declaration-name" | "meta/form-name" | "meta/declaration-kind"
  | "meta/slot-symbol" | "meta/slot-string" ->
      infer_args_return callbacks env args TString
  | "meta/slot-string-list" | "meta/slot-values" | "meta/declaration-fields"
  | "diag/concat" | "diag/require-slot" | "diag/member-of" | "diag/one-of"
  | "diag/validate-membership-list" | "diag/validate-default-in-list"
  | "meta/query-select-fields" | "meta/validate-query-select-fields"
  | "meta/validate-tree-bindings" | "meta/validate-descriptor-tree" ->
      infer_args_return callbacks env args (TList TAny)
  | "meta/semantic-env" | "meta/declaration-field" | "meta/slot-value"
  | "meta/slot-expr" | "meta/slot-runtime-expr" | "meta/slot-ref" | "meta/loc"
  | "meta/identifier" | "meta/positional-arg" | "meta/positional-scalar" ->
      infer_args_return callbacks env args TAny
  | "meta/descriptor" -> infer_args_return callbacks env args TFormDescriptor
  | "meta/descriptor-extension" -> infer_args_return callbacks env args TMap
  | "meta/lookup-declaration" | "meta/normalized-form" ->
      infer_args_return callbacks env args TDeclaration
  | "meta/child-forms" -> infer_args_return callbacks env args (TList TAny)
  | "meta/expr-assignable-to?" -> infer_args_return callbacks env args TBool
  | "meta/check-expr" | "meta/infer-expr-type" ->
      infer_args_return callbacks env args TTypeValue
  | "bindings/empty" | "bindings/of" | "bindings/merge" | "bindings/when"
  | "bindings/from-declaration" | "bindings/from-fields" | "bindings/scoped"
  | "http/schema-decl" | "http/error-decl" | "http/api-group-decl"
  | "view/compile-expr-record" | "meta/compile-descriptor-tree"
  | "diag/error" | "construct/object" | "construct/query" | "construct/declaration"
  | "construct/summary" | "construct/assoc" | "construct/from-descriptor" ->
      infer_args_return callbacks env args TMap
  | "meta/declaration-type" | "meta/project-type" | "type/unknown"
  | "type/constant" | "type/list" | "type/vector" | "type/ref" | "type/record"
  | "type/project-row" ->
      infer_args_return callbacks env args TTypeValue
  | _ ->
      Error
        [
          diagnostic "typecheck/unknown-form"
            (Printf.sprintf "Unknown form or function %S." op);
        ]

let infer_builtin_application (callbacks : callbacks) env op args =
  match Typed_dictionary_builtin.infer Typed_dictionary_builtin.{infer_expr=callbacks.infer_expr} env op args with
  | Some result -> result
  | None -> infer_builtin_application_fallback callbacks env op args

let infer_named_application callbacks env name args =
  match env_lookup name env with
  | Some TFormDescriptor -> Ok ([], TDeclaration)
  | Some TMacro -> infer_args_return callbacks env args TAny
  | Some ty -> callbacks.infer_apply env [] ty args
  | None when Type_env.builtins_enabled env ->
      infer_builtin_application callbacks env name args
  | None ->
      Error
        [
          diagnostic "typecheck/unknown-form"
            (Printf.sprintf "Unknown form or function %S." name);
        ]

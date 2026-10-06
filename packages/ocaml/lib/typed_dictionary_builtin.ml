open Type_expr
open Type_env
open Type_unify

type callbacks = {
  infer_expr : env -> Core_ast.expr -> (subst * ty, Type_diagnostic.t list) result;
}

let operations = ["assoc"; "dissoc"; "select-keys"; "merge"; "keys"; "values"; "vals"; "count"; "contains?"; "empty?"]

let infer callbacks env op args =
  let error message = Error [Type_diagnostic.make "typecheck/collection" message] in
  let key_type expr inferred = match expr with
    | Core_ast.Lit (_, Core_ast.LKeyword name) -> TNamed name
    | Core_ast.Lit (_, Core_ast.LString value) -> TNamed (Value.string_json value)
    | _ -> inferred in
  match args with
  | first :: rest when List.mem op operations -> (match callbacks.infer_expr env first with
      | Error _ as e -> Some e
      | Ok (initial, TNamedApp ("Map", [key;value])) ->
          let dictionary = TNamedApp ("Map", [key;value]) in
          let rec check_keys subst = function
            | [] -> Ok subst
            | expr :: rest -> (match callbacks.infer_expr (apply_subst_env subst env) expr with
                | Error _ as e -> e
                | Ok (s, inferred) ->
                    let subst = compose_subst s subst in
                    match assign (key_type expr (apply_subst subst inferred)) (apply_subst subst key) with
                    | Error _ as e -> e
                    | Ok s -> check_keys (compose_subst s subst) rest) in
          let returning subst ty = subst, apply_subst subst ty in
          Some (match op, rest with
            | "keys", [] -> Ok (returning initial (TList key))
            | ("values" | "vals"), [] -> Ok (returning initial (TList value))
            | "count", [] -> Ok (initial, TInt)
            | "empty?", [] -> Ok (initial, TBool)
            | "contains?", [_] -> check_keys initial rest |> Result.map (fun s -> s, TBool)
            | "dissoc", _ -> check_keys initial rest |> Result.map (fun s -> returning s dictionary)
            | "select-keys", [Core_ast.App (_, Core_ast.Var (_, ("__vector" | "list")), keys)] ->
                check_keys initial keys |> Result.map (fun s -> returning s dictionary)
            | "select-keys", [keys] -> (match callbacks.infer_expr (apply_subst_env initial env) keys with
                | Error _ as e -> e
                | Ok (s,t) -> let subst=compose_subst s initial in
                    assign (apply_subst subst t) (TList (apply_subst subst key))
                    |> Result.map (fun s -> returning (compose_subst s subst) dictionary))
            | "assoc", _ ->
                let rec pairs subst = function
                  | [] -> Ok (returning subst dictionary)
                  | k :: v :: rest -> (match check_keys subst [k] with
                      | Error _ as e -> e
                      | Ok subst -> (match callbacks.infer_expr (apply_subst_env subst env) v with
                          | Error _ as e -> e
                          | Ok (s,t) -> let subst=compose_subst s subst in
                              match assign (apply_subst subst t) (apply_subst subst value) with
                              | Error _ as e -> e
                              | Ok s -> pairs (compose_subst s subst) rest))
                  | _ -> error "assoc expects key/value pairs" in
                if rest=[] then error "assoc expects at least one key/value pair" else pairs initial rest
            | "merge", _ ->
                let rec dictionaries subst = function
                  | [] -> Ok (returning subst dictionary)
                  | expr :: rest -> (match callbacks.infer_expr (apply_subst_env subst env) expr with
                      | Error _ as e -> e
                      | Ok (s,t) -> let subst=compose_subst s subst in
                          match assign (apply_subst subst t) (apply_subst subst dictionary) with
                          | Error _ as e -> e
                          | Ok s -> dictionaries (compose_subst s subst) rest) in
                dictionaries initial rest
            | _ -> error ("Invalid arguments to " ^ op))
      | Ok _ -> None)
  | _ -> None

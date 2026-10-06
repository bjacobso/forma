type value = Value.t =
  | VNil
  | VBool of bool
  | VInt of int
  | VFloat of float
  | VString of string
  | VSymbol of string
  | VKeyword of string
  | VList of value list
  | VVector of value list
  | VMap of (value * value) list
  | VDictionary of (value * value) list
  | VClosure of closure
  | VMacro of closure

and closure = Value.closure = {
  params : string list;
  rest_param : string option;
  body : Ast.expr list;
  env : (string * value) list;
}

type diagnostic = Eval_common.diagnostic = {
  span : Ast.span option;
  code : string;
  message : string;
}

type context = {
  eval_expr : Env.t -> Reader.expr -> (value, diagnostic list) result;
  eval_all : Env.t -> Reader.expr list -> (value list, diagnostic list) result;
  apply_closure_values :
    Value.closure -> value list -> (value, diagnostic list) result;
}

let diagnostic = Eval_common.diagnostic
let truthy = Value.truthy

let eval ctx env op args =
  let eval_count env = function
    | [ expr ] -> (
        match ctx.eval_expr env expr with
        | Ok (VList items) -> Ok (VInt (List.length items))
        | Ok (VVector items) -> Ok (VInt (List.length items))
        | Ok (VMap entries | VDictionary entries) -> Ok (VInt (List.length entries))
        | Ok (VString value) -> Ok (VInt (String.length value))
        | Ok _ ->
            Error
              [
                diagnostic "eval/expected-countable"
                  "count expects a list or string.";
              ]
        | Error _ as error -> error)
    | _ -> Error [ diagnostic "eval/arity" "count expects one argument." ]
  in
  let eval_first env = function
    | [ expr ] -> (
        match ctx.eval_expr env expr with
        | Ok (VList (first :: _)) -> Ok first
        | Ok (VList []) -> Ok VNil
        | Ok (VVector (first :: _)) -> Ok first
        | Ok (VVector []) -> Ok VNil
        | Ok _ ->
            Error [ diagnostic "eval/expected-list" "first expects a list." ]
        | Error _ as error -> error)
    | _ -> Error [ diagnostic "eval/arity" "first expects one argument." ]
  in
  let eval_nth env = function
    | [ collection; index ] -> (
        match (ctx.eval_expr env collection, ctx.eval_expr env index) with
        | Ok (VList values), Ok (VInt index)
        | Ok (VVector values), Ok (VInt index) ->
            if index < 0 || index >= List.length values then Ok VNil
            else Ok (List.nth values index)
        | Ok _, Ok _ ->
            Error
              [
                diagnostic "eval/expected-list"
                  "nth expects a list or vector and an integer index.";
              ]
        | Error diagnostics, _ | _, Error diagnostics -> Error diagnostics)
    | _ -> Error [ diagnostic "eval/arity" "nth expects two arguments." ]
  in
  let eval_rest env = function
    | [ expr ] -> (
        match ctx.eval_expr env expr with
        | Ok (VList (_ :: rest)) -> Ok (VList rest)
        | Ok (VList []) -> Ok (VList [])
        | Ok (VVector (_ :: rest)) -> Ok (VVector rest)
        | Ok (VVector []) -> Ok (VVector [])
        | Ok _ ->
            Error [ diagnostic "eval/expected-list" "rest expects a list." ]
        | Error _ as error -> error)
    | _ -> Error [ diagnostic "eval/arity" "rest expects one argument." ]
  in
  let eval_append env = function
    | [ left; right ] -> (
        match (ctx.eval_expr env left, ctx.eval_expr env right) with
        | Ok (VList left), Ok (VList right) -> Ok (VList (left @ right))
        | Ok (VVector left), Ok (VVector right) -> Ok (VVector (left @ right))
        | Error diagnostics, _ | _, Error diagnostics -> Error diagnostics
        | _ ->
            Error
              [ diagnostic "eval/expected-list" "append expects two lists." ])
    | _ -> Error [ diagnostic "eval/arity" "append expects two arguments." ]
  in
  let eval_concat env args =
    match ctx.eval_all env args with
    | Error _ as error -> error
    | Ok values ->
        let rec loop acc = function
          | [] -> Ok (VList (List.rev acc))
          | VList values :: rest | VVector values :: rest ->
              loop (List.rev_append values acc) rest
          | _ ->
              Error
                [
                  diagnostic "eval/expected-list"
                    "concat expects list or vector arguments.";
                ]
        in
        loop [] values
  in
  let eval_reduce env args =
    match ctx.eval_all env args with
    | Error _ as error -> error
    | Ok [ VClosure closure; initial; VList values ]
    | Ok [ VClosure closure; initial; VVector values ]
    | Ok [ VList values; initial; VClosure closure ]
    | Ok [ VVector values; initial; VClosure closure ] ->
        let rec loop acc = function
          | [] -> Ok acc
          | value :: rest -> (
              match ctx.apply_closure_values closure [ acc; value ] with
              | Error _ as error -> error
              | Ok acc -> loop acc rest)
        in
        loop initial values
    | Ok _ ->
        Error
          [
            diagnostic "eval/arity"
              "reduce expects a function, initial value, and list or vector.";
          ]
  in
  let eval_into env = function
    | [ pairs ] -> (
        match ctx.eval_expr env pairs with
        | Ok (VList pairs) | Ok (VVector pairs) ->
            let rec entries acc = function
              | [] -> Ok (VMap (List.rev acc))
              | (VList [((VString _ | VKeyword _ | VSymbol _) as key);value] | VVector [((VString _ | VKeyword _ | VSymbol _) as key);value]) :: rest -> entries ((key,value) :: acc) rest
              | _ -> Error [diagnostic "eval/expected-pair" "into expects pairs with string, keyword or symbol keys."] in
            entries [] pairs
        | Ok _ ->
            Error
              [
                diagnostic "eval/expected-list"
                  "into expects a list or vector of key/value pairs.";
              ]
        | Error _ as error -> error)
    | _ -> Error [ diagnostic "eval/arity" "into expects one argument." ]
  in
  let eval_higher_order_args env op args =
    match ctx.eval_all env args with
    | Error _ as error -> error
    | Ok [ VClosure closure; VList values ] -> Ok (`List, values, closure)
    | Ok [ VClosure closure; VVector values ] -> Ok (`Vector, values, closure)
    | Ok [ VList values; VClosure closure ] -> Ok (`List, values, closure)
    | Ok [ VVector values; VClosure closure ] -> Ok (`Vector, values, closure)
    | Ok [ VMacro _; _ ] | Ok [ _; VMacro _ ] ->
        Error [ diagnostic "eval/not-callable" (op ^ " expects a function.") ]
    | Ok [ _; _ ] ->
        Error
          [
            diagnostic "eval/expected-list"
              (op ^ " expects a function and a list or vector.");
          ]
    | Ok _ ->
        Error
          [
            diagnostic "eval/arity"
              (op ^ " expects exactly two arguments: function and collection.");
          ]
  in
  let eval_map_builtin env args =
    match eval_higher_order_args env "map" args with
    | Error _ as error -> error
    | Ok (collection_kind, values, closure) ->
        let rec loop acc = function
          | [] ->
              let values = List.rev acc in
              Ok
                (if collection_kind = `Vector then VVector values
                 else VList values)
          | value :: rest -> (
              match ctx.apply_closure_values closure [ value ] with
              | Error _ as error -> error
              | Ok mapped -> loop (mapped :: acc) rest)
        in
        loop [] values
  in
  let eval_filter_builtin env args =
    match eval_higher_order_args env "filter" args with
    | Error _ as error -> error
    | Ok (collection_kind, values, closure) ->
        let rec loop acc = function
          | [] ->
              let values = List.rev acc in
              Ok
                (if collection_kind = `Vector then VVector values
                 else VList values)
          | value :: rest -> (
              match ctx.apply_closure_values closure [ value ] with
              | Error _ as error -> error
              | Ok predicate when truthy predicate -> loop (value :: acc) rest
              | Ok _ -> loop acc rest)
        in
        loop [] values
  in
  let eval_flat_map_builtin env args =
    match eval_higher_order_args env "flat-map" args with
    | Error _ as error -> error
    | Ok (collection_kind, values, closure) ->
        let rec loop acc = function
          | [] ->
              let values = List.rev acc in
              Ok
                (if collection_kind = `Vector then VVector values
                 else VList values)
          | value :: rest -> (
              match ctx.apply_closure_values closure [ value ] with
              | Ok (VList mapped) | Ok (VVector mapped) ->
                  loop (List.rev_append mapped acc) rest
              | Ok _ ->
                  Error
                    [
                      diagnostic "eval/expected-list"
                        "flat-map callback must return a list or vector.";
                    ]
              | Error _ as error -> error)
        in
        loop [] values
  in
  let rec eval_get env = function
    | [ collection; key ] | [ collection; key; Reader.Nil _ ] -> (
        match (ctx.eval_expr env collection, ctx.eval_expr env key) with
        | Ok (VDictionary entries), Ok key ->
            let found=List.find_opt (fun (k,_) -> Value.equal k key) entries in
            Ok (match found with None -> VMap [VKeyword ":_tag",VString "None"] | Some (_,v) -> VMap [VKeyword ":_tag",VString "Some";VKeyword ":value",v])
        | Ok (VMap entries), Ok key when op="__map-get" || (op="get" && (match key with _ -> match List.nth_opt args 1 with Some (Ast.Keyword _ | Ast.String _ | Ast.Int _) | Some (Ast.List (_, [Ast.Symbol (_,"quote");(Ast.Keyword _ | Ast.String _ | Ast.Int _)])) -> false | _ -> true)) ->
            Ok (match Value.lookup_map entries key with None -> VMap [VKeyword ":_tag",VString "None"] | Some value -> VMap [VKeyword ":_tag",VString "Some";VKeyword ":value",value])
        | Ok (VMap entries), Ok key -> (
            match
              List.find_opt
                (fun (entry_key, _) -> Value.equal entry_key key)
                entries
            with
            | Some (_, value) -> Ok value
            | None -> Ok VNil)
        | Ok (VList values), Ok (VInt index)
        | Ok (VVector values), Ok (VInt index) ->
            if index < 0 || index >= List.length values then Ok VNil
            else Ok (List.nth values index)
        | Ok _, Ok _ ->
            Error
              [
                diagnostic "eval/expected-collection"
                  "get expects a map, list, or vector.";
              ]
        | Error diagnostics, _ | _, Error diagnostics -> Error diagnostics)
    | [ collection; key; default_value ] -> (
        match eval_get env [ collection; key ] with
        | Error _ as error -> error
        | Ok VNil -> ctx.eval_expr env default_value
        | Ok value -> Ok value)
    | _ ->
        Error
          [
            diagnostic "eval/arity"
              "get expects collection, key, and optional default.";
          ]
  in
  let runtime_path_segment value key = match value with
    | VMap fields -> Option.value ~default:VNil (Value.lookup_map fields key)
    | _ -> Value.lookup_path_segment value key in
  let eval_path env = function
    | value :: segments -> (
        match ctx.eval_expr env value with
        | Error _ as error -> error
        | Ok value -> (
            match ctx.eval_all env segments with
            | Error _ as error -> error
            | Ok segments ->
                Ok (List.fold_left runtime_path_segment value segments)))
    | [] ->
        Error
          [ diagnostic "eval/arity" "path expects a value and path segments." ]
  in
  let rec eval_get_in env = function
    | [ value; path ] | [ value; path; Reader.Nil _ ] -> (
        match (ctx.eval_expr env value, ctx.eval_expr env path) with
        | Ok value, Ok (VList segments) | Ok value, Ok (VVector segments) ->
            Ok (List.fold_left Value.lookup_path_segment value segments)
        | Ok _, Ok _ ->
            Error
              [
                diagnostic "eval/expected-list"
                  "get-in expects a list or vector path.";
              ]
        | Error diagnostics, _ | _, Error diagnostics -> Error diagnostics)
    | [ value; path; default_value ] -> (
        match eval_get_in env [ value; path ] with
        | Error _ as error -> error
        | Ok VNil -> ctx.eval_expr env default_value
        | Ok value -> Ok value)
    | _ ->
        Error
          [
            diagnostic "eval/arity"
              "get-in expects a collection, path, and optional default.";
          ]
  in
  let eval_assoc env = function
    | [ collection; key; value ] -> (
        match
          ( ctx.eval_expr env collection,
            ctx.eval_expr env key,
            ctx.eval_expr env value )
        with
        | Ok ((VMap entries | VDictionary entries) as collection), Ok key, Ok value ->
            let filtered =
              List.filter
                (fun (entry_key, _) -> not (Value.equal entry_key key))
                entries
            in
            Ok (match collection with VDictionary _ -> VDictionary ((key,value) :: filtered) | _ -> VMap ((key,value) :: filtered))
        | Ok _, Ok _, Ok _ ->
            Error [ diagnostic "eval/expected-map" "assoc expects a map." ]
        | Error diagnostics, _, _
        | _, Error diagnostics, _
        | _, _, Error diagnostics ->
            Error diagnostics)
    | _ ->
        Error [ diagnostic "eval/arity" "assoc expects a map, key, and value." ]
  in
  let eval_merge env args =
    match ctx.eval_all env args with
    | Error _ as error -> error
    | Ok maps ->
        let dictionary=List.exists (function VDictionary _ -> true | _ -> false) maps in
        let rec loop entries = function
          | [] -> Ok (if dictionary then VDictionary (List.rev entries) else VMap (List.rev entries))
          | (VMap next | VDictionary next) :: rest ->
              let entries =
                List.fold_left
                  (fun acc (key, value) ->
                    (key, value)
                    :: List.filter
                         (fun (entry_key, _) -> not (Value.equal entry_key key))
                         acc)
                  entries next
              in
              loop entries rest
          | _ -> Error [ diagnostic "eval/expected-map" "merge expects maps." ]
        in
        loop [] maps
  in
  let eval_dissoc env = function
    | map_expr :: keys -> (
        match (ctx.eval_expr env map_expr, ctx.eval_all env keys) with
        | Ok ((VMap entries | VDictionary entries) as collection), Ok keys ->
            let entries =
              List.filter
                (fun (entry_key, _) ->
                  not
                    (List.exists
                       (fun key ->
                         Value.equal entry_key key)
                       keys))
                entries
            in
            Ok (match collection with VDictionary _ -> VDictionary entries | _ -> VMap entries)
        | Ok _, Ok _ ->
            Error [ diagnostic "eval/expected-map" "dissoc expects a map." ]
        | Error diagnostics, _ | _, Error diagnostics -> Error diagnostics)
    | [] -> Error [ diagnostic "eval/arity" "dissoc expects a map and keys." ]
  in
  let eval_select_keys env = function
    | [ map_expr; keys_expr ] -> (
        match (ctx.eval_expr env map_expr, ctx.eval_expr env keys_expr) with
        | Ok ((VMap entries | VDictionary entries) as collection), Ok (VList keys)
        | Ok ((VMap entries | VDictionary entries) as collection), Ok (VVector keys) ->
            let selected =
              List.filter
                (fun (entry_key, _) ->
                  List.exists
                    (fun key ->
                      Value.equal entry_key key)
                    keys)
                entries
            in
            Ok (match collection with VDictionary _ -> VDictionary selected | _ -> VMap selected)
        | Ok _, Ok _ ->
            Error
              [
                diagnostic "eval/expected-map"
                  "select-keys expects a map and list of keys.";
              ]
        | Error diagnostics, _ | _, Error diagnostics -> Error diagnostics)
    | _ ->
        Error
          [
            diagnostic "eval/arity"
              "select-keys expects a map and list of keys.";
          ]
  in
  let eval_keys env = function
    | [ collection ] -> (
        match ctx.eval_expr env collection with
        | Ok (VMap entries | VDictionary entries) -> Ok (VList (List.map fst entries))
        | Ok _ -> Error [ diagnostic "eval/expected-map" "keys expects a map." ]
        | Error _ as error -> error)
    | _ -> Error [ diagnostic "eval/arity" "keys expects one argument." ]
  in
  let eval_values env = function
    | [ collection ] -> (
        match ctx.eval_expr env collection with
        | Ok (VMap entries | VDictionary entries) -> Ok (VList (List.map snd entries))
        | Ok _ ->
            Error [ diagnostic "eval/expected-map" "values expects a map." ]
        | Error _ as error -> error)
    | _ -> Error [ diagnostic "eval/arity" "values expects one argument." ]
  in
  let eval_conj env = function
    | collection :: values -> (
        match (ctx.eval_expr env collection, ctx.eval_all env values) with
        | Ok (VList items), Ok values -> Ok (VList (items @ values))
        | Ok (VVector items), Ok values -> Ok (VVector (items @ values))
        | Ok _, Ok _ ->
            Error
              [
                diagnostic "eval/expected-list"
                  "conj expects a list or vector followed by values.";
              ]
        | Error diagnostics, _ | _, Error diagnostics -> Error diagnostics)
    | [] ->
        Error
          [
            diagnostic "eval/arity"
              "conj expects a list or vector followed by values.";
          ]
  in
  let eval_empty env = function
    | [ expr ] -> (
        match ctx.eval_expr env expr with
        | Ok VNil -> Ok (VBool true)
        | Ok (VString value) -> Ok (VBool (String.length value = 0))
        | Ok (VList values) | Ok (VVector values) -> Ok (VBool (values = []))
        | Ok (VMap entries | VDictionary entries) -> Ok (VBool (entries = []))
        | Ok _ -> Ok (VBool false)
        | Error _ as error -> error)
    | _ -> Error [ diagnostic "eval/arity" "empty? expects one argument." ]
  in
  let eval_contains env = function
    | [ collection; value ] -> (
        match (ctx.eval_expr env collection, ctx.eval_expr env value) with
        | Ok (VList values), Ok value | Ok (VVector values), Ok value ->
            Ok (VBool (List.exists (Value.equal value) values))
        | Ok (VMap entries | VDictionary entries), Ok key ->
            Ok
              (VBool
                 (List.exists
                    (fun (entry_key, _) -> Value.equal entry_key key)
                    entries))
        | Ok (VString haystack), Ok (VString needle) ->
            let rec contains i = i + String.length needle <= String.length haystack && (String.sub haystack i (String.length needle) = needle || contains (i+1)) in
            Ok (VBool (contains 0))
        | Ok _, Ok _ ->
            Error
              [
                diagnostic "eval/expected-collection"
                  "contains? expects a map, list, or vector.";
              ]
        | Error diagnostics, _ | _, Error diagnostics -> Error diagnostics)
    | _ -> Error [ diagnostic "eval/arity" "contains? expects two arguments." ]
  in
  let some result = Result.map (fun value -> Some value) result in
  match op with
  | "count" -> some (eval_count env args)
  | "first" -> some (eval_first env args)
  | "nth" -> some (eval_nth env args)
  | "rest" -> some (eval_rest env args)
  | "append" -> some (eval_append env args)
  | "concat" -> some (eval_concat env args)
  | "reduce" | "list/reduce" -> some (eval_reduce env args)
  | "into" -> some (eval_into env args)
  | "map" | "list/map" -> some (eval_map_builtin env args)
  | "filter" | "list/filter" -> some (eval_filter_builtin env args)
  | "flat-map" | "list/flat-map" -> some (eval_flat_map_builtin env args)
  | "__dictionary" -> some (match args with
      | [e] -> (match ctx.eval_expr env e with Ok (VMap entries | VDictionary entries) -> Ok (VDictionary entries) | Ok _ -> Error [diagnostic "eval/expected-map" "Map construction requires a record or map."] | Error _ as e -> e)
      | _ -> Error [diagnostic "eval/arity" "Map construction expects one value."])
  | "get" | "__map-get" | "meta/get" -> some (eval_get env args)
  | "path" -> some (eval_path env args)
  | "get-in" -> some (eval_get_in env args)
  | "assoc" -> some (eval_assoc env args)
  | "merge" -> some (eval_merge env args)
  | "dissoc" -> some (eval_dissoc env args)
  | "select-keys" -> some (eval_select_keys env args)
  | "keys" -> some (eval_keys env args)
  | "values" | "vals" -> some (eval_values env args)
  | "conj" -> some (eval_conj env args)
  | "empty?" -> some (eval_empty env args)
  | "contains?" | "set/contains?" -> some (eval_contains env args)
  | _ -> Ok None

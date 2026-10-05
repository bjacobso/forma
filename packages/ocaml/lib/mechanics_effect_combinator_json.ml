open Mechanics_artifact_payload
open Mechanics_value_json

(* Argument shapes for the Effect combinators a body can call; mirrors the
   `combinators` table in packages/ts/src/mechanics/artifact.ts. *)
type arg = Effect_arg | Value_arg | Lambda_arg | Effects_arg | Type_arg

type spec = { args : arg list; rest : arg option; options : string list option }

let spec ?rest ?options args = { args; rest; options }

let combinators =
  [
    ("scoped", spec [ Effect_arg ]);
    ("acquire-release", spec [ Effect_arg; Lambda_arg ]);
    ("ensuring", spec [ Effect_arg; Effect_arg ]);
    ("add-finalizer", spec [ Effect_arg ]);
    ("all", spec ~options:[ "concurrency" ] [ Effects_arg ]);
    ("for-each", spec ~options:[ "concurrency" ] [ Value_arg; Lambda_arg ]);
    ("race", spec [ Effect_arg; Effect_arg ]);
    ("fork", spec [ Effect_arg ]);
    ("join", spec [ Value_arg ]);
    ("interrupt", spec [ Value_arg ]);
    ("sleep", spec [ Value_arg ]);
    ("timeout", spec [ Effect_arg; Value_arg ]);
    ("retry", spec ~options:[ "times" ] [ Effect_arg ]);
    ("map-error", spec [ Effect_arg; Value_arg ]);
    ("or-else-succeed", spec [ Effect_arg; Value_arg ]);
    ("or-die", spec [ Effect_arg ]);
    ("option", spec [ Effect_arg ]);
    ("result", spec [ Effect_arg ]);
    ("provide", spec [ Effect_arg; Value_arg ]);
    ("log", spec ~rest:Value_arg []);
    ("ref-make", spec [ Value_arg ]);
    ("ref-get", spec [ Value_arg ]);
    ("ref-set", spec [ Value_arg; Value_arg ]);
    ("ref-update", spec [ Value_arg; Value_arg ]);
    ("config", spec ~options:[ "default" ] [ Type_arg; Value_arg ]);
    ("decode", spec [ Type_arg; Value_arg ]);
  ]

let find name = List.assoc_opt name combinators

exception Reported of Ir_json.t

let lambda_json ~body_forms context name expr =
  match expr with
  | Ast.List (_, Ast.Symbol (_, "fn") :: Ast.Vector (_, params) :: body) ->
      let param param =
        match scalar_name param with
        | Some name -> Ir_json.String name
        | None ->
            raise (Reported (report context param "fn parameters must be symbolic names."))
      in
      (try
         let params = List.map param params in
         obj "Lambda"
           [
             ("params", Ir_json.Array params);
             ("body", body_forms context body);
             ("span", source_json context.source_id expr);
           ]
       with Reported node -> node)
  | _ -> report context expr (name ^ " expects (fn [params...] effect) here.")

let effects_json ~core context name expr =
  let span = ("span", source_json context.source_id expr) in
  match expr with
  | Ast.Vector (_, items) ->
      obj "EffectVector" [ ("items", Ir_json.Array (List.map (core context) items)); span ]
  | Ast.Map (_, pairs) -> (
      let entry (key, value) =
        match scalar_name key with
        | Some key ->
            Ir_json.Object [ ("key", Ir_json.String key); ("value", core context value) ]
        | None -> raise (Reported (report context key (name ^ " map keys must be keywords.")))
      in
      try obj "EffectRecord" [ ("entries", Ir_json.Array (List.map entry pairs)); span ]
      with Reported node -> node)
  | _ -> report context expr (name ^ " expects a vector or map of effects.")

let arg_json ~core ~body_forms context name kind expr =
  match kind with
  | Effect_arg -> core context expr
  | Value_arg -> value_json context.source_id expr
  | Type_arg -> (
      match type_expr_to_json expr with
      | Error diagnostics ->
          add_diagnostics context diagnostics;
          obj "TypeArg" [ ("type", obj "Primitive" [ ("name", Ir_json.String "Unit") ]) ]
      | Ok type_json ->
          obj "TypeArg" [ ("type", type_json); ("span", source_json context.source_id expr) ])
  | Lambda_arg -> lambda_json ~body_forms context name expr
  | Effects_arg -> effects_json ~core context name expr

let split_options spec items =
  let arity = List.length spec.args in
  let rec loop index acc = function
    | item :: _ as rest when index >= arity && is_keyword_expr item -> (List.rev acc, rest)
    | item :: rest -> loop (index + 1) (item :: acc) rest
    | [] -> (List.rev acc, [])
  in
  match spec.options with None -> (items, []) | Some _ -> loop 0 [] items

let options_json context name spec items =
  let allowed = Option.value spec.options ~default:[] in
  let rec loop acc = function
    | [] -> Ok (List.rev acc)
    | key_expr :: value :: rest -> (
        match Option.map strip_keyword (sym_name key_expr) with
        | Some key when List.mem key allowed ->
            loop
              (Ir_json.Object
                 [ ("key", Ir_json.String key); ("value", value_json context.source_id value) ]
              :: acc)
              rest
        | _ ->
            let expected =
              match allowed with
              | [] -> "no options"
              | options -> String.concat ", " (List.map (fun option -> ":" ^ option) options)
            in
            Error
              (report context key_expr
                 (Printf.sprintf "%s does not accept option %s; expected %s." name
                    (Option.value (sym_name key_expr) ~default:"?")
                    expected)))
    | [ _ ] -> Ok (List.rev acc)
  in
  loop [] items

let combinator_json ~core ~body_forms context expr name spec items =
  let positional, option_items = split_options spec items in
  let arity = List.length spec.args and count = List.length positional in
  let arity_ok = match spec.rest with Some _ -> count >= arity | None -> count = arity in
  if not arity_ok then
    report context expr
      (Printf.sprintf "%s expects %s%d argument(s), received %d." name
         (if Option.is_some spec.rest then "at least " else "")
         arity count)
  else
    let arg index item =
      let kind =
        match List.nth_opt spec.args index with
        | Some kind -> kind
        | None -> Option.value spec.rest ~default:Value_arg
      in
      arg_json ~core ~body_forms context name kind item
    in
    let args = List.mapi arg positional in
    if List.length option_items mod 2 <> 0 then
      report context expr (name ^ " options must be :keyword value pairs.")
    else
      match options_json context name spec option_items with
      | Error node -> node
      | Ok options ->
          obj "Combinator"
            ([ ("name", Ir_json.String name); ("args", Ir_json.Array args) ]
            @ (if options = [] then [] else [ ("options", Ir_json.Array options) ])
            @ [ ("effect", context.effect); ("span", source_json context.source_id expr) ])

(* (catch body (E e) handler ...) projects to Catch, CatchTags, or CatchAll. *)
let catch_json ~core context expr items =
  let node kind entries =
    obj kind (entries @ [ ("effect", context.effect); ("span", source_json context.source_id expr) ])
  in
  match items with
  | body :: clauses when clauses <> [] && List.length clauses mod 2 = 0 -> (
      let rec handlers acc = function
        | (Ast.List (_, [ error_type; binding ]) as pattern) :: handler :: rest
          when Option.is_some (sym_name error_type) && Option.is_some (sym_name binding) ->
            let handler = core context handler in
            handlers
              ((Option.get (sym_name error_type), Option.get (sym_name binding), handler,
                source_json context.source_id pattern)
              :: acc)
              rest
        | pattern :: _ :: _ ->
            Error (report context pattern "catch patterns must be (ErrorType binding) or (_ binding).")
        | _ -> Ok (List.rev acc)
      in
      match handlers [] clauses with
      | Error placeholder -> placeholder
      | Ok handlers -> (
          let body = core context body in
          match handlers with
          | [ ("_", binding, handler, _) ] ->
              node "CatchAll"
                [ ("body", body); ("binding", Ir_json.String binding); ("handler", handler) ]
          | handlers when List.exists (fun (error_type, _, _, _) -> error_type = "_") handlers ->
              report context expr "a (_ binding) catch-all must be the only catch clause."
          | [ (error_type, binding, handler, _) ] ->
              node "Catch"
                [
                  ("body", body);
                  ("errorType", Ir_json.String error_type);
                  ("binding", Ir_json.String binding);
                  ("handler", handler);
                ]
          | handlers ->
              let handler_json (error_type, binding, handler, span) =
                Ir_json.Object
                  [
                    ("errorType", Ir_json.String error_type);
                    ("binding", Ir_json.String binding);
                    ("handler", handler);
                    ("span", span);
                  ]
              in
              node "CatchTags"
                [ ("body", body); ("handlers", Ir_json.Array (List.map handler_json handlers)) ]))
  | _ ->
      report context expr
        "catch expects an effect followed by (ErrorType binding) handler pairs."

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
  | VClosure of Value.closure
  | VMacro of Value.closure

type diagnostic = Eval_common.diagnostic
type env = Env.t

type callbacks = {
  eval_expr : env -> Ast.expr -> (value, diagnostic list) result;
  parse_params :
    Ast.expr list -> (string list * string option, diagnostic list) result;
}

type runtime_value = RPure of value | RContinuation of (value -> step)

and runtime_env = {
  pure_env : env;
  continuations : (string * (value -> step)) list;
}

and step =
  | Done of (value, diagnostic list) result
  | Perform_step of string * string * value list * (value -> step)

type handler_clause = {
  op_name : string;
  arg_names : string list;
  continuation_name : string;
  body : Ast.expr list;
}

type handler = { effect_name : string; clauses : handler_clause list }

let diagnostic = Eval_common.diagnostic
let with_span = Eval_common.with_span

let contains_effect_forms expr =
  let rec loop = function
    | Ast.List (_, Ast.Symbol (_, ("perform" | "handle")) :: _) -> true
    | Ast.List (_, items) | Ast.Vector (_, items) -> List.exists loop items
    | Ast.Map (_, entries) ->
        List.exists (fun (key, value) -> loop key || loop value) entries
    | _ -> false
  in
  loop expr

let bind_step step continuation =
  let rec loop step continuation =
    match step with
    | Done result -> (
        match result with
        | Error _ as error -> Done error
        | Ok value -> continuation value)
    | Perform_step (effect_name, op_name, args, resume) ->
        Perform_step
          ( effect_name,
            op_name,
            args,
            fun value -> loop (resume value) continuation )
  in
  loop step continuation

let done_step value = Done (Ok value)

let require_pure ?span = function
  | RPure value -> Ok value
  | RContinuation _ ->
      Error
        [
          diagnostic ?span "eval/not-callable"
            "Continuation value cannot be used as data.";
        ]

let arity_diagnostic ?span name message =
  Error [ diagnostic ?span name message ]

let lookup_runtime env span name =
  match List.assoc_opt name env.continuations with
  | Some continuation -> Ok (RContinuation continuation)
  | None -> (
      match Env.lookup name env.pure_env with
      | Some value -> Ok (RPure value)
      | None ->
          Error
            [
              diagnostic ?span "eval/unbound-symbol"
                (Printf.sprintf "Unbound symbol %S." name);
            ])

let bind_pure name value env =
  { env with pure_env = Env.bind name value env.pure_env }

let bind_pure_many bindings env =
  { env with pure_env = Env.extend bindings env.pure_env }

let bind_continuation name continuation env =
  { env with continuations = (name, continuation) :: env.continuations }

let has_continuation_binding env name =
  match List.assoc_opt name env.continuations with
  | Some _ -> true
  | None -> false

let rec eval_expr callbacks env expr continuation =
  match expr with
  | Ast.Symbol (span, name) when has_continuation_binding env name -> (
      match lookup_runtime env (Some span) name with
      | Error _ as error -> Done error
      | Ok value -> continuation value)
  | Ast.List (span, Ast.Symbol (_, name) :: args)
    when has_continuation_binding env name -> (
      match lookup_runtime env (Some span) name with
      | Error _ as error -> Done error
      | Ok callee ->
          eval_pure_values callbacks env args [] (fun values ->
              apply callbacks env callee values continuation))
  | _ when not (contains_effect_forms expr) ->
      bind_step
        (Done (callbacks.eval_expr env.pure_env expr))
        (fun value -> continuation (RPure value))
  | Ast.Nil _ -> continuation (RPure VNil)
  | Ast.Bool (_, value) -> continuation (RPure (VBool value))
  | Ast.Int (_, value) -> continuation (RPure (VInt value))
  | Ast.Float (_, value) -> continuation (RPure (VFloat value))
  | Ast.String (_, value) -> continuation (RPure (VString value))
  | Ast.Keyword (_, value) -> continuation (RPure (VKeyword value))
  | Ast.Symbol (span, name) -> (
      match lookup_runtime env (Some span) name with
      | Error _ as error -> Done error
      | Ok value -> continuation value)
  | Ast.Vector (_, items) ->
      eval_pure_values callbacks env items [] (fun values ->
          continuation (RPure (VList values)))
  | Ast.Map (_, entries) ->
      eval_map_entries callbacks env entries [] (fun values ->
          continuation (RPure (VMap values)))
  | Ast.List (_, []) -> continuation (RPure (VList []))
  | Ast.List (span, Ast.Symbol (_, "perform") :: args) ->
      eval_perform callbacks env (Some span) args continuation
  | Ast.List (span, Ast.Symbol (_, "handle") :: args) ->
      eval_handle callbacks env (Some span) args continuation
  | Ast.List (_, Ast.Symbol (_, "do") :: exprs) ->
      eval_sequence callbacks env exprs continuation
  | Ast.List (span, Ast.Symbol (_, "if") :: args) ->
      eval_if callbacks env (Some span) args continuation
  | Ast.List (span, Ast.Symbol (_, "let") :: args) ->
      eval_let callbacks env (Some span) args continuation
  | Ast.List (span, Ast.Symbol (_, ("fn" | "lambda")) :: args) ->
      eval_lambda callbacks env (Some span) args continuation
  | Ast.List (_, callee :: args) ->
      eval_expr callbacks env callee (fun callee ->
          eval_pure_values callbacks env args [] (fun values ->
              apply callbacks env callee values continuation))

and eval_sequence callbacks env exprs continuation =
  match exprs with
  | [] -> continuation (RPure VNil)
  | [ expr ] -> eval_expr callbacks env expr continuation
  | expr :: rest ->
      eval_expr callbacks env expr (fun _ ->
          eval_sequence callbacks env rest continuation)

and eval_pure_values callbacks env exprs acc continuation =
  match exprs with
  | [] -> continuation (List.rev acc)
  | expr :: rest ->
      eval_expr callbacks env expr (fun value ->
          match require_pure ~span:(Ast.expr_span expr) value with
          | Error _ as error -> Done error
          | Ok value ->
              eval_pure_values callbacks env rest (value :: acc) continuation)

and eval_map_entries callbacks env entries acc continuation =
  match entries with
  | [] -> continuation (List.rev acc)
  | (key_expr, value_expr) :: rest ->
      eval_expr callbacks env key_expr (fun key ->
          match require_pure ~span:(Ast.expr_span key_expr) key with
          | Error _ as error -> Done error
          | Ok key ->
              eval_expr callbacks env value_expr (fun value ->
                  match require_pure ~span:(Ast.expr_span value_expr) value with
                  | Error _ as error -> Done error
                  | Ok value ->
                      eval_map_entries callbacks env rest ((key, value) :: acc)
                        continuation))

and eval_perform callbacks env span args continuation =
  match args with
  | Ast.Symbol (_, op_name) :: arg_exprs -> (
      match Eval_effect_definition.lookup_effect_name env.pure_env op_name with
      | None ->
          Done
            (Error
               [
                 diagnostic ?span "eval/unknown-effect-operation"
                   (Printf.sprintf "Unknown effect operation %S." op_name);
               ])
      | Some effect_name ->
          eval_pure_values callbacks env arg_exprs [] (fun values ->
              Perform_step
                ( effect_name,
                  op_name,
                  values,
                  fun value -> continuation (RPure value) )))
  | _ ->
      arity_diagnostic ?span "eval/perform-form"
        "perform expects an operation symbol followed by argument expressions."
      |> fun error -> Done error

and eval_handle callbacks env span args continuation =
  match args with
  | body :: handler_exprs -> (
      match parse_handlers handler_exprs with
      | Error _ as error -> Done error
      | Ok handlers ->
          handle_step callbacks env handlers
            (eval_expr callbacks env body (fun value ->
                 match require_pure ~span:(Ast.expr_span body) value with
                 | Error _ as error -> Done error
                 | Ok value -> done_step value))
            continuation)
  | [] ->
      arity_diagnostic ?span "eval/handle-form"
        "handle expects a body expression followed by effect handlers."
      |> fun error -> Done error

and eval_if callbacks env span args continuation =
  match args with
  | [ condition; then_branch; else_branch ] ->
      eval_expr callbacks env condition (fun value ->
          match require_pure ~span:(Ast.expr_span condition) value with
          | Error _ as error -> Done error
          | Ok condition_value ->
              eval_expr callbacks env
                (if Value.truthy condition_value then then_branch
                 else else_branch)
                continuation)
  | [ condition; then_branch ] ->
      eval_expr callbacks env condition (fun value ->
          match require_pure ~span:(Ast.expr_span condition) value with
          | Error _ as error -> Done error
          | Ok condition_value ->
              eval_expr callbacks env
                (if Value.truthy condition_value then then_branch
                 else Ast.Nil (Ast.expr_span condition))
                continuation)
  | _ ->
      arity_diagnostic ?span "eval/if-form"
        "if expects a condition, then branch, and optional else branch."
      |> fun error -> Done error

and eval_let callbacks env span args continuation =
  match args with
  | Ast.Vector (_, bindings) :: body ->
      bind_let callbacks env bindings (fun local_env ->
          eval_sequence callbacks local_env body continuation)
  | _ ->
      arity_diagnostic ?span "eval/let-bindings"
        "let expects a vector of symbol/value bindings followed by body forms."
      |> fun error -> Done error

and bind_let callbacks env bindings continuation =
  match bindings with
  | [] -> continuation env
  | Ast.Symbol (_, name) :: value_expr :: rest ->
      eval_expr callbacks env value_expr (fun value ->
          match require_pure ~span:(Ast.expr_span value_expr) value with
          | Error _ as error -> Done error
          | Ok value ->
              bind_let callbacks (bind_pure name value env) rest continuation)
  | _ ->
      Done
        (Error
           [
             diagnostic "eval/let-bindings"
               "let bindings must contain even symbol/value pairs.";
           ])

and eval_lambda callbacks env span args continuation =
  match args with
  | Ast.Vector (_, params) :: body -> (
      match callbacks.parse_params params with
      | Error _ as error -> Done error
      | Ok (params, rest_param) ->
          let env = Env.bindings env.pure_env in
          continuation (RPure (VClosure { params; rest_param; body; env })))
  | _ ->
      arity_diagnostic ?span "eval/lambda-params"
        "fn expects a vector of parameter symbols followed by body forms."
      |> fun error -> Done error

and apply callbacks _caller_env callee values continuation =
  match callee with
  | RContinuation resume -> (
      match values with
      | [ value ] ->
          bind_step (resume value) (fun resumed -> continuation (RPure resumed))
      | _ ->
          Done
            (Error
               [
                 diagnostic "eval/arity"
                   (Printf.sprintf
                      "Continuation expects exactly one argument, received %d."
                      (List.length values));
               ]))
  | RPure (VClosure closure) -> (
      match closure_env_from_values closure values with
      | Error _ as error -> Done error
      | Ok local_env ->
          eval_sequence callbacks
            { pure_env = local_env; continuations = [] }
            closure.body continuation)
  | RPure (VMacro _) ->
      Done
        (Error
           [
             diagnostic "eval/unexpanded-macro"
               "Macro value reached evaluation before expansion.";
           ])
  | RPure _ ->
      Done
        (Error
           [
             diagnostic "eval/not-callable"
               "Function position must evaluate to a callable value.";
           ])

and handle_step callbacks env handlers step continuation =
  match step with
  | Done result -> (
      match result with
      | Error _ as error -> Done error
      | Ok value -> continuation (RPure value))
  | Perform_step (effect_name, op_name, args, resume) -> (
      match find_handler_clause handlers effect_name op_name with
      | None ->
          Perform_step
            ( effect_name,
              op_name,
              args,
              fun value ->
                handle_step callbacks env handlers (resume value) continuation
            )
      | Some clause ->
          let continuation_value value =
            handle_step callbacks env handlers (resume value) (fun resumed ->
                match require_pure resumed with
                | Error _ as error -> Done error
                | Ok resumed -> done_step resumed)
          in
          let handler_env =
            bind_continuation clause.continuation_name continuation_value env
            |> bind_pure_many (List.combine clause.arg_names args)
          in
          handle_step callbacks env handlers
            (eval_sequence callbacks handler_env clause.body (fun value ->
                 match require_pure value with
                 | Error _ as error -> Done error
                 | Ok value -> done_step value))
            continuation)

and parse_handlers handler_exprs =
  let rec loop acc = function
    | [] -> Ok (List.rev acc)
    | expr :: rest -> (
        match parse_handler expr with
        | Error _ as error -> error
        | Ok handler -> loop (handler :: acc) rest)
  in
  loop [] handler_exprs

and parse_handler = function
  | Ast.List (_, Ast.Symbol (_, effect_name) :: clause_exprs)
    when clause_exprs <> [] -> (
      match parse_handler_clauses clause_exprs with
      | Error _ as error -> error
      | Ok clauses -> Ok { effect_name; clauses })
  | expr ->
      Error
        [
          diagnostic ~span:(Ast.expr_span expr) "eval/handle-form"
            "handler must be (EffectName (op [params] body) ...).";
        ]

and parse_handler_clauses clauses =
  let rec loop acc = function
    | [] -> Ok (List.rev acc)
    | clause :: rest -> (
        match parse_handler_clause clause with
        | Error _ as error -> error
        | Ok clause -> loop (clause :: acc) rest)
  in
  loop [] clauses

and parse_handler_clause = function
  | Ast.List (span, Ast.Symbol (_, op_name) :: Ast.Vector (_, params) :: body)
    when body <> [] -> (
      match List.rev params with
      | Ast.Symbol (_, continuation_name) :: rev_arg_params ->
          let arg_names =
            List.rev rev_arg_params
            |> List.map (function
              | Ast.Symbol (_, name) -> Ok name
              | expr ->
                  Error
                    [
                      diagnostic ~span:(Ast.expr_span expr) "eval/handle-form"
                        "handler parameters must be symbols.";
                    ])
          in
          let rec collect acc = function
            | [] -> Ok (List.rev acc)
            | Ok value :: rest -> collect (value :: acc) rest
            | (Error _ as error) :: _ -> error
          in
          collect [] arg_names
          |> Result.map (fun arg_names ->
              { op_name; arg_names; continuation_name; body })
      | _ ->
          Error
            [
              diagnostic ~span "eval/handle-form"
                "handler params must end with a continuation symbol.";
            ])
  | expr ->
      Error
        [
          diagnostic ~span:(Ast.expr_span expr) "eval/handle-form"
            "handler clause must be (op-name [params] body).";
        ]

and find_handler_clause handlers effect_name op_name =
  handlers
  |> List.find_map (fun handler ->
      if handler.effect_name <> effect_name then None
      else
        List.find_opt (fun clause -> clause.op_name = op_name) handler.clauses)

and closure_env_from_values closure values =
  let required = List.length closure.params in
  if
    match closure.rest_param with
    | None -> List.length values <> required
    | Some _ -> List.length values < required
  then
    Error
      [
        diagnostic "eval/arity"
          (Printf.sprintf "Function expects %s%d arguments, received %d."
             (if Option.is_some closure.rest_param then "at least " else "")
             required (List.length values));
      ]
  else
    let rec take n acc values =
      if n = 0 then (List.rev acc, values)
      else
        match values with
        | [] -> (List.rev acc, [])
        | value :: rest -> take (n - 1) (value :: acc) rest
    in
    let required_values, rest_values = take required [] values in
    let rest_binding =
      match closure.rest_param with
      | None -> []
      | Some name -> [ (name, VList rest_values) ]
    in
    Ok
      (Env.extend
         (List.combine closure.params required_values @ rest_binding)
         (Env.of_bindings closure.env))

let eval callbacks env expr =
  let runtime_env = { pure_env = env; continuations = [] } in
  match
    eval_expr callbacks runtime_env expr (fun value ->
        match require_pure ~span:(Ast.expr_span expr) value with
        | Error _ as error -> Done error
        | Ok value -> done_step value)
  with
  | Done result -> result
  | Perform_step (effect_name, op_name, _, _) ->
      Error
        [
          diagnostic ~span:(Ast.expr_span expr) "eval/unhandled-effect"
            (Printf.sprintf
               "Unhandled effect operation %s.%s. Wrap it in a matching handle \
                form."
               effect_name op_name);
        ]

let eval_step callbacks env expr =
  let runtime_env = { pure_env = env; continuations = [] } in
  eval_expr callbacks runtime_env expr (fun value ->
      match require_pure ~span:(Ast.expr_span expr) value with
      | Error _ as error -> Done error
      | Ok value -> done_step value)

let eval_many_step callbacks env exprs =
  let runtime_env = { pure_env = env; continuations = [] } in
  eval_sequence callbacks runtime_env exprs (fun value ->
      match require_pure value with
      | Error _ as error -> Done error
      | Ok value -> done_step value)

let apply_closure_values_step callbacks closure values =
  match closure_env_from_values closure values with
  | Error _ as error -> Done error
  | Ok local_env ->
      eval_sequence callbacks { pure_env = local_env; continuations = [] }
        closure.body (fun value ->
          match require_pure value with
          | Error _ as error -> Done error
          | Ok value -> done_step value)

let parse_define_effect = function
  | Ast.Symbol (_, name) :: operation_exprs ->
      let rec loop acc = function
        | [] -> Ok (name, List.rev acc)
        | Ast.List (_, [ Ast.Symbol (_, "op"); Ast.Symbol (_, op_name); _type ])
          :: rest ->
            loop (op_name :: acc) rest
        | Ast.List (_, Ast.Symbol (_, "op") :: Ast.Symbol (_, op_name) :: _rest)
          :: rest ->
            loop (op_name :: acc) rest
        | expr :: _ ->
            Error
              [
                diagnostic ~span:(Ast.expr_span expr) "eval/define-effect-form"
                  "define-effect operations must be (op name type).";
              ]
      in
      loop [] operation_exprs
  | _ ->
      Error
        [
          diagnostic "eval/define-effect-form"
            "define-effect expects a symbol name followed by operation clauses.";
        ]

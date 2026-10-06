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

type diagnostic = Eval_common.diagnostic
type env = Env.t

type callbacks = {
  eval_expr : env -> Ast.expr -> (value, diagnostic list) result;
  eval_all : env -> Ast.expr list -> (value list, diagnostic list) result;
  eval_sequence : env -> Ast.expr list -> (value, diagnostic list) result;
  with_meta_lookup :
    env ->
    (unit -> (value, diagnostic list) result) ->
    (value, diagnostic list) result;
}

let diagnostic = Eval_common.diagnostic

let bind_let callbacks env bindings =
  let rec loop local_env = function
    | [] -> Ok local_env
    | Reader.Symbol (_, name) :: value_expr :: rest -> (
        match callbacks.eval_expr local_env value_expr with
        | Error _ as error -> error
        | Ok value -> loop (Env.bind name value local_env) rest)
    | _ ->
        Error
          [
            diagnostic "eval/let-bindings"
              "let bindings must contain even symbol/value pairs.";
          ]
  in
  loop env bindings

let eval_let callbacks env = function
  | Reader.Vector (_, bindings) :: body -> (
      match bind_let callbacks env bindings with
      | Error _ as error -> error
      | Ok local_env -> callbacks.eval_sequence local_env body)
  | _ ->
      Error
        [
          diagnostic "eval/let-bindings"
            "let expects a vector of symbol/value bindings followed by body \
             forms.";
        ]

let parse_params params =
  let rec loop acc = function
    | [] -> Ok (List.rev acc, None)
    | [ Reader.Symbol (_, "&"); Reader.Symbol (_, name) ] ->
        Ok (List.rev acc, Some name)
    | Reader.Symbol (_, "&") :: _ ->
        Error
          [
            diagnostic "eval/lambda-params"
              "& must be followed by exactly one rest parameter symbol.";
          ]
    | Reader.Symbol (_, name) :: rest -> loop (name :: acc) rest
    | param :: _ ->
        Error
          [
            diagnostic "eval/lambda-params"
              (Printf.sprintf "Function parameters must be symbols, got %s."
                 (Reader.expr_to_json param));
          ]
  in
  loop [] params

let eval_lambda env = function
  | Reader.Vector (_, params) :: body -> (
      match parse_params params with
      | Error _ as error -> error
      | Ok (params, rest_param) ->
          Ok (VClosure { params; rest_param; body; env = Env.bindings env }))
  | _ ->
      Error
        [
          diagnostic "eval/lambda-params"
            "fn expects a vector of parameter symbols followed by body forms.";
        ]

let apply_closure_values callbacks closure values =
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
    let local_env =
      Env.extend
        (List.combine closure.params required_values @ rest_binding)
        (Env.of_bindings closure.env)
    in
    callbacks.eval_sequence local_env closure.body

let apply_closure callbacks caller_env closure args =
  let required = List.length closure.params in
  if
    match closure.rest_param with
    | None -> List.length args <> required
    | Some _ -> List.length args < required
  then
    Error
      [
        diagnostic "eval/arity"
          (Printf.sprintf "Function expects %s%d arguments, received %d."
             (if Option.is_some closure.rest_param then "at least " else "")
             required (List.length args));
      ]
  else
    match callbacks.eval_all caller_env args with
    | Error _ as error -> error
    | Ok values ->
        callbacks.with_meta_lookup caller_env (fun () ->
            apply_closure_values callbacks closure values)

let eval_application callbacks env callee args =
  match callbacks.eval_expr env callee with
  | Error _ as error -> error
  | Ok (VClosure closure) -> apply_closure callbacks env closure args
  | Ok (VMacro _) ->
      Error
        [
          diagnostic "eval/unexpanded-macro"
            "Macro value reached evaluation before expansion.";
        ]
  | Ok _ ->
      Error
        [
          diagnostic "eval/not-callable"
            "Function position must evaluate to a callable value.";
        ]

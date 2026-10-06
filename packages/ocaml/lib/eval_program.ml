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

type diagnostic = Eval_common.diagnostic = {
  span : Ast.span option;
  code : string;
  message : string;
}

type env = Env.t

type callbacks = {
  eval_sequence : env -> Ast.expr list -> (value, diagnostic list) result;
  eval_diagnostics_to_expand : diagnostic list -> Expand.diagnostic list;
  eval_toplevel : env -> Ast.expr -> (value * env, diagnostic list) result;
  with_meta_lookup :
    env ->
    (unit -> (value, diagnostic list) result) ->
    (value, diagnostic list) result;
  apply_closure_values :
    Value.closure -> value list -> (value, diagnostic list) result;
}

let diagnostic = Eval_common.diagnostic

let expand_diagnostics (diagnostics : Expand.diagnostic list) : diagnostic list
    =
  List.map
    (fun (expand_diagnostic : Expand.diagnostic) ->
      diagnostic ?span:expand_diagnostic.Expand.span expand_diagnostic.code
        expand_diagnostic.message)
    diagnostics

let expand_program_with_env callbacks env exprs =
  let eval_body env body =
    callbacks.eval_sequence env body
    |> Result.map_error callbacks.eval_diagnostics_to_expand
  in
  Expand.expand_program ~eval_body env exprs
  |> Result.map_error expand_diagnostics

let expand_program callbacks exprs =
  expand_program_with_env callbacks Env.empty exprs |> Result.map fst

let evaluate_expanded_program_with_env callbacks env exprs =
  let rec loop env last = function
    | [] -> Ok (last, env)
    | expr :: rest -> (
        match Surface.runtime_constructors expr with
        | Some constructors -> loop env last (constructors @ rest)
        | None -> match callbacks.eval_toplevel env expr with
        | Error _ as error -> error
        | Ok (value, env) -> let value = match expr with Ast.List (_,Ast.Symbol (_,"define") :: Ast.Symbol (_,n) :: _) when String.starts_with ~prefix:"__descriptor/" n -> last | _ -> value in loop env value rest)
  in
  loop env VNil exprs

let evaluate_program_with_env callbacks env exprs =
  match expand_program_with_env callbacks env exprs with
  | Error _ as error -> error
  | Ok (expanded_exprs, _) ->
      evaluate_expanded_program_with_env callbacks env expanded_exprs

let evaluate_program callbacks exprs =
  evaluate_program_with_env callbacks Env.empty exprs |> Result.map fst

let apply_named callbacks env name value =
  let fallback = Env.lookup name env in
  match
    Eval_native_construct.apply ~fallback_available:(Option.is_some fallback)
      env name value
  with
  | Some value -> Ok value
  | None -> (
      match fallback with
      | Some (VClosure closure) ->
          callbacks.with_meta_lookup env (fun () ->
              callbacks.apply_closure_values closure [ value ])
      | Some _ ->
          Error
            [
              diagnostic "eval/not-callable"
                (Printf.sprintf "%S is not callable." name);
            ]
      | None ->
          Error
            [
              diagnostic "eval/unbound-symbol"
                (Printf.sprintf "Unbound symbol %S." name);
            ])

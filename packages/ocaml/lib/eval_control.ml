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
  eval_expr_to_quote : env -> Ast.expr -> (value, Quote.diagnostic list) result;
}

let diagnostic = Eval_common.diagnostic

let quote_diagnostics (diagnostics : Quote.diagnostic list) : diagnostic list =
  List.map
    (fun (quote_diagnostic : Quote.diagnostic) ->
      diagnostic quote_diagnostic.Quote.code quote_diagnostic.message)
    diagnostics

let eval_quote args = Quote.quote args |> Result.map_error quote_diagnostics

let eval_quasiquote callbacks env args =
  let eval expr = callbacks.eval_expr_to_quote env expr in
  Quote.quasiquote ~eval args |> Result.map_error quote_diagnostics

let eval_sequence callbacks env exprs =
  let rec loop last = function
    | [] -> Ok last
    | expr :: rest -> (
        match callbacks.eval_expr env expr with
        | Error _ as error -> error
        | Ok value -> loop value rest)
  in
  loop VNil exprs

let eval_if callbacks env = function
  | [ condition; consequent ] -> (
      match callbacks.eval_expr env condition with
      | Error _ as error -> error
      | Ok value ->
          if Value.truthy value then callbacks.eval_expr env consequent
          else Ok VNil)
  | [ condition; consequent; alternate ] -> (
      match callbacks.eval_expr env condition with
      | Error _ as error -> error
      | Ok value ->
          if Value.truthy value then callbacks.eval_expr env consequent
          else callbacks.eval_expr env alternate)
  | _ ->
      Error
        [
          diagnostic "eval/arity"
            "if expects a condition, consequent, and optional alternate.";
        ]

let eval_when callbacks env = function
  | condition :: body -> (
      match callbacks.eval_expr env condition with
      | Error _ as error -> error
      | Ok value ->
          if Value.truthy value then eval_sequence callbacks env body
          else Ok VNil)
  | [] ->
      Error
        [
          diagnostic "eval/arity"
            "when expects a condition followed by zero or more body forms.";
        ]

let rec eval_cond callbacks env = function
  | [] -> Ok VNil
  | [ _ ] ->
      Error
        [ diagnostic "eval/cond-form" "cond expects test/expression pairs." ]
  | Reader.Keyword (_, ":else") :: expr :: _ -> callbacks.eval_expr env expr
  | Reader.Symbol (_, "else") :: expr :: _ -> callbacks.eval_expr env expr
  | condition :: expr :: rest -> (
      match callbacks.eval_expr env condition with
      | Error _ as error -> error
      | Ok value ->
          if Value.truthy value then callbacks.eval_expr env expr
          else eval_cond callbacks env rest)

let rec eval_match_clauses callbacks env value = function
  | [] -> Error [diagnostic "eval/match-failed" "No pattern matched the value."]
  | [ _ ] ->
      Error
        [
          diagnostic "eval/match-form" "match expects pattern/expression pairs.";
        ]
  | Reader.Keyword (_, ":else") :: expr :: _ -> callbacks.eval_expr env expr
  | Reader.Symbol (_, "else") :: expr :: _ -> callbacks.eval_expr env expr
  | pattern :: expr :: rest -> (
      match Pattern.match_value ~constructor_spec:(fun n -> Env.lookup ("__constructor/" ^ n) env) pattern value with
      | Some bindings -> callbacks.eval_expr (Env.extend bindings env) expr
      | None -> eval_match_clauses callbacks env value rest)

let eval_match callbacks env = function
  | value_expr :: clauses -> (
      match callbacks.eval_expr env value_expr with
      | Error _ as error -> error
      | Ok value -> eval_match_clauses callbacks env value clauses)
  | [] ->
      Error
        [
          diagnostic "eval/match-form"
            "match expects a value expression followed by pattern/expression \
             pairs.";
        ]

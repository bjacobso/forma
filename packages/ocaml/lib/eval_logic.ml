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
}

let diagnostic = Eval_common.diagnostic

let eval_and ctx env exprs =
  let rec loop last = function
    | [] -> Ok last
    | expr :: rest -> (
        match ctx.eval_expr env expr with
        | Error _ as error -> error
        | Ok value when Value.truthy value -> loop value rest
        | Ok value -> Ok value)
  in
  loop (VBool true) exprs

let eval_or ctx env exprs =
  let rec loop last = function
    | [] -> Ok last
    | expr :: rest -> (
        match ctx.eval_expr env expr with
        | Error _ as error -> error
        | Ok value when Value.truthy value -> Ok value
        | Ok value -> loop value rest)
  in
  loop VNil exprs

let eval_not ctx env = function
  | [ expr ] -> (
      match ctx.eval_expr env expr with
      | Error _ as error -> error
      | Ok value -> Ok (VBool (not (Value.truthy value))))
  | _ -> Error [ diagnostic "eval/arity" "not expects one argument." ]

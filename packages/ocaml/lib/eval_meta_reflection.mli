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
}

type check_expr_handler =
  value -> value -> value -> (value, diagnostic list) result

type infer_expr_handler = value -> value -> (value, diagnostic list) result
type lookup_declaration_handler = string -> value option

type runtime = {
  current_check_expr : unit -> check_expr_handler option;
  current_infer_expr : unit -> infer_expr_handler option;
  current_lookup_declaration : unit -> lookup_declaration_handler option;
}

val eval :
  context ->
  runtime ->
  Env.t ->
  string ->
  Reader.expr list ->
  (value option, diagnostic list) result

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
  eval_required_builtin :
    Env.t -> string -> Reader.expr list -> (value, diagnostic list) result;
}

type check_expr_handler =
  value -> value -> value -> (value, diagnostic list) result

type infer_expr_handler = value -> value -> (value, diagnostic list) result
type lookup_declaration_handler = string -> value option

val with_check_expr : check_expr_handler -> (unit -> 'a) -> 'a
val with_infer_expr : infer_expr_handler -> (unit -> 'a) -> 'a
val with_lookup_declaration : lookup_declaration_handler -> (unit -> 'a) -> 'a
val current_lookup_declaration : unit -> lookup_declaration_handler option

val eval :
  context ->
  Env.t ->
  string ->
  Reader.expr list ->
  (value option, diagnostic list) result

val current_environment : unit -> Env.t option
val with_environment : Env.t -> (unit -> 'a) -> 'a

val builtin_names : string list

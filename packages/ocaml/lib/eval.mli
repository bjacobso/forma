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

type env = Env.t

val evaluate_program : Ast.expr list -> (value, diagnostic list) result

val evaluate_program_with_env :
  env -> Ast.expr list -> (value * env, diagnostic list) result

val evaluate_effect_program_step : env -> Ast.expr list -> Eval_effect.step

val apply_closure_values :
  closure -> value list -> (value, diagnostic list) result

val apply_effect_closure_values_step : closure -> value list -> Eval_effect.step
val expand_program : Ast.expr list -> (Ast.expr list, diagnostic list) result

val expand_program_with_env :
  env -> Ast.expr list -> (Ast.expr list * env, diagnostic list) result

val apply_named : env -> string -> value -> (value, diagnostic list) result
val value_to_json : value -> string
val diagnostic_to_json : diagnostic -> string
val with_span : Ast.span -> diagnostic list -> diagnostic list

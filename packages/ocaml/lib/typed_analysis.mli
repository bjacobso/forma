type diagnostic = Type_diagnostic.t
type env = Type_env.env

type callbacks = {
  infer_expr :
    env ->
    Core_ast.expr ->
    (Type_expr.subst * Type_expr.ty, diagnostic list) result;
  check_expr : env -> Core_ast.expr -> Type_expr.ty -> (Type_expr.subst * Type_expr.ty, diagnostic list) result;
  pattern_bindings : Core_ast.pattern -> env;
}

val infer_toplevel_core :
  callbacks ->
  env ->
  Core_ast.expr ->
  (Type_expr.ty * env, diagnostic list) result

val annotate_expr :
  callbacks ->
  env ->
  Core_ast.expr ->
  (Typed_core.annotation list, diagnostic list) result

type diagnostic = Type_diagnostic.t
type env = Type_env.env

type callbacks = {
  infer_expr :
    env ->
    Core_ast.expr ->
    (Type_expr.subst * Type_expr.ty, diagnostic list) result;
  check_expr : env -> Core_ast.expr -> Type_expr.ty -> (Type_expr.subst * Type_expr.ty, diagnostic list) result;
}

val infer_application :
  callbacks ->
  env ->
  Core_ast.expr ->
  Core_ast.expr list ->
  (Type_expr.subst * Type_expr.ty, diagnostic list) result

val infer_apply :
  callbacks ->
  env ->
  Type_expr.subst ->
  Type_expr.ty ->
  Core_ast.expr list ->
  (Type_expr.subst * Type_expr.ty, diagnostic list) result

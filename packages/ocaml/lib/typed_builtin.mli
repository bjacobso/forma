type diagnostic = Type_diagnostic.t
type env = Type_env.env

type callbacks = {
  infer_expr :
    env ->
    Core_ast.expr ->
    (Type_expr.subst * Type_expr.ty, diagnostic list) result;
  check_expr : env -> Core_ast.expr -> Type_expr.ty -> (Type_expr.subst * Type_expr.ty, diagnostic list) result;
  infer_apply :
    env ->
    Type_expr.subst ->
    Type_expr.ty ->
    Core_ast.expr list ->
    (Type_expr.subst * Type_expr.ty, diagnostic list) result;
}

val infer_named_application :
  callbacks ->
  env ->
  string ->
  Core_ast.expr list ->
  (Type_expr.subst * Type_expr.ty, diagnostic list) result

val builtin_value_type : string -> Type_expr.ty option

type diagnostic = Type_diagnostic.t
type env = Type_env.env

type callbacks = {
  infer_expr :
    env ->
    Core_ast.expr ->
    (Type_expr.subst * Type_expr.ty, diagnostic list) result;
  check_expr : env -> Core_ast.expr -> Type_expr.ty -> (Type_expr.subst * Type_expr.ty, diagnostic list) result;
}

val infer_collection :
  callbacks ->
  env ->
  (Type_expr.ty -> Type_expr.ty) ->
  Core_ast.expr list ->
  (Type_expr.subst * Type_expr.ty, diagnostic list) result

val infer_first :
  callbacks ->
  env ->
  Core_ast.expr list ->
  (Type_expr.subst * Type_expr.ty, diagnostic list) result

val infer_count :
  callbacks ->
  env ->
  Core_ast.expr list ->
  (Type_expr.subst * Type_expr.ty, diagnostic list) result

val infer_nth :
  callbacks ->
  env ->
  Core_ast.expr list ->
  (Type_expr.subst * Type_expr.ty, diagnostic list) result

val infer_rest :
  callbacks ->
  env ->
  Core_ast.expr list ->
  (Type_expr.subst * Type_expr.ty, diagnostic list) result

val infer_map :
  callbacks ->
  env ->
  string ->
  Core_ast.expr list ->
  (Type_expr.subst * Type_expr.ty, diagnostic list) result

val infer_filter :
  callbacks ->
  env ->
  string ->
  Core_ast.expr list ->
  (Type_expr.subst * Type_expr.ty, diagnostic list) result

val infer_flat_map :
  callbacks ->
  env ->
  string ->
  Core_ast.expr list ->
  (Type_expr.subst * Type_expr.ty, diagnostic list) result

val infer_append :
  callbacks ->
  env ->
  Core_ast.expr list ->
  (Type_expr.subst * Type_expr.ty, diagnostic list) result

val infer_concat :
  callbacks ->
  env ->
  Core_ast.expr list ->
  (Type_expr.subst * Type_expr.ty, diagnostic list) result

val infer_reduce :
  callbacks ->
  env ->
  Core_ast.expr list ->
  (Type_expr.subst * Type_expr.ty, diagnostic list) result

val infer_conj :
  callbacks ->
  env ->
  Core_ast.expr list ->
  (Type_expr.subst * Type_expr.ty, diagnostic list) result

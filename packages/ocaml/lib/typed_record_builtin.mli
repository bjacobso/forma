type diagnostic = Type_diagnostic.t
type env = Type_env.env

type callbacks = {
  infer_expr :
    env ->
    Core_ast.expr ->
    (Type_expr.subst * Type_expr.ty, diagnostic list) result;
}

val infer_record :
  callbacks ->
  env ->
  Core_ast.field list ->
  (Type_expr.subst * Type_expr.ty, diagnostic list) result

val infer_get_field :
  Type_expr.subst ->
  Type_expr.ty ->
  string ->
  (Type_expr.subst * Type_expr.ty, diagnostic list) result

val infer_get_in :
  callbacks ->
  env ->
  Core_ast.expr list ->
  (Type_expr.subst * Type_expr.ty, diagnostic list) result

val infer_assoc :
  callbacks ->
  env ->
  Core_ast.expr list ->
  (Type_expr.subst * Type_expr.ty, diagnostic list) result

val infer_merge :
  callbacks ->
  env ->
  Core_ast.expr list ->
  (Type_expr.subst * Type_expr.ty, diagnostic list) result

val infer_dissoc :
  callbacks ->
  env ->
  Core_ast.expr list ->
  (Type_expr.subst * Type_expr.ty, diagnostic list) result

val infer_select_keys :
  callbacks ->
  env ->
  Core_ast.expr list ->
  (Type_expr.subst * Type_expr.ty, diagnostic list) result

val infer_keys :
  callbacks ->
  env ->
  Core_ast.expr list ->
  (Type_expr.subst * Type_expr.ty, diagnostic list) result

val infer_values :
  callbacks ->
  env ->
  Core_ast.expr list ->
  (Type_expr.subst * Type_expr.ty, diagnostic list) result

val record_values_item_type : Type_expr.subst -> (string * Type_expr.ty) list -> Type_expr.ty

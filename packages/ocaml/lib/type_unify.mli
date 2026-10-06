val unify :
  Type_expr.ty ->
  Type_expr.ty ->
  (Type_expr.subst, Type_diagnostic.t list) result

val unify_with_span :
  Ast.span ->
  Type_expr.ty ->
  Type_expr.ty ->
  (Type_expr.subst, Type_diagnostic.t list) result

val unify_many :
  Type_expr.ty list ->
  Type_expr.ty list ->
  (Type_expr.subst, Type_diagnostic.t list) result

val literal_base : string -> Type_expr.ty option
val assign : Type_expr.ty -> Type_expr.ty -> (Type_expr.subst, Type_diagnostic.t list) result
val assign_many : Type_expr.ty list -> Type_expr.ty list -> (Type_expr.subst, Type_diagnostic.t list) result
val join : Type_expr.ty -> Type_expr.ty -> (Type_expr.subst * Type_expr.ty, Type_diagnostic.t list) result

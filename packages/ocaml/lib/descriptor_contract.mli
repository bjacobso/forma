val type_expr_of_meta_type_value : Value.t -> Type_expr.ty option

val required_declaration_summary_of_emitted_value :
  Value.t -> (Artifact_summary_types.declaration_summary, string) result

val descriptor_hooks : ?syntax:Ast.expr list -> Env.t -> Descriptor_protocol.descriptor_hooks
val validate_unified_forms : Env.t -> Ast.expr list -> (unit, Type_diagnostic.t list) result

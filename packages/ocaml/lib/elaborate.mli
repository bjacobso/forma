type collected_declaration
type emitted_value
type emitted_declaration

type phase_timings = {
  expand_ms : float;
  collect_ms : float;
  apply_hook_ms : float;
  hook_timings : (string * float) list;
  hook_counts : (string * int) list;
  summary_expectation_ms : float;
  payload_contract_ms : float;
  summary_validation_ms : float;
}

val collect_declarations :
  Eval.env ->
  Ast.expr list ->
  (collected_declaration list * Eval.env, Eval.diagnostic list) result

val emitted_values :
  Eval.env -> Ast.expr list -> (emitted_value list, Eval.diagnostic list) result

val emitted_declarations :
  Eval.env ->
  Ast.expr list ->
  (emitted_declaration list, Eval.diagnostic list) result

val emitted_declarations_with_timings :
  Eval.env ->
  Ast.expr list ->
  (emitted_declaration list * phase_timings, Eval.diagnostic list) result

val typed_artifact_declarations_of_emitted :
  source_id:string ->
  emitted_declaration list ->
  (Packageable_declaration.t list, Eval.diagnostic list) result

val typed_artifact_declarations :
  Eval.env ->
  source_id:string ->
  Ast.expr list ->
  (Packageable_declaration.t list, Eval.diagnostic list) result

val emitted_declarations_json : emitted_declaration list -> string
val emitted_values_json : emitted_value list -> string
val values_json : Eval.value list -> string

val emitted_values_diagnostics : emitted_value list -> Diagnostic.t list

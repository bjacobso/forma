type payload

val make_payload : value:Artifact_validated_payload.t -> payload
val payload_value : payload -> Artifact_validated_payload.t

type payload_contract = Artifact_payload_descriptor.contract
type validator

val make_validator : name:string -> value:Value.t -> validator
val validator_name : validator -> string
val validator_value : validator -> Value.t

type t

val make :
  diagnostics:Diagnostic.t list ->
  payload:payload ->
  payload_contract:payload_contract ->
  validators:validator list ->
  summary:Artifact_summary_types.declaration_summary ->
  source_id:string ->
  form_index:int ->
  span:Ast.span ->
  t

val payload : t -> payload
val payload_contract : t -> payload_contract
val validators : t -> validator list
val summary : t -> Artifact_summary_types.declaration_summary
val source_id : t -> string
val form_index : t -> int
val span : t -> Ast.span

val diagnostics : t -> Diagnostic.t list

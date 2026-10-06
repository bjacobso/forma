val artifact_json : Artifact_types.artifact -> string

val failed_artifact_json :
  name:string ->
  media_type:string ->
  ir_version:Artifact_package_metadata.ir_version ->
  kind:Artifact_package_metadata.kind ->
  Diagnostic.t list ->
  string
val declaration_payload_json : Packageable_declaration.t -> Ir_json.t

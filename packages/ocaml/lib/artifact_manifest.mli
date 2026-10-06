val ir_version : Artifact_package_metadata.ir_version
val canonical_kind : Artifact_package_metadata.kind
val artifact_name : string
val artifact_media_type : string

val build_package :
  engine_name:string ->
  engine_version:string ->
  session_id:string ->
  sources:(string, Source.t) Hashtbl.t ->
  preludes:(string, Source.t) Hashtbl.t ->
  source_ids:string list ->
  declarations:Artifact_types.package_declaration list ->
  modules:Module_decl.t list ->
  type_summary:Artifact_summary_types.package_summary ->
  diagnostics:Diagnostic.t list ->
  Artifact_types.package

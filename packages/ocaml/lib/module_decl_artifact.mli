val public_export_hash : Module_decl.t -> string

val to_json :
  ?resolve_exports:(string -> string list option) ->
  source_hash:string ->
  declarations:Module_decl.declaration list ->
  Module_decl.t ->
  Ir_json.t

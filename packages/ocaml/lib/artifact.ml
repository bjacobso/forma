module Validation = Artifact_validation
module Declaration_packaging = Artifact_declaration_packaging
module Manifest = Artifact_manifest

let validate_declarations = Validation.validate_declarations

let package ?(modules = []) ~engine_name ~engine_version ~session_id ~sources
    ~preludes ~source_ids declarations =
  match validate_declarations declarations with
  | _ :: _ as diagnostics -> Error diagnostics
  | [] -> (
      match Declaration_packaging.package_declarations sources declarations with
      | Error _ as error -> error
      | Ok package_declarations ->
          Ok
            (Manifest.build_package ~engine_name ~engine_version ~session_id
               ~sources ~preludes ~source_ids ~declarations:package_declarations
               ~modules
               ~diagnostics:(List.concat_map Packageable_declaration.diagnostics declarations)
               ~type_summary:
                 (Artifact_summary.package_type_summary package_declarations)))

let canonical_ir_artifact ?(modules = []) ~engine_name ~engine_version
    ~session_id ~sources ~preludes ~source_ids declarations =
  match
    package ~engine_name ~engine_version ~session_id ~sources ~preludes
      ~source_ids ~modules declarations
  with
  | Error _ as error -> error
  | Ok content ->
      Ok
        (Artifact_types.make_artifact ~name:Manifest.artifact_name
           ~media_type:Manifest.artifact_media_type ~content)

module Json = Artifact_json

let artifact_json = Json.artifact_json

let canonical_ir_artifact_json ?(modules = []) ~engine_name ~engine_version
    ~session_id ~sources ~preludes ~source_ids declarations =
  match
    canonical_ir_artifact ~engine_name ~engine_version ~session_id ~sources
      ~preludes ~source_ids ~modules declarations
  with
  | Ok artifact -> artifact_json artifact
  | Error diagnostics ->
      Json.failed_artifact_json ~name:Manifest.artifact_name
        ~media_type:Manifest.artifact_media_type ~ir_version:Manifest.ir_version
        ~kind:Manifest.canonical_kind diagnostics

let ir_version = Artifact_package_metadata.current_ir_version
let canonical_kind = Artifact_package_metadata.canonical_ir_kind
let hash_algorithm = Artifact_package_metadata.md5_hash_algorithm
let artifact_name = "ir.json"
let artifact_media_type = "application/vnd.forma.ir+json"

let sorted_hashtbl_keys table =
  Hashtbl.fold (fun key _ keys -> key :: keys) table []
  |> List.sort String.compare

let source_manifest table id =
  match Hashtbl.find_opt table id with
  | Some source ->
      Some
        (Artifact_types.make_source_manifest ~id
           ~hash:(Artifact_package_metadata.source_hash (Source.hash source)))
  | None -> None

let source_manifests table ids = List.filter_map (source_manifest table) ids

let build_package ~engine_name ~engine_version ~session_id ~sources ~preludes
    ~source_ids ~declarations ~modules ~type_summary ~diagnostics =
  let declarations_hash =
    Artifact_package_hash.hash_declarations ~algorithm:hash_algorithm
      declarations
  in
  let engine =
    Artifact_types.make_engine_manifest ~name:engine_name
      ~version:engine_version
  in
  Artifact_types.make_package ~ir_version ~kind:canonical_kind ~engine
    ~session_id ~hash_algorithm ~source_ids
    ~sources:(source_manifests sources source_ids)
    ~preludes:(source_manifests preludes (sorted_hashtbl_keys preludes))
    ~declarations_hash ~declarations ~modules ~type_summary ~diagnostics

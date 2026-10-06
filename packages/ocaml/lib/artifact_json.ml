open Ir_json

let declaration_payload_json declaration =
  Artifact_validated_payload.canonical_json
    (Packageable_declaration.payload_value
       (Packageable_declaration.payload declaration))

let option_int_json = function
  | Some value -> Ir_json.Int value
  | None -> Ir_json.Null

let provenance_span_json (span : Artifact_types.provenance_span) =
  Ir_json.Object
    [
      ("startOffset", Int (Artifact_types.provenance_span_start_offset span));
      ("endOffset", Int (Artifact_types.provenance_span_end_offset span));
      ( "startLine",
        option_int_json (Artifact_types.provenance_span_start_line span) );
      ( "startColumn",
        option_int_json (Artifact_types.provenance_span_start_column span) );
      ("endLine", option_int_json (Artifact_types.provenance_span_end_line span));
      ( "endColumn",
        option_int_json (Artifact_types.provenance_span_end_column span) );
    ]

let declaration_provenance_json
    (provenance : Artifact_types.declaration_provenance) =
  Ir_json.Object
    [
      ( "declarationIndex",
        Int (Artifact_types.declaration_provenance_index provenance) );
      ( "sourceId",
        String (Artifact_types.declaration_provenance_source_id provenance) );
      ( "formIndex",
        Int (Artifact_types.declaration_provenance_form_index provenance) );
      ( "span",
        provenance_span_json
          (Artifact_types.declaration_provenance_span provenance) );
    ]

let derived_manifest (package : Artifact_types.package) =
  let declarations = Artifact_types.package_declarations package in
  Artifact_summary_types.make_derived_manifest ~kind:"DerivedManifest"
    ~target:"manifest"
    ~source_kind:
      (Artifact_package_metadata.kind_to_string
         (Artifact_types.package_kind package))
    ~source_ir_version:
      (Artifact_package_metadata.ir_version_to_string
         (Artifact_types.package_ir_version package))
    ~declaration_count:(List.length declarations)
    ~declarations:
      (List.map
         (fun (declaration : Artifact_types.package_declaration) ->
           Artifact_types.package_declaration_type_summary declaration)
         declarations)

let source_hashes_json manifests =
  Ir_json.Object
    (List.map
       (fun manifest ->
         ( Artifact_types.source_manifest_id manifest,
           Ir_json.String
             (Artifact_package_metadata.source_hash_to_string
                (Artifact_types.source_manifest_hash manifest)) ))
       manifests)

let source_ids_json manifests =
  Ir_json.Array
    (List.map
       (fun manifest ->
         Ir_json.String (Artifact_types.source_manifest_id manifest))
       manifests)

let module_source_hash package source_id =
  Artifact_types.package_sources package
  |> List.find_opt (fun manifest ->
      Artifact_types.source_manifest_id manifest = source_id)
  |> Option.map (fun manifest ->
      Artifact_package_metadata.source_hash_to_string
        (Artifact_types.source_manifest_hash manifest))
  |> Option.value ~default:""

let module_declarations package module_id =
  Artifact_types.package_declarations package
  |> List.filter_map (fun declaration ->
      let provenance =
        Artifact_types.package_declaration_provenance declaration
      in
      if Artifact_types.declaration_provenance_source_id provenance <> module_id
      then None
      else
        let summary =
          Artifact_types.package_declaration_type_summary declaration
        in
        match Artifact_summary_types.declaration_summary_name summary with
        | None -> None
        | Some local_name ->
            Some
              Module_decl.
                {
                  local_name;
                  kind = Artifact_summary_types.declaration_summary_kind summary;
                  canonical_name = module_id ^ "/" ^ local_name;
                })

let module_public_export_names module_decl =
  module_decl.Module_decl.explicit_exports @ List.concat_map (fun (re_export : Module_decl.module_re_export) -> re_export.names) module_decl.Module_decl.re_exports

let modules_json package =
  let modules = Artifact_types.package_modules package in
  let module_exports =
    modules
    |> List.map (fun module_decl ->
        ( module_decl.Module_decl.module_id,
          module_public_export_names
            module_decl ))
  in
  let resolve_exports module_id = List.assoc_opt module_id module_exports in
  modules
  |> List.map (fun module_decl ->
      Module_decl_artifact.to_json
        ~resolve_exports
        ~source_hash:
          (module_source_hash package module_decl.Module_decl.source_path)
        ~declarations:
          (module_declarations package module_decl.Module_decl.module_id)
        module_decl)

let diagnostics_json diagnostics =
  Ir_json.Array (List.map Diagnostic.to_ir_json diagnostics)

let declaration_summary_json summary =
  Ir_json.Object
    [
      ( "kind",
        Ir_json.String (Artifact_summary_types.declaration_summary_kind summary)
      );
      ( "name",
        match Artifact_summary_types.declaration_summary_name summary with
        | Some name -> Ir_json.String name
        | None -> Ir_json.Null );
      ( "resultType",
        Ir_json.String
          (Artifact_summary_types.declaration_summary_result_type summary) );
    ]

let package_summary_json summary =
  Ir_json.Object
    [
      ( "declarationCount",
        Ir_json.Int
          (Artifact_summary_types.package_summary_declaration_count summary) );
      ( "resultTypes",
        Ir_json.Object
          (List.map
             (fun (name, count) -> (name, Ir_json.Int count))
             (Artifact_summary_types.package_summary_result_types summary)) );
    ]

let derived_manifest_json manifest =
  Ir_json.Object
    [
      ( "kind",
        Ir_json.String (Artifact_summary_types.derived_manifest_kind manifest)
      );
      ( "target",
        Ir_json.String (Artifact_summary_types.derived_manifest_target manifest)
      );
      ( "sourceKind",
        Ir_json.String
          (Artifact_summary_types.derived_manifest_source_kind manifest) );
      ( "sourceIrVersion",
        Ir_json.String
          (Artifact_summary_types.derived_manifest_source_ir_version manifest)
      );
      ( "declarationCount",
        Ir_json.Int
          (Artifact_summary_types.derived_manifest_declaration_count manifest)
      );
      ( "declarations",
        Ir_json.Array
          (List.map declaration_summary_json
             (Artifact_summary_types.derived_manifest_declarations manifest)) );
    ]

let artifact_object ~name ~media_type content =
  Ir_json.Object
    [
      ("name", String name);
      ("mediaType", String media_type);
      ("content", content);
    ]

let package_json (package : Artifact_types.package) =
  let declarations = Artifact_types.package_declarations package in
  let declarations =
    List.map
      (fun (declaration : Artifact_types.package_declaration) ->
        Artifact_validated_payload.canonical_json
          (Artifact_types.package_declaration_value declaration))
      declarations
  in
  let declaration_type_summaries =
    List.map
      (fun (declaration : Artifact_types.package_declaration) ->
        declaration_summary_json
          (Artifact_types.package_declaration_type_summary declaration))
      (Artifact_types.package_declarations package)
  in
  let provenance =
    List.map
      (fun (declaration : Artifact_types.package_declaration) ->
        declaration_provenance_json
          (Artifact_types.package_declaration_provenance declaration))
      (Artifact_types.package_declarations package)
  in
  let engine = Artifact_types.package_engine package in
  Ir_json.Object
    [
      ( "irVersion",
        String
          (Artifact_package_metadata.ir_version_to_string
             (Artifact_types.package_ir_version package)) );
      ( "kind",
        String
          (Artifact_package_metadata.kind_to_string
             (Artifact_types.package_kind package)) );
      ( "engine",
        Object
          [
            ("name", String (Artifact_types.engine_manifest_name engine));
            ("version", String (Artifact_types.engine_manifest_version engine));
          ] );
      ("sessionId", String (Artifact_types.package_session_id package));
      ( "hashAlgorithm",
        String
          (Artifact_package_metadata.hash_algorithm_to_string
             (Artifact_types.package_hash_algorithm package)) );
      ( "sourceIds",
        Array
          (List.map
             (fun id -> String id)
             (Artifact_types.package_source_ids package)) );
      ( "sourceHashes",
        source_hashes_json (Artifact_types.package_sources package) );
      ("preludeIds", source_ids_json (Artifact_types.package_preludes package));
      ( "preludeHashes",
        source_hashes_json (Artifact_types.package_preludes package) );
      ("modules", Array (modules_json package));
      ( "declarationCount",
        Int (List.length (Artifact_types.package_declarations package)) );
      ( "declarationsHash",
        String
          (Artifact_package_metadata.declarations_hash_to_string
             (Artifact_types.package_declarations_hash package)) );
      ("declarationProvenance", Array provenance);
      ("declarationTypeSummaries", Array declaration_type_summaries);
      ("declarations", Array declarations);
      ( "derivedArtifacts",
        Array [ derived_manifest_json (derived_manifest package) ] );
      ( "typeSummary",
        package_summary_json (Artifact_types.package_type_summary package) );
      ( "diagnostics",
        diagnostics_json (Artifact_types.package_diagnostics package) );
    ]

let artifact_json (artifact : Artifact_types.artifact) =
  Ir_json.to_string
    (artifact_object
       ~name:(Artifact_types.artifact_name artifact)
       ~media_type:(Artifact_types.artifact_media_type artifact)
       (package_json (Artifact_types.artifact_content artifact)))

let failed_artifact_json ~name ~media_type ~ir_version ~kind diagnostics =
  Ir_json.to_string
    (artifact_object ~name ~media_type
       (Ir_json.Object
          [
            ( "irVersion",
              String (Artifact_package_metadata.ir_version_to_string ir_version)
            );
            ("kind", String (Artifact_package_metadata.kind_to_string kind));
            ("diagnostics", diagnostics_json diagnostics);
          ]))

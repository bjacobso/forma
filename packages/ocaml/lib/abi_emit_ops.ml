type request = Abi_request.t

module Response = Abi_response

type source_resolution =
  | Missing_source of string
  | Emitted_declaration_error of Eval.diagnostic list
  | Resolved_source of Elaborate.emitted_declaration list

type source_value_resolution =
  | Missing_value_source of string
  | Emitted_value_error of Eval.diagnostic list
  | Resolved_values of Elaborate.emitted_value list

type source_artifact_resolution =
  | Artifact_missing_source of string
  | Artifact_emitted_declaration_error of Eval.diagnostic list
  | Artifact_typed_declaration_error of Eval.diagnostic list
  | Artifact_typed_declarations of Packageable_declaration.t list

type cached_artifact_resolution = {
  resolution : source_artifact_resolution;
  cache_hit : bool;
  validation_diagnostic_count : int option;
}

type source_result = {
  json : string;
  succeeded : bool;
  declaration_count : int;
  cache_hit : bool;
}

let sorted_hashtbl_keys table =
  Hashtbl.fold (fun key _ keys -> key :: keys) table []
  |> List.sort String.compare

let parsed_prelude_exprs (session : Session.t) =
  sorted_hashtbl_keys session.parsed_preludes
  |> List.concat_map (fun source_id ->
      match Hashtbl.find_opt session.parsed_preludes source_id with
      | Some exprs -> exprs
      | None -> [])

let validate_emit_preludes (session : Session.t) =
  Descriptor_metacheck.validate_artifact_hooks session.core_env
    (parsed_prelude_exprs session)

let requested_source_ids (session : Session.t) (request : request) =
  match (request.source_id, request.source_ids) with
  | Some source_id, _ -> [ source_id ]
  | None, Some source_ids -> source_ids
  | None, None -> sorted_hashtbl_keys session.parsed_sources

let source_modules (session : Session.t) source_ids =
  source_ids
  |> List.filter_map (fun source_id ->
      Hashtbl.find_opt session.source_modules source_id)

let resolve_source (session : Session.t) source_id =
  match Hashtbl.find_opt session.parsed_sources source_id with
  | None -> Missing_source source_id
  | Some exprs -> (
      match Elaborate.emitted_declarations (Artifact_context.environment session ()) (Artifact_context.expressions exprs) with
      | Error diagnostics -> Emitted_declaration_error diagnostics
      | Ok declarations -> Resolved_source declarations)

let resolve_source_values (session : Session.t) source_id =
  match Hashtbl.find_opt session.parsed_sources source_id with
  | None -> Missing_value_source source_id
  | Some exprs -> (
      match Elaborate.emitted_values (Artifact_context.environment session ()) (Artifact_context.expressions exprs) with
      | Error diagnostics -> Emitted_value_error diagnostics
      | Ok values -> Resolved_values values)

let resolve_typed_artifact_declarations ~source_id = function
  | Missing_source source_id -> Artifact_missing_source source_id
  | Emitted_declaration_error diagnostics ->
      Artifact_emitted_declaration_error diagnostics
  | Resolved_source emitted -> (
      match
        Elaborate.typed_artifact_declarations_of_emitted ~source_id emitted
      with
      | Error diagnostics -> Artifact_typed_declaration_error diagnostics
      | Ok declarations -> Artifact_typed_declarations declarations)

let resolve_typed_artifact_declarations_for_exprs env ~source_id exprs =
  let exprs=Artifact_context.expressions exprs in
  match
    ( Elaborate.emitted_declarations env (Artifact_context.expressions exprs),
      Mechanics_artifact.declarations ~source_id exprs )
  with
  | Error diagnostics, _ | _, Error diagnostics ->
      Artifact_emitted_declaration_error diagnostics
  | Ok emitted, Ok mechanics -> (
      match
        resolve_typed_artifact_declarations ~source_id (Resolved_source emitted)
      with
      | Artifact_typed_declarations declarations ->
          Artifact_typed_declarations (declarations @ mechanics)
      | other -> other)

let resolve_cached_typed_artifact_declarations (session : Session.t) source_id =
  match Hashtbl.find_opt session.sources source_id with
  | None ->
      {
        resolution = Artifact_missing_source source_id;
        cache_hit = false;
        validation_diagnostic_count = None;
      }
  | Some source -> (
      let source_hash = Source.hash source in
      let prelude_fingerprint = Session.prelude_fingerprint session in
      match Hashtbl.find_opt session.artifact_declarations source_id with
      | Some cached
        when cached.source_hash = source_hash
             && cached.prelude_fingerprint = prelude_fingerprint ->
          {
            resolution = Artifact_typed_declarations cached.declarations;
            cache_hit = true;
            validation_diagnostic_count =
              Some cached.validation_diagnostic_count;
          }
      | _
        when (match Hashtbl.find_opt session.parsed_sources source_id with
             | Some exprs ->
                 Mechanics_artifact.has_mechanics_forms (Artifact_context.expressions exprs)
             | None -> false) ->
          let resolution =
            match Hashtbl.find_opt session.parsed_sources source_id with
            | None -> Artifact_missing_source source_id
            | Some exprs ->
                resolve_typed_artifact_declarations_for_exprs (Artifact_context.environment session ())
                  ~source_id exprs
          in
          {
            resolution;
            cache_hit = false;
            validation_diagnostic_count = None;
          }
      | _ ->
          let resolution =
            match Hashtbl.find_opt session.parsed_sources source_id with
            | Some exprs ->
                resolve_typed_artifact_declarations_for_exprs (Artifact_context.environment session ())
                  ~source_id exprs
            | None ->
                resolve_typed_artifact_declarations ~source_id
                  (resolve_source session source_id)
          in
          let validation_diagnostic_count =
            match resolution with
            | Artifact_typed_declarations declarations ->
                let validation_diagnostic_count =
                  List.length (Artifact.validate_declarations declarations)
                in
                Session.cache_artifact_declarations session ~source_id
                  ~validation_diagnostic_count declarations;
                Some validation_diagnostic_count
            | Artifact_missing_source _ | Artifact_emitted_declaration_error _
            | Artifact_typed_declaration_error _ ->
                None
          in
          { resolution; cache_hit = false; validation_diagnostic_count })

let source_result_json source_id body =
  Printf.sprintf "{%s,%s}" (Response.string_field "sourceId" source_id) body

let missing_source_result source_id =
  source_result_json source_id
    (Printf.sprintf "\"ok\":false,\"phase\":\"loadSource\",\"diagnostics\":[%s]"
       (Response.diagnostic_json ~code:"abi/unknown-source"
          ~message:(Printf.sprintf "Unknown loaded source %S." source_id)))

let source_eval_error_result ~source_id ~phase diagnostics =
  source_result_json source_id
    (Printf.sprintf "\"ok\":false,\"phase\":%S,\"diagnostics\":%s" phase
       (Response.eval_diagnostics_array diagnostics))

let source_diagnostic_error_result ~source_id ~phase diagnostics =
  source_result_json source_id
    (Printf.sprintf "\"ok\":false,\"phase\":%S,\"diagnostics\":%s" phase
       (Response.diagnostic_array diagnostics))

let source_emitted_values_result source_id declarations =
  source_result_json source_id
    (Printf.sprintf "\"ok\":true,\"valueCount\":%d,\"value\":%s,\"diagnostics\":%s"
       (List.length declarations)
       (Elaborate.emitted_values_json declarations) (Response.diagnostic_array (Elaborate.emitted_values_diagnostics declarations)))

let source_artifact_result source_id declarations artifact =
  source_result_json source_id
    (Printf.sprintf "\"ok\":true,\"declarationCount\":%d,\"artifact\":%s"
       (List.length declarations)
       (Artifact.artifact_json artifact))

let cache_source_json source_id cache_hit =
  Printf.sprintf "{%s,\"cacheHit\":%s}"
    (Response.string_field "sourceId" source_id)
    (if cache_hit then "true" else "false")

let cache_sources_json sources =
  Printf.sprintf "\"sourceCache\":[%s]" (String.concat "," sources)

let emitted_values_many_success_json ~source_count ~loaded_count
    ~elaborated_count ~results =
  Response.object_json
    [
      Printf.sprintf "\"sourceCount\":%d" source_count;
      Printf.sprintf "\"loadedCount\":%d" loaded_count;
      Printf.sprintf "\"elaboratedCount\":%d" elaborated_count;
      Printf.sprintf "\"results\":[%s]" (String.concat "," results);
    ]

let emit_success_json ?(cache_hit_count = 0) ?(cache_miss_count = 0)
    ?(cache_sources = []) artifact =
  Response.object_json
    [
      Response.string_field "backend" "canonical-ir";
      "\"artifactCount\":1";
      Printf.sprintf "\"cacheHitCount\":%d" cache_hit_count;
      Printf.sprintf "\"cacheMissCount\":%d" cache_miss_count;
      cache_sources_json cache_sources;
      Printf.sprintf "\"artifacts\":[%s]" (Artifact.artifact_json artifact);
      Printf.sprintf "\"diagnostics\":%s" (Response.diagnostic_array (Artifact_types.package_diagnostics (Artifact_types.artifact_content artifact)));
    ]

let emit_many_success_json ~source_count ~emitted_count ~declaration_count
    ~cache_hit_count ~cache_miss_count ~cache_sources ~results =
  Response.object_json
    [
      Response.string_field "backend" "canonical-ir";
      Printf.sprintf "\"sourceCount\":%d" source_count;
      Printf.sprintf "\"emittedCount\":%d" emitted_count;
      Printf.sprintf "\"declarationCount\":%d" declaration_count;
      Printf.sprintf "\"cacheHitCount\":%d" cache_hit_count;
      Printf.sprintf "\"cacheMissCount\":%d" cache_miss_count;
      cache_sources_json cache_sources;
      Printf.sprintf "\"results\":[%s]" (String.concat "," results);
    ]

let artifact_summary_success_json ~source_count ~declaration_count
    ~diagnostic_count ~cache_hit_count ~cache_miss_count ~cache_sources =
  Response.object_json
    [
      Response.string_field "backend" "canonical-ir";
      Printf.sprintf "\"sourceCount\":%d" source_count;
      Printf.sprintf "\"declarationCount\":%d" declaration_count;
      Printf.sprintf "\"diagnosticCount\":%d" diagnostic_count;
      Printf.sprintf "\"cacheHitCount\":%d" cache_hit_count;
      Printf.sprintf "\"cacheMissCount\":%d" cache_miss_count;
      cache_sources_json cache_sources;
    ]

let emitted_values_many ~with_session (request : request) =
  with_session request.session_id (fun (session : Session.t) ->
      match validate_emit_preludes session with
      | Error diagnostics -> Response.eval_diagnostics_json diagnostics
      | Ok () ->
          let source_ids = requested_source_ids session request in
          let rec loop loaded elaborated results = function
            | [] ->
                emitted_values_many_success_json
                  ~source_count:(List.length source_ids) ~loaded_count:loaded
                  ~elaborated_count:elaborated ~results:(List.rev results)
            | source_id :: rest -> (
                match resolve_source_values session source_id with
                | Missing_value_source _ ->
                    let result = missing_source_result source_id in
                    loop loaded elaborated (result :: results) rest
                | Emitted_value_error diagnostics ->
                    let result =
                      source_eval_error_result ~source_id ~phase:"elaborate"
                        diagnostics
                    in
                    loop (loaded + 1) elaborated (result :: results) rest
                | Resolved_values declarations ->
                    let result =
                      source_emitted_values_result source_id declarations
                    in
                    loop (loaded + 1) (elaborated + 1) (result :: results) rest)
          in
          loop 0 0 [] source_ids)

let emit_artifact_success_json ~engine_name ~engine_version
    (session : Session.t) ?(cache_hit_count = 0) ?(cache_miss_count = 0)
    ?(cache_sources = []) source_ids declarations =
  match
    Artifact.canonical_ir_artifact ~engine_name ~engine_version
      ~session_id:session.id ~sources:session.sources ~preludes:session.preludes
      ~source_ids
      ~modules:(source_modules session source_ids)
      declarations
  with
  | Error diagnostics -> Response.error_diagnostics_json diagnostics
  | Ok artifact ->
      emit_success_json ~cache_hit_count ~cache_miss_count ~cache_sources
        artifact

let emit_backends_json () =
  Response.object_json
    [
      Response.string_field "defaultBackend" "canonical-ir";
      Printf.sprintf "\"backends\":[{%s,%s,%s,%s,%s}]"
        (Response.string_field "name" "canonical-ir")
        (Response.string_field "status" "implemented")
        (Response.string_field "artifactName" "ir.json")
        (Response.string_field "mediaType"
           "application/vnd.forma.ir+json")
        (Response.string_field "description"
           "Canonical JSON IR generated from runtime preludes and source \
            inputs.");
    ]

let emit_loaded_sources ~engine_name ~engine_version (session : Session.t)
    source_ids =
  match validate_emit_preludes session with
  | Error diagnostics -> Response.eval_diagnostics_json diagnostics
  | Ok () ->
      let rec loop declarations cache_hits cache_misses cache_sources = function
        | [] ->
            emit_artifact_success_json ~engine_name ~engine_version session
              ~cache_hit_count:cache_hits ~cache_miss_count:cache_misses
              ~cache_sources:(List.rev cache_sources) source_ids
              (List.rev declarations)
        | source_id :: rest -> (
            let cached =
              resolve_cached_typed_artifact_declarations session source_id
            in
            let cache_sources =
              cache_source_json source_id cached.cache_hit :: cache_sources
            in
            let cache_hits, cache_misses =
              if cached.cache_hit then (cache_hits + 1, cache_misses)
              else (cache_hits, cache_misses + 1)
            in
            match cached.resolution with
            | Artifact_missing_source _ ->
                Response.error_json
                  [
                    Response.diagnostic_json ~code:"abi/unknown-source"
                      ~message:
                        (Printf.sprintf "Unknown loaded source %S." source_id);
                  ]
            | Artifact_emitted_declaration_error diagnostics
            | Artifact_typed_declaration_error diagnostics ->
                Response.eval_diagnostics_json diagnostics
            | Artifact_typed_declarations values ->
                loop
                  (List.rev_append values declarations)
                  cache_hits cache_misses cache_sources rest)
      in
      loop [] 0 0 [] source_ids

let emit_one_loaded_source ~engine_name ~engine_version (session : Session.t)
    source_id =
  let cached = resolve_cached_typed_artifact_declarations session source_id in
  match cached.resolution with
  | Artifact_missing_source _ ->
      {
        json = missing_source_result source_id;
        succeeded = false;
        declaration_count = 0;
        cache_hit = cached.cache_hit;
      }
  | Artifact_emitted_declaration_error diagnostics ->
      {
        json = source_eval_error_result ~source_id ~phase:"emit" diagnostics;
        succeeded = false;
        declaration_count = 0;
        cache_hit = cached.cache_hit;
      }
  | Artifact_typed_declaration_error diagnostics ->
      {
        json = source_eval_error_result ~source_id ~phase:"emit" diagnostics;
        succeeded = false;
        declaration_count = 0;
        cache_hit = cached.cache_hit;
      }
  | Artifact_typed_declarations declarations -> (
      match
        Artifact.canonical_ir_artifact ~engine_name ~engine_version
          ~session_id:session.id ~sources:session.sources
          ~preludes:session.preludes ~source_ids:[ source_id ]
          ~modules:(source_modules session [ source_id ])
          declarations
      with
      | Error diagnostics ->
          {
            json =
              source_diagnostic_error_result ~source_id ~phase:"artifact"
                diagnostics;
            succeeded = false;
            declaration_count = 0;
            cache_hit = cached.cache_hit;
          }
      | Ok artifact ->
          {
            json = source_artifact_result source_id declarations artifact;
            succeeded = true;
            declaration_count = List.length declarations;
            cache_hit = cached.cache_hit;
          })

let emit_many ~with_session ~engine_name ~engine_version (request : request) =
  with_session request.session_id (fun (session : Session.t) ->
      match validate_emit_preludes session with
      | Error diagnostics -> Response.eval_diagnostics_json diagnostics
      | Ok () ->
          let source_ids = requested_source_ids session request in
          let rec loop emitted declaration_count cache_hits cache_misses
              cache_sources results = function
            | [] ->
                emit_many_success_json ~source_count:(List.length source_ids)
                  ~emitted_count:emitted ~declaration_count
                  ~cache_hit_count:cache_hits ~cache_miss_count:cache_misses
                  ~cache_sources:(List.rev cache_sources)
                  ~results:(List.rev results)
            | source_id :: rest ->
                let source_result =
                  emit_one_loaded_source ~engine_name ~engine_version session
                    source_id
                in
                let cache_sources =
                  cache_source_json source_id source_result.cache_hit
                  :: cache_sources
                in
                let emitted =
                  if source_result.succeeded then emitted + 1 else emitted
                in
                let cache_hits, cache_misses =
                  if source_result.cache_hit then (cache_hits + 1, cache_misses)
                  else (cache_hits, cache_misses + 1)
                in
                loop emitted
                  (declaration_count + source_result.declaration_count)
                  cache_hits cache_misses cache_sources
                  (source_result.json :: results)
                  rest
          in
          loop 0 0 0 0 [] [] source_ids)

let artifact_summary ~with_session (request : request) =
  with_session request.session_id (fun (session : Session.t) ->
      match validate_emit_preludes session with
      | Error diagnostics -> Response.eval_diagnostics_json diagnostics
      | Ok () ->
          let source_ids = requested_source_ids session request in
          let rec loop source_count declaration_count diagnostics cache_hits
              cache_misses cache_sources = function
            | [] ->
                artifact_summary_success_json ~source_count ~declaration_count
                  ~diagnostic_count:diagnostics ~cache_hit_count:cache_hits
                  ~cache_miss_count:cache_misses
                  ~cache_sources:(List.rev cache_sources)
            | source_id :: rest -> (
                let cached =
                  resolve_cached_typed_artifact_declarations session source_id
                in
                let cache_sources =
                  cache_source_json source_id cached.cache_hit :: cache_sources
                in
                let cache_hits, cache_misses =
                  if cached.cache_hit then (cache_hits + 1, cache_misses)
                  else (cache_hits, cache_misses + 1)
                in
                match cached.resolution with
                | Artifact_missing_source _ ->
                    loop source_count declaration_count (diagnostics + 1)
                      cache_hits cache_misses cache_sources rest
                | Artifact_emitted_declaration_error _ ->
                    loop (source_count + 1) declaration_count (diagnostics + 1)
                      cache_hits cache_misses cache_sources rest
                | Artifact_typed_declaration_error _ ->
                    loop (source_count + 1) declaration_count (diagnostics + 1)
                      cache_hits cache_misses cache_sources rest
                | Artifact_typed_declarations declarations ->
                    let validation_count =
                      match cached.validation_diagnostic_count with
                      | Some count -> count
                      | None ->
                          List.length
                            (Artifact.validate_declarations declarations)
                    in
                    loop (source_count + 1)
                      (declaration_count + List.length declarations)
                      (diagnostics + validation_count)
                      cache_hits cache_misses cache_sources rest)
          in
          loop 0 0 0 0 0 [] source_ids)

let emit_source ~with_session ~engine_name ~engine_version (request : request) =
  let backend =
    match request.backend with
    | Some backend -> backend
    | None -> "canonical-ir"
  in
  if backend <> "canonical-ir" then
    Response.error_json
      [
        Response.diagnostic_json ~code:"abi/unsupported-backend"
          ~message:
            (Printf.sprintf
               "Unsupported emit backend %S. The only implemented backend is \
                \"canonical-ir\"."
               backend);
      ]
  else
    match
      (request.source, request.session_id, request.source_id, request.source_ids)
    with
    | Some source, Some session_id, source_id, _ -> (
        let id =
          match source_id with Some source_id -> source_id | None -> "request"
        in
        match Reader.parse_ast ~source_id:id source with
        | Error diagnostics -> Response.reader_diagnostics_json diagnostics
        | Ok exprs ->
            with_session (Some session_id) (fun (session : Session.t) ->
                match validate_emit_preludes session with
                | Error diagnostics ->
                    Response.eval_diagnostics_json diagnostics
                | Ok () -> (
                    match
                      resolve_typed_artifact_declarations_for_exprs (Artifact_context.environment session ())
                        ~source_id:id exprs
                    with
                    | Artifact_emitted_declaration_error diagnostics
                    | Artifact_typed_declaration_error diagnostics ->
                        Response.eval_diagnostics_json diagnostics
                    | Artifact_typed_declarations declarations ->
                        emit_artifact_success_json ~engine_name ~engine_version
                          session ~cache_hit_count:0 ~cache_miss_count:1 [ id ]
                          declarations
                    | Artifact_missing_source _ -> assert false)))
    | None, Some session_id, Some source_id, _ ->
        with_session (Some session_id) (fun (session : Session.t) ->
            emit_loaded_sources ~engine_name ~engine_version session
              [ source_id ])
    | None, Some session_id, None, Some source_ids ->
        with_session (Some session_id) (fun (session : Session.t) ->
            emit_loaded_sources ~engine_name ~engine_version session source_ids)
    | Some _, None, _, _ | None, None, _, _ ->
        Response.error_json
          [
            Response.diagnostic_json ~code:"abi/missing-session"
              ~message:
                "emit requires a sessionId so loaded preludes can provide \
                 construct hooks.";
          ]
    | None, Some _, None, None ->
        Response.error_json
          [
            Response.diagnostic_json ~code:"abi/missing-source"
              ~message:
                "emit requires source, sourceId, or sourceIds with a sessionId.";
          ]

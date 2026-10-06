type request = Abi_request.t

module Response = Abi_response

type repl_submit_result = {
  id : string;
  form_count : int;
  value : Eval.value;
  typ : string;
}

type repl_submit_error =
  | Repl_reader of Reader.diagnostic list
  | Repl_eval of Eval.diagnostic list
  | Repl_typecheck of Type_diagnostic.t list

module Load_phase = Abi_load_phase_timings

let sorted_hashtbl_keys table =
  Hashtbl.fold (fun key _ keys -> key :: keys) table []
  |> List.sort String.compare

let module_exports (session : Session.t) module_id =
  match Hashtbl.find_opt session.source_exports module_id with
  | Some names -> Some names
  | None -> (
      match Hashtbl.find_opt session.source_modules module_id with
      | Some module_decl
        when module_decl.Module_decl.explicit_exports <> []
             || module_decl.Module_decl.re_exports <> [] ->
          Some
            (module_decl.Module_decl.explicit_exports
            @ List.concat_map
                (fun (re_export : Module_decl.module_re_export) ->
                  re_export.names)
                module_decl.Module_decl.re_exports
            |> List.sort_uniq String.compare)
      | _ -> None)

let with_session session_id (f : Session.t -> string) =
  match session_id with
  | None ->
      Response.error_json
        [
          Response.diagnostic_json ~code:"abi/missing-session"
            ~message:"This operation requires a sessionId field.";
        ]
  | Some id -> (
      match Session.find id with
      | Some session -> f session
      | None ->
          Response.error_json
            [
              Response.diagnostic_json ~code:"abi/unknown-session"
                ~message:(Printf.sprintf "Unknown session %S." id);
            ])

let open_session () =
  let session = Session.open_ () in
  Response.object_json [ Response.string_field "sessionId" session.id ]

let close_session session_id =
  with_session session_id (fun session ->
      Session.close session;
      Response.null_json)

let reset_session session_id =
  with_session session_id (fun session ->
      Session.reset session;
      Response.null_json)

let expr_updates_session = Source_bindings.updates
let source_binding_names = Source_bindings.names

let host_builtin_names host_builtins =
  host_builtins
  |> List.filter_map (fun (descriptor : Abi_request.host_builtin_descriptor) ->
      match descriptor.effect_name with
      | Some _ -> Some descriptor.name
      | None -> None)

let source_mentions_host_builtin host_builtins source =
  let host_names = host_builtin_names host_builtins in
  if host_names = [] then false
  else
    match Reader.parse_ast ~source_id:"abi-host-effect-scan" source with
    | Error _ -> true
    | Ok exprs ->
        let rec mentions = function
          | Ast.Symbol (_, name) -> List.mem name host_names
          | Ast.List (_, exprs) | Ast.Vector (_, exprs) ->
              List.exists mentions exprs
          | Ast.Map (_, entries) ->
              List.exists
                (fun (key, value) -> mentions key || mentions value)
                entries
          | Ast.Nil _ | Ast.Bool _ | Ast.Int _ | Ast.Float _ | Ast.String _
          | Ast.Keyword _ ->
              false
        in
        List.exists mentions exprs

let warm_source_artifact_cache (session : Session.t) source_id =
  match Hashtbl.find_opt session.parsed_sources source_id with
  | None -> Load_phase.zero
  | Some exprs when Mechanics_artifact.has_mechanics_forms exprs ->
      Load_phase.zero
  | Some exprs -> (
      let emitted, elaborate_ms =
        Load_phase.timed_ms (fun () ->
            Elaborate.emitted_declarations_with_timings session.env exprs)
      in
      let timings = { Load_phase.zero with Load_phase.elaborate_ms } in
      match emitted with
      | Error _ -> timings
      | Ok (emitted, elaborate_timings) -> (
          let timings = Load_phase.with_elaborate timings elaborate_timings in
          let typed, typed_decl_ms =
            Load_phase.timed_ms (fun () ->
                Elaborate.typed_artifact_declarations_of_emitted ~source_id
                  emitted)
          in
          let timings = { timings with Load_phase.typed_decl_ms } in
          match typed with
          | Error _ -> timings
          | Ok declarations ->
              let validation_diagnostics, validate_ms =
                Load_phase.timed_ms (fun () ->
                    Artifact.validate_declarations declarations)
              in
              let timings = { timings with Load_phase.validate_ms } in
              let (), artifact_cache_ms =
                Load_phase.timed_ms (fun () ->
                    Session.cache_artifact_declarations session ~source_id
                      ~validation_diagnostic_count:
                        (List.length validation_diagnostics)
                      declarations)
              in
              { timings with Load_phase.artifact_cache_ms }))

let load_runtime_input ~kind (session : Session.t) source_id source =
  let id =
    match source_id with Some id -> id | None -> Session.fresh_input_id kind
  in
  let table =
    match kind with "prelude" -> session.preludes | _ -> session.sources
  in
  let parsed_table =
    match kind with
    | "prelude" -> session.parsed_preludes
    | _ -> session.parsed_sources
  in
  let previous_module =
    if kind = "prelude" then None
    else Hashtbl.find_opt session.source_modules id
  in
  let loaded_source = Source.make ~id ~text:source () in
  let public_exports_changed =
    match (kind, previous_module) with
    | "prelude", _ -> true
    | _, Some previous -> (
        match Reader.parse_ast ~source_id:id source with
        | Error _ -> true
        | Ok exprs ->
            let known_source_ids =
              id :: sorted_hashtbl_keys session.sources
              |> List.sort_uniq String.compare
            in
            let analysis =
              Module_decl.analyze
                ~resolve_exports:(module_exports session)
                ~source_id:id ~known_source_ids exprs
            in
            let current = analysis.Module_decl.decl in
            let has_explicit_surface module_decl =
              module_decl.Module_decl.explicit_exports <> []
              || module_decl.Module_decl.re_exports <> []
            in
            if
              has_explicit_surface previous || has_explicit_surface current
            then
              Module_decl_artifact.public_export_hash previous
              <> Module_decl_artifact.public_export_hash current
            else true)
    | _, None -> true
  in
  let invalidate_after_store () =
    match kind with
    | "prelude" -> Session.invalidate_artifacts session
    | _ ->
        Session.invalidate_artifacts_from_source
          ~public_exports_changed session id
  in
  let parsed, parse_ms =
    Load_phase.timed_ms (fun () ->
        Reader.parse_ast ~source_id:id (Source.text loaded_source))
  in
  let timings = { Load_phase.zero with Load_phase.parse_ms } in
  match parsed with
  | Error diagnostics -> Error (List.map Reader.diagnostic_to_json diagnostics)
  | Ok exprs -> (
      try
      Surface.validate_program exprs;
      let known_source_ids =
        if kind = "prelude" then []
        else
          id :: sorted_hashtbl_keys session.sources
          |> List.sort_uniq String.compare
      in
      let module_analysis =
        if kind = "prelude" then None
        else
          Some
            (Module_decl.analyze
               ~resolve_exports:(module_exports session)
               ~source_id:id ~known_source_ids exprs)
      in
      let exprs =
        match module_analysis with
        | Some analysis -> analysis.Module_decl.source_exprs
        | None -> exprs
      in
      let evaluation_env, source_type_env =
        match kind with
        | "prelude" -> (session.env, session.type_env)
        | _ -> Session.env_without_source_bindings session id
      in
      let existing_bindings =
        if kind = "prelude" then [] else
        Hashtbl.fold (fun owner names acc ->
          if owner = id then acc else names @ acc) session.source_bindings []
      in
      let stores_source ~env ~type_env ~binding_names ~timings () =
        let (), store_ms =
          Load_phase.timed_ms (fun () ->
              Hashtbl.replace table id loaded_source;
              Hashtbl.replace parsed_table id exprs;
              (match module_analysis with
              | Some analysis ->
                  Hashtbl.replace session.source_modules id
                    analysis.Module_decl.decl
              | None -> ());
              session.env <- env;
              session.type_env <- type_env;
              if kind <> "prelude" then
                Session.cache_source_bindings session ~source_id:id
                  binding_names;
              if kind <> "prelude" then Session.remember_source_order session id;
              invalidate_after_store ())
        in
        let timings = { timings with Load_phase.store_ms } in
        Ok (id, List.length exprs, timings)
      in
      let evaluation_env =
        if List.exists (fun e -> List.mem (Option.value ~default:"" (Surface.head e)) ["type";"class";"error"]) exprs then
          let type_definitions = Surface.core_program (Surface_protocol.program exprs) |> List.concat_map (fun e -> match Surface.runtime_constructors e with
            | Some definitions -> definitions
            | None -> (match e with Ast.List (_,Ast.Symbol (_,"define") :: Ast.Symbol (_,n) :: _) when String.starts_with ~prefix:"__descriptor/" n -> [e] | _ -> [])) in
          match Eval.evaluate_program_with_env evaluation_env type_definitions with Ok (_,env) -> env | Error _ -> evaluation_env
        else evaluation_env in
      let projected = Mechanics_artifact.projected_form_predicate ~include_pure:false exprs in
      let updates expr =
        List.mem (Option.value ~default:"" (Surface.head expr)) ["type";"class";"error"] || (not (projected expr)) && expr_updates_session evaluation_env expr
      in
      if not (List.exists updates exprs) then
        stores_source ~env:evaluation_env ~type_env:source_type_env
          ~binding_names:(source_binding_names ~existing:existing_bindings evaluation_env exprs)
          ~timings ()
      else
        let evaluated, eval_ms =
          Load_phase.timed_ms (fun () ->
              Eval.evaluate_program_with_env evaluation_env (List.filter (fun expr -> not (projected expr)) exprs))
        in
        let typechecked, typecheck_ms =
          Load_phase.timed_ms (fun () ->
              Typecheck.typecheck_program_with_env source_type_env (List.filter (fun expr -> List.mem (Option.value ~default:"" (Surface.head expr)) ["type";"class";"error"] || not (projected expr)) exprs))
        in
        let timings = { timings with Load_phase.eval_ms; typecheck_ms } in
        match evaluated with
        | Error diagnostics ->
            Error (List.map Eval.diagnostic_to_json diagnostics)
        | Ok (_, env) -> (
            match typechecked with
            | Error diagnostics ->
                Error (List.map Type_diagnostic.to_json diagnostics)
            | Ok (_, type_env) -> (
                let metacheck, metacheck_ms =
                  Load_phase.timed_ms (fun () ->
                      match kind with
                      | "prelude" -> Descriptor_metacheck.validate env exprs
                      | _ -> Ok ())
                in
                let timings = { timings with Load_phase.metacheck_ms } in
                match metacheck with
                | Error diagnostics ->
                    Error (List.map Eval.diagnostic_to_json diagnostics)
                | Ok () ->
                    stores_source ~env ~type_env
                      ~binding_names:(source_binding_names ~existing:existing_bindings env exprs)
                      ~timings ()))
      with exn -> (
        (* Authoring errors found while lowering are located diagnostics;
           the session is unchanged because nothing has been stored. *)
        match Surface.diagnostic_of_exn exn with
        | Some (span, code, message) ->
            Error [ Eval.diagnostic_to_json { Eval.span = Some span; code; message } ]
        | None -> raise exn))

let store_runtime_input ~kind (session : Session.t) source_id source =
  match source with
  | None ->
      Response.error_json
        [
          Response.diagnostic_json ~code:"abi/missing-source"
            ~message:(Printf.sprintf "%s requires a source string field." kind);
        ]
  | Some source -> (
      match load_runtime_input ~kind session source_id source with
      | Error diagnostics -> Response.error_json diagnostics
      | Ok (id, form_count, load_timings) ->
          let warm_timings =
            if kind = "source" then warm_source_artifact_cache session id
            else Load_phase.zero
          in
          let timings = Load_phase.add load_timings warm_timings in
          Response.object_json
            [
              Response.string_field "id" id;
              Printf.sprintf "\"formCount\":%d" form_count;
              Printf.sprintf "\"envBindingCount\":%d" (Env.length session.env);
              Printf.sprintf "\"typeBindingCount\":%d"
                (List.length session.type_env);
              Printf.sprintf "\"phaseTimings\":%s" (Load_phase.to_json timings);
            ])

let load_prelude (request : request) =
  with_session request.session_id (fun session ->
      store_runtime_input ~kind:"prelude" session request.source_id
        request.source)

let load_source (request : request) =
  with_session request.session_id (fun session ->
      let kind = match request.kind with Some "prelude" -> "prelude" | _ -> "source" in
      store_runtime_input ~kind session request.source_id request.source)

let submit_repl (session : Session.t) ~source_id ~source =
  let id =
    match source_id with Some id -> id | None -> Session.fresh_input_id "repl"
  in
  let loaded_source = Source.make ~id ~text:source () in
  match Reader.parse_ast ~source_id:id (Source.text loaded_source) with
  | Error diagnostics -> Error (Repl_reader diagnostics)
  | Ok exprs -> (
      match Eval.evaluate_program_with_env session.env exprs with
      | Error diagnostics -> Error (Repl_eval diagnostics)
      | Ok (value, env) -> (
          match Typecheck.typecheck_program_with_env session.type_env exprs with
          | Error diagnostics -> Error (Repl_typecheck diagnostics)
          | Ok (typ, type_env) ->
              session.env <- env;
              session.type_env <- type_env;
              Hashtbl.replace session.sources id loaded_source;
              Hashtbl.replace session.parsed_sources id exprs;
              Session.cache_source_bindings session ~source_id:id
                (source_binding_names env exprs);
              Session.remember_source_order session id;
              Session.invalidate_artifacts session;
              Ok { id; form_count = List.length exprs; value; typ }))

let repl_submit_result_json (session : Session.t) result =
  Printf.sprintf
    "{\"ok\":true,\"value\":{%s,\"formCount\":%d,\"value\":%s,%s,\"envBindingCount\":%d,\"typeBindingCount\":%d}}"
    (Response.string_field "id" result.id)
    result.form_count
    (Eval.value_to_json result.value)
    (Response.string_field "type" result.typ)
    (Env.length session.env)
    (List.length session.type_env)

let submit_repl_json session (request : request) source =
  match submit_repl session ~source_id:request.source_id ~source with
  | Error (Repl_reader diagnostics) ->
      Response.reader_diagnostics_json diagnostics
  | Error (Repl_eval diagnostics) -> Response.eval_diagnostics_json diagnostics
  | Error (Repl_typecheck diagnostics) ->
      Response.typecheck_diagnostics_json diagnostics
  | Ok result -> repl_submit_result_json session result

let repl_submit (request : request) =
  with_session request.session_id (fun session ->
      match request.source with
      | None ->
          Response.error_json
            [
              Response.diagnostic_json ~code:"abi/missing-source"
                ~message:"replSubmit requires a source string field.";
            ]
      | Some source
        when Abi_session_host_effect.has_host_effects request.host_builtins
             && source_mentions_host_builtin request.host_builtins source ->
          Abi_session_host_effect.repl_submit session request ~source
      | Some source -> submit_repl_json session request source)

let resume_host_call = Abi_session_host_effect.resume_host_call
let abort_evaluation = Abi_session_host_effect.abort_evaluation
let call_value = Abi_session_host_effect.call_value
let release_value = Abi_session_host_effect.release_value

let load_source_bundle (request : request) =
  with_session request.session_id (fun session ->
      match request.source_bundle with
      | None ->
          Response.error_json
            [
              Response.diagnostic_json ~code:"abi/missing-sources"
                ~message:
                  "loadSourceBundle requires a sources array of objects with \
                   kind, sourceId, and source fields.";
            ]
      | Some items ->
          let rec loop loaded loaded_source_ids timings results = function
            | [] ->
                let timings =
                  List.fold_left
                    (fun timings source_id ->
                      Load_phase.add timings
                        (warm_source_artifact_cache session source_id))
                    timings
                    (List.rev loaded_source_ids)
                in
                Printf.sprintf
                  "{\"ok\":true,\"value\":{\"loadedCount\":%d,\"envBindingCount\":%d,\"typeBindingCount\":%d,\"phaseTimings\":%s,\"results\":[%s]}}"
                  loaded (Env.length session.env)
                  (List.length session.type_env)
                  (Load_phase.to_json timings)
                  (String.concat "," (List.rev results))
            | (item : Abi_request.source_bundle_item) :: rest -> (
                let kind =
                  match item.kind with "prelude" -> "prelude" | _ -> "source"
                in
                match
                  load_runtime_input ~kind session (Some item.source_id)
                    item.source
                with
                | Error diagnostics ->
                    let result =
                      Printf.sprintf "{%s,%s,\"ok\":false,\"diagnostics\":[%s]}"
                        (Response.string_field "kind" kind)
                        (Response.string_field "sourceId" item.source_id)
                        (String.concat "," diagnostics)
                    in
                    loop loaded loaded_source_ids timings (result :: results)
                      rest
                | Ok (_, form_count, load_timings) ->
                    let timings = Load_phase.add timings load_timings in
                    let loaded_source_ids =
                      if kind = "source" then
                        item.source_id :: loaded_source_ids
                      else loaded_source_ids
                    in
                    let result =
                      Printf.sprintf "{%s,%s,\"ok\":true,\"formCount\":%d}"
                        (Response.string_field "kind" kind)
                        (Response.string_field "sourceId" item.source_id)
                        form_count
                    in
                    loop (loaded + 1) loaded_source_ids timings
                      (result :: results) rest)
          in
          loop 0 [] Load_phase.zero [] items)

let session_summary (session : Session.t) =
  Printf.sprintf
    "{\"ok\":true,\"value\":{%s,\"preludeCount\":%d,\"sourceCount\":%d,\"parsedPreludeCount\":%d,\"parsedSourceCount\":%d,\"envBindingCount\":%d,\"typeBindingCount\":%d}}"
    (Response.string_field "engine" "forma-ocaml")
    (Hashtbl.length session.preludes)
    (Hashtbl.length session.sources)
    (Hashtbl.length session.parsed_preludes)
    (Hashtbl.length session.parsed_sources)
    (Env.length session.env)
    (List.length session.type_env)

let source_summary (session : Session.t) =
  let source_item_json id =
    match Hashtbl.find_opt session.sources id with
    | None -> None
    | Some source ->
        let form_count =
          match Hashtbl.find_opt session.parsed_sources id with
          | Some exprs -> List.length exprs
          | None -> 0
        in
        Some
          (Printf.sprintf "{%s,%s,\"formCount\":%d}"
             (Response.string_field "id" id)
             (Response.string_field "hash" (Source.hash source))
             form_count)
  in
  let prelude_item_json id =
    match Hashtbl.find_opt session.preludes id with
    | None -> None
    | Some source ->
        let form_count =
          match Hashtbl.find_opt session.parsed_preludes id with
          | Some exprs -> List.length exprs
          | None -> 0
        in
        Some
          (Printf.sprintf "{%s,%s,\"formCount\":%d}"
             (Response.string_field "id" id)
             (Response.string_field "hash" (Source.hash source))
             form_count)
  in
  let source_items =
    sorted_hashtbl_keys session.sources |> List.filter_map source_item_json
  in
  let prelude_items =
    sorted_hashtbl_keys session.preludes |> List.filter_map prelude_item_json
  in
  Printf.sprintf
    "{\"ok\":true,\"value\":{\"sourceCount\":%d,\"preludeCount\":%d,\"sources\":[%s],\"preludes\":[%s]}}"
    (List.length source_items)
    (List.length prelude_items)
    (String.concat "," source_items)
    (String.concat "," prelude_items)

type request = Abi_request.t

module Response = Abi_response

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

let rec value_projection_of_json json =
  match Abi_request.find_string_field "kind" json with
  | Some "nil" -> Some Eval.VNil
  | Some "bool" ->
      Option.map
        (fun value -> Eval.VBool value)
        (Abi_request.find_bool_field "value" json)
  | Some "int" ->
      Option.map
        (fun value -> Eval.VInt value)
        (Abi_request.find_int_field "value" json)
  | Some "float" -> (
      match Abi_request.find_string_field "value" json with
      | Some raw ->
          Option.map (fun value -> Eval.VFloat value) (float_of_string_opt raw)
      | None -> (
          match Abi_request.find_int_field "value" json with
          | Some value -> Some (Eval.VFloat (float_of_int value))
          | None -> None))
  | Some "string" ->
      Option.map
        (fun value -> Eval.VString value)
        (Abi_request.find_string_field "value" json)
  | Some "symbol" ->
      Option.map
        (fun value -> Eval.VSymbol value)
        (Abi_request.find_string_field "value" json)
  | Some "keyword" ->
      Option.map
        (fun value -> Eval.VKeyword value)
        (Abi_request.find_string_field "value" json)
  | Some "list" -> (
      match Abi_request.find_array_field "items" json with
      | None -> Some (Eval.VList [])
      | Some items_json ->
          let values =
            items_json |> Abi_request.split_top_level_objects
            |> List.filter_map value_projection_of_json
          in
          Some (Eval.VList values))
  | Some "vector" -> (
      match Abi_request.find_array_field "items" json with
      | None -> Some (Eval.VVector [])
      | Some items_json ->
          let values =
            items_json |> Abi_request.split_top_level_objects
            |> List.filter_map value_projection_of_json
          in
          Some (Eval.VVector values))
  | Some "map" -> (
      match Abi_request.find_array_field "entries" json with
      | None -> Some (Eval.VMap [])
      | Some entries_json ->
          let entries =
            entries_json |> Abi_request.split_top_level_objects
            |> List.filter_map (fun entry_json ->
                match
                  ( Abi_request.find_object_field "key" entry_json,
                    Abi_request.find_object_field "value" entry_json )
                with
                | Some key_json, Some value_json -> (
                    match
                      ( value_projection_of_json key_json,
                        value_projection_of_json value_json )
                    with
                    | Some key, Some value -> Some (key, value)
                    | _ -> None)
                | _ -> None)
          in
          Some (Eval.VMap entries))
  | _ -> None

let host_builtin_effects host_builtins =
  host_builtins
  |> List.filter_map (fun (descriptor : Abi_request.host_builtin_descriptor) ->
      Option.map
        (fun effect_name -> (descriptor.name, effect_name))
        descriptor.effect_name)

let has_host_effects host_builtins = host_builtin_effects host_builtins <> []

let host_effect_env env host_builtins =
  host_builtin_effects host_builtins
  |> List.fold_left
       (fun env (name, effect_name) ->
         match Env.lookup effect_name env with
         | Some _ -> env
         | None ->
             Env.bind effect_name
               (Eval_effect_definition.value effect_name [ name ])
               env)
       env

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

let rec transform_host_calls host_names expr =
  let transform = transform_host_calls host_names in
  match expr with
  | Ast.List (span, Ast.Symbol (head_span, name) :: args)
    when List.mem name host_names ->
      Ast.List
        ( span,
          Ast.Symbol (head_span, "perform")
          :: Ast.Symbol (head_span, name)
          :: List.map transform args )
  | Ast.List (span, items) -> Ast.List (span, List.map transform items)
  | Ast.Vector (span, items) -> Ast.Vector (span, List.map transform items)
  | Ast.Map (span, entries) ->
      Ast.Map
        ( span,
          List.map
            (fun (key, value) -> (transform key, transform value))
            entries )
  | Ast.Nil _ | Ast.Bool _ | Ast.Int _ | Ast.Float _ | Ast.String _
  | Ast.Symbol _ | Ast.Keyword _ ->
      expr

let host_call_state_json session evaluation_id step =
  match step with
  | Eval_effect.Perform_step (effect_name, op_name, args, _) ->
      let host_call_arg_json = function
        | Eval.VClosure _ as value ->
            let value_ref = Session.fresh_value_ref_id session in
            Session.remember_value_ref session value_ref value;
            Printf.sprintf
              "{\"kind\":\"function\",%s,\"display\":\"<function>\"}"
              (Response.string_field "valueRef" value_ref)
        | value -> Eval.value_to_json value
      in
      let call_id = Session.fresh_call_id session in
      Session.remember_pending_evaluation session evaluation_id
        { Session.call_id; step };
      Printf.sprintf
        "{\"ok\":true,\"value\":{\"status\":\"host-call\",\"call\":{%s,%s,%s,%s,\"args\":[%s]}}}"
        (Response.string_field "evaluationId" evaluation_id)
        (Response.string_field "callId" call_id)
        (Response.string_field "effect" effect_name)
        (Response.string_field "name" op_name)
        (String.concat "," (List.map host_call_arg_json args))
  | _ ->
      Response.error_json
        [
          Response.diagnostic_json ~code:"host-effect/not-paused"
            ~message:"Cannot serialize a non-paused evaluation as a host call.";
        ]

let completed_state_json value =
  Printf.sprintf
    "{\"ok\":true,\"value\":{\"status\":\"completed\",\"value\":%s,%s,\"formCount\":1}}"
    (Eval.value_to_json value)
    (Response.string_field "type" "Any")

let effect_step_response session evaluation_id step =
  match step with
  | Eval_effect.Done (Ok value) ->
      Session.remove_pending_evaluation session evaluation_id;
      completed_state_json value
  | Eval_effect.Done (Error diagnostics) ->
      Session.remove_pending_evaluation session evaluation_id;
      Response.eval_diagnostics_json diagnostics
  | Eval_effect.Perform_step _ ->
      host_call_state_json session evaluation_id step

let repl_submit (session : Session.t) (request : request) ~source =
  let id =
    match request.source_id with
    | Some id -> id
    | None -> Session.fresh_input_id "repl"
  in
  let loaded_source = Source.make ~id ~text:source () in
  match
    Session_module.graph session ~source_id:id
      ~source:(Some (Source.text loaded_source))
  with
  | Error diagnostics -> Response.typecheck_diagnostics_json diagnostics
  | Ok graph -> (
      let host_names = host_builtin_names request.host_builtins in
      let graph =
        {
          graph with
          Module_graph.modules =
            List.map
              (fun (m : Module_graph.resolved_module) ->
                {
                  m with
                  expressions =
                    List.map (transform_host_calls host_names) m.expressions;
                })
              graph.modules;
        }
      in
      match
        Module_runtime.initialize ~entry_expressions:false
          ~core_env:session.core_env ~core_types:session.core_types graph
          session.module_instances
      with
      | Error diagnostics -> Response.typecheck_diagnostics_json diagnostics
      | Ok (_, instance) -> (
          let env = instance.Module_runtime.env in
          let exprs =
            (List.find
               (fun (m : Module_graph.resolved_module) -> m.id = graph.entry)
               graph.modules)
              .expressions
            |> List.filter (fun e -> not (Module_runtime.definition e))
          in
          let host_exprs = List.map (transform_host_calls host_names) exprs in
          match Eval.expand_program_with_env env host_exprs with
          | Error diagnostics -> Response.eval_diagnostics_json diagnostics
          | Ok (expanded_exprs, _) ->
              let effect_env = host_effect_env env request.host_builtins in
              let transformed_exprs =
                List.map (transform_host_calls host_names) expanded_exprs
              in
              let evaluation_id = Session.fresh_evaluation_id session in
              let step =
                Eval.evaluate_effect_program_step effect_env transformed_exprs
              in
              effect_step_response session evaluation_id step))

let resume_host_call (request : request) =
  with_session request.session_id (fun session ->
      match (request.evaluation_id, request.call_id) with
      | None, _ | _, None ->
          Response.error_json
            [
              Response.diagnostic_json ~code:"host-effect/missing-resume-id"
                ~message:
                  "resumeHostCall requires evaluationId and callId fields.";
            ]
      | Some evaluation_id, Some call_id -> (
          match Session.find_pending_evaluation session evaluation_id with
          | None ->
              Response.error_json
                [
                  Response.diagnostic_json ~code:"evaluation/not-found"
                    ~message:
                      (Printf.sprintf
                         "No retained OCaml evaluation found for %S."
                         evaluation_id);
                ]
          | Some pending when pending.Session.call_id <> call_id ->
              Response.error_json
                [
                  Response.diagnostic_json ~code:"host-effect/call-not-found"
                    ~message:
                      (Printf.sprintf
                         "No retained OCaml host call %S found for %S." call_id
                         evaluation_id);
                ]
          | Some pending -> (
              match request.resume_ok with
              | Some false ->
                  Session.remove_pending_evaluation session evaluation_id;
                  let code =
                    Option.value request.failure_code
                      ~default:"host-effect/failed"
                  in
                  let message =
                    Option.value request.failure_message
                      ~default:"Host call resumed with a failure result."
                  in
                  Response.error_json
                    [ Response.diagnostic_json ~code ~message ]
              | Some true -> (
                  match request.value_json with
                  | None ->
                      Response.error_json
                        [
                          Response.diagnostic_json
                            ~code:"host-effect/missing-value"
                            ~message:
                              "Successful resumeHostCall requires a value \
                               field.";
                        ]
                  | Some value_json -> (
                      match value_projection_of_json value_json with
                      | None ->
                          Response.error_json
                            [
                              Response.diagnostic_json
                                ~code:"host-effect/invalid-value"
                                ~message:
                                  "Could not decode host-call resume value.";
                            ]
                      | Some value -> (
                          match pending.Session.step with
                          | Eval_effect.Perform_step (_, _, _, resume) ->
                              let step = resume value in
                              effect_step_response session evaluation_id step
                          | _ ->
                              Session.remove_pending_evaluation session
                                evaluation_id;
                              Response.error_json
                                [
                                  Response.diagnostic_json
                                    ~code:"host-effect/not-paused"
                                    ~message:
                                      "Retained evaluation is not waiting for \
                                       a host call.";
                                ])))
              | None ->
                  Response.error_json
                    [
                      Response.diagnostic_json
                        ~code:"host-effect/missing-result"
                        ~message:"resumeHostCall requires resumeOk.";
                    ])))

let abort_evaluation (request : request) =
  with_session request.session_id (fun session ->
      match request.evaluation_id with
      | None ->
          Response.error_json
            [
              Response.diagnostic_json ~code:"evaluation/missing-id"
                ~message:"abortEvaluation requires an evaluationId field.";
            ]
      | Some evaluation_id ->
          Session.remove_pending_evaluation session evaluation_id;
          Printf.sprintf "{\"ok\":true,\"value\":{%s,\"aborted\":true}}"
            (Response.string_field "evaluationId" evaluation_id))

let call_value (request : request) =
  with_session request.session_id (fun session ->
      match request.value_ref with
      | None ->
          Response.error_json
            [
              Response.diagnostic_json ~code:"value-ref/missing"
                ~message:"callValue requires a valueRef field.";
            ]
      | Some value_ref -> (
          match Session.find_value_ref session value_ref with
          | None ->
              Response.error_json
                [
                  Response.diagnostic_json ~code:"value-ref/not-found"
                    ~message:
                      (Printf.sprintf "No retained OCaml value found for %S."
                         value_ref);
                ]
          | Some (Eval.VClosure closure) ->
              let args =
                request.args_json |> List.filter_map value_projection_of_json
              in
              let evaluation_id = Session.fresh_evaluation_id session in
              Eval.apply_effect_closure_values_step closure args
              |> effect_step_response session evaluation_id
          | Some _ ->
              Response.error_json
                [
                  Response.diagnostic_json ~code:"value-ref/not-callable"
                    ~message:
                      (Printf.sprintf "Retained OCaml value %S is not callable."
                         value_ref);
                ]))

let release_value (request : request) =
  with_session request.session_id (fun session ->
      List.iter (Session.remove_value_ref session) request.value_refs;
      Printf.sprintf "{\"ok\":true,\"value\":{\"released\":[%s]}}"
        (String.concat ","
           (List.map
              (fun value_ref ->
                Printf.sprintf "\"%s\"" (Response.json_escape value_ref))
              request.value_refs)))

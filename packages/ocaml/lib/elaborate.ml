type collected_declaration = {
  hook : string;
  declaration : Eval.value;
  summary_expectation : Artifact_summary_expectation.t;
  payload_contract : Artifact_payload_descriptor.contract;
  validator_names : string list;
  form_index : int;
  span : Ast.span;
}

type emitted_value = {
  value : Eval.value;
  summary_expectation : Artifact_summary_expectation.t;
  payload_contract : Artifact_payload_descriptor.contract;
  validator_names : string list;
  form_index : int;
  span : Ast.span;
}

type emitted_declaration = {
  value : Eval.value;
  summary : Artifact_summary_types.declaration_summary;
  payload_contract : Artifact_payload_descriptor.contract;
  validator_names : string list;
  form_index : int;
  span : Ast.span;
}

type phase_timings = {
  expand_ms : float;
  collect_ms : float;
  apply_hook_ms : float;
  hook_timings : (string * float) list;
  hook_counts : (string * int) list;
  summary_expectation_ms : float;
  payload_contract_ms : float;
  summary_validation_ms : float;
}

let zero_phase_timings =
  {
    expand_ms = 0.;
    collect_ms = 0.;
    apply_hook_ms = 0.;
    hook_timings = [];
    hook_counts = [];
    summary_expectation_ms = 0.;
    payload_contract_ms = 0.;
    summary_validation_ms = 0.;
  }

let timed_ms f =
  let started = Sys.time () in
  let result = f () in
  (result, (Sys.time () -. started) *. 1000.)

let add_collect_ms timings ms =
  { timings with collect_ms = timings.collect_ms +. ms }

let add_apply_hook_ms timings ms =
  { timings with apply_hook_ms = timings.apply_hook_ms +. ms }

let add_hook_timing timings hook ms =
  let rec loop acc = function
    | [] -> List.rev ((hook, ms) :: acc)
    | (name, total) :: rest when name = hook ->
        List.rev_append acc ((name, total +. ms) :: rest)
    | entry :: rest -> loop (entry :: acc) rest
  in
  let hook_timings = loop [] timings.hook_timings in
  let rec count_loop acc = function
    | [] -> List.rev ((hook, 1) :: acc)
    | (name, count) :: rest when name = hook ->
        List.rev_append acc ((name, count + 1) :: rest)
    | entry :: rest -> count_loop (entry :: acc) rest
  in
  { timings with hook_timings; hook_counts = count_loop [] timings.hook_counts }

let add_summary_expectation_ms timings ms =
  { timings with summary_expectation_ms = timings.summary_expectation_ms +. ms }

let add_payload_contract_ms timings ms =
  { timings with payload_contract_ms = timings.payload_contract_ms +. ms }

let add_summary_validation_ms timings ms =
  { timings with summary_validation_ms = timings.summary_validation_ms +. ms }

let ignored_toplevel_form = function
  | Reader.List (_, Reader.Symbol (_, "ontology") :: _)
  | Reader.List (_, Reader.Symbol (_, "test") :: _)
  | Reader.List (_, Reader.Symbol (_, "test-suite") :: _)
  | Reader.List (_, Reader.Symbol (_, "form-page") :: _) ->
      true
  | _ -> false

let expr_span = function
  | Reader.Nil span
  | Reader.Bool (span, _)
  | Reader.Int (span, _)
  | Reader.Float (span, _)
  | Reader.String (span, _)
  | Reader.Symbol (span, _)
  | Reader.Keyword (span, _)
  | Reader.List (span, _)
  | Reader.Vector (span, _)
  | Reader.Map (span, _) ->
      span

let collect_declarations_with_timings env exprs =
  let is_projected = Mechanics_artifact.projected_form_predicate exprs in
  let rec loop timings form_index env declarations = function
    | [] -> Ok ((List.rev declarations, env), timings)
    | expr :: rest when ignored_toplevel_form expr ->
        loop timings (form_index + 1) env declarations rest
    | expr :: rest when is_projected expr ->
        loop timings (form_index + 1) env declarations rest
    | expr :: rest -> (
        let evaluated, collect_ms =
          timed_ms (fun () -> Eval.evaluate_program_with_env env [ expr ])
        in
        let timings = add_collect_ms timings collect_ms in
        match evaluated with
        | Error _ as error -> error
        | Ok (value, env) -> (
            let span = expr_span expr in
            let form, collect_ms =
              timed_ms (fun () -> Descriptor.declaration_form value)
            in
            let timings = add_collect_ms timings collect_ms in
            match form with
            | Some form -> (
                let hook, collect_ms =
                  timed_ms (fun () -> Descriptor.construct_hook env form)
                in
                let timings = add_collect_ms timings collect_ms in
                match hook with
                | Some hook -> (
                    let validator_names, collect_ms =
                      timed_ms (fun () ->
                          Artifact_validator_descriptor.names env form)
                    in
                    let timings = add_collect_ms timings collect_ms in
                    match validator_names with
                    | Error message ->
                        Error
                          [
                            {
                              Eval.span = Some span;
                              code = "artifact/descriptor-validators";
                              message;
                            };
                          ]
                    | Ok validator_names -> (
                        let payload_contract, payload_contract_ms =
                          timed_ms (fun () ->
                              Artifact_payload_descriptor.contract env form)
                        in
                        let timings =
                          add_payload_contract_ms timings payload_contract_ms
                        in
                        match payload_contract with
                        | Error message ->
                            Error
                              [
                                {
                                  Eval.span = Some span;
                                  code = "artifact/descriptor-payload";
                                  message;
                                };
                              ]
                        | Ok payload_contract ->
                            let summary_expectation, summary_expectation_ms =
                              timed_ms (fun () ->
                                  Artifact_summary_expectation.of_descriptor env
                                    form value)
                            in
                            let timings =
                              add_summary_expectation_ms timings
                                summary_expectation_ms
                            in
                            loop timings (form_index + 1) env
                              ({
                                 hook;
                                 declaration = value;
                                 summary_expectation;
                                 payload_contract;
                                 validator_names;
                                 form_index;
                                 span;
                               }
                              :: declarations)
                              rest))
                | None -> loop timings (form_index + 1) env declarations rest)
            | _ -> loop timings (form_index + 1) env declarations rest))
  in
  let expanded, expand_ms =
    timed_ms (fun () -> Eval.expand_program_with_env env exprs)
  in
  let timings = { zero_phase_timings with expand_ms } in
  match expanded with
  | Error _ as error -> error
  | Ok (exprs, _) -> loop timings 0 env [] exprs

let collect_declarations env exprs =
  match collect_declarations_with_timings env exprs with
  | Error _ as error -> error
  | Ok (result, _) -> Ok result

let emitted_values_with_timings env exprs =
  match collect_declarations_with_timings env exprs with
  | Error _ as error -> error
  | Ok ((declarations, env), timings) ->
      let rec loop timings emitted = function
        | [] -> Ok (List.rev emitted, timings)
        | declaration :: rest -> (
            let applied, apply_hook_ms =
              timed_ms (fun () ->
                  Eval.apply_named env declaration.hook declaration.declaration)
            in
            let timings =
              add_hook_timing
                (add_apply_hook_ms timings apply_hook_ms)
                declaration.hook apply_hook_ms
            in
            match applied with
            | Error diagnostics ->
                Error (Eval.with_span declaration.span diagnostics)
            | Ok value ->
                loop timings
                  ({
                     value;
                     summary_expectation = declaration.summary_expectation;
                     payload_contract = declaration.payload_contract;
                     validator_names = declaration.validator_names;
                     form_index = declaration.form_index;
                     span = declaration.span;
                   }
                  :: emitted)
                  rest)
      in
      loop timings [] declarations

let emitted_values env exprs =
  match emitted_values_with_timings env exprs with
  | Error _ as error -> error
  | Ok (values, _) -> Ok values

let emitted_declarations_with_timings env exprs =
  match emitted_values_with_timings env exprs with
  | Error _ as error -> error
  | Ok (values, timings) ->
      let summary_diagnostic span message =
        {
          Eval.span = Some span;
          code = "artifact/missing-type-summary";
          message;
        }
      in
      let rec loop timings declarations = function
        | [] -> Ok (List.rev declarations, timings)
        | (emitted : emitted_value) :: rest -> (
            let summary, summary_validation_ms =
              timed_ms (fun () ->
                  Descriptor_contract
                  .required_declaration_summary_of_emitted_value emitted.value)
            in
            let timings =
              add_summary_validation_ms timings summary_validation_ms
            in
            match summary with
            | Error message -> Error [ summary_diagnostic emitted.span message ]
            | Ok summary -> (
                let validated, summary_validation_ms =
                  timed_ms (fun () ->
                      Artifact_summary_expectation.validate ~span:emitted.span
                        emitted.summary_expectation summary)
                in
                let timings =
                  add_summary_validation_ms timings summary_validation_ms
                in
                match validated with
                | Error _ as error -> error
                | Ok () ->
                    loop timings
                      ({
                         value = emitted.value;
                         summary;
                         payload_contract = emitted.payload_contract;
                         validator_names = emitted.validator_names;
                         form_index = emitted.form_index;
                         span = emitted.span;
                       }
                      :: declarations)
                      rest))
      in
      loop timings [] values

let emitted_declarations env exprs =
  match emitted_declarations_with_timings env exprs with
  | Error _ as error -> error
  | Ok (declarations, _) -> Ok declarations

let typed_artifact_declarations_of_emitted ~source_id declarations =
  let validator name value =
    Packageable_declaration.make_validator ~name ~value
  in
  let validators names value =
    List.map (fun name -> validator name value) names
  in
  let payload_for span summary payload_contract value =
    match Canonical_ir_decl.declaration_of_runtime_value value with
    | Some declaration ->
        Artifact_payload_contract.of_declaration ~span ~summary
          ~contract:payload_contract declaration
        |> Result.map (fun payload -> (payload, value))
    | None ->
        Error
          [
            {
              Eval.span = Some span;
              code = "artifact/untyped-runtime-declaration";
              message =
                "Artifact declarations must cross the typed IR boundary before \
                 packaging.";
            };
          ]
  in
  let rec loop emitted = function
    | [] -> Ok (List.rev emitted)
    | declaration :: rest -> (
        match
          payload_for declaration.span declaration.summary
            declaration.payload_contract declaration.value
        with
        | Error _ as error -> error
        | Ok (payload, validator_value) ->
            loop
              (Packageable_declaration.make ~payload
                 ~payload_contract:declaration.payload_contract
                 ~validators:
                   (validators declaration.validator_names validator_value)
                 ~summary:declaration.summary ~source_id
                 ~form_index:declaration.form_index ~span:declaration.span
              :: emitted)
              rest)
  in
  loop [] declarations

let typed_artifact_declarations env ~source_id exprs =
  match emitted_declarations env exprs with
  | Error _ as error -> error
  | Ok declarations ->
      typed_artifact_declarations_of_emitted ~source_id declarations

let values_json values =
  Printf.sprintf "[%s]" (String.concat "," (List.map Eval.value_to_json values))

let emitted_declarations_json declarations =
  declarations
  |> List.map (fun (declaration : emitted_declaration) -> declaration.value)
  |> values_json

let emitted_values_json values =
  values |> List.map (fun (value : emitted_value) -> value.value) |> values_json

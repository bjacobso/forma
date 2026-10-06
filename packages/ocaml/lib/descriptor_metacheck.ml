type diagnostic = Eval.diagnostic = {
  span : Ast.span option;
  code : string;
  message : string;
}

type item = Form of string * Ast.span | Payload_contract of string * Ast.span

let diagnostic span code message = { span = Some span; code; message }

let top_level_items exprs =
  exprs
  |> List.filter_map (function
    | Ast.List (span, Ast.Symbol (_, "__form-descriptor") :: Ast.Symbol (_, name) :: _)
      ->
        Some (Form (name, span))
    | Ast.List
        ( span,
          Ast.Symbol (_, "__payload-contract") :: Ast.Symbol (_, name) :: _
        ) ->
        Some (Payload_contract (name, span))
    | _ -> None)

let artifact_value_is_map = function Value.VMap _ -> true | _ -> false

let builtin_validator_names =
  Artifact_validator_catalog.builtins |> List.map Artifact_validator.spec_name

let known_validator name = List.mem name builtin_validator_names

let check_validators span (form : Descriptor.form) =
  match Artifact_validator_descriptor.names_of_form form with
  | Error message ->
      [ diagnostic span "artifact/descriptor-validators" message ]
  | Ok names ->
      names
      |> List.filter_map (fun name ->
          if known_validator name then None
          else
            Some
              (diagnostic span "artifact/unknown-validator"
                 (Printf.sprintf "Unknown artifact validator %S." name)))

let check_payload_contract env span (form : Descriptor.form) =
  match Artifact_payload_descriptor.contract_of_form env form with
  | Ok _ -> []
  | Error message -> [ diagnostic span "artifact/descriptor-payload" message ]

let check_artifact_shape span (form : Descriptor.form) =
  match Descriptor.extension_in_form form "artifact" with
  | None -> []
  | Some artifact when artifact_value_is_map artifact -> []
  | Some _ ->
      [
        diagnostic span "artifact/descriptor-artifact"
          (Printf.sprintf
             "Descriptor artifact extension for form %S must be a map of \
              artifact clauses."
             form.name);
      ]

let check_artifact_summary_requirements span (form : Descriptor.form) =
  match Descriptor.extension_in_form form "artifact" with
  | None -> []
  | Some _ ->
      let construct_diagnostics =
        match form.hooks.construct with
        | Some _ -> []
        | None ->
            [
              diagnostic span "artifact/descriptor-summary"
                (Printf.sprintf
                   "Artifact-producing form %S must declare :construct-fn so \
                    it can emit a declaration payload with explicit :$summary \
                    metadata."
                   form.name);
            ]
      in
      let result_type_diagnostics =
        match (form.result_type, form.hooks.result_type) with
        | Some _, _ | _, Some _ -> []
        | None, None ->
            [
              diagnostic span "artifact/descriptor-summary"
                (Printf.sprintf
                   "Artifact-producing form %S must declare :result-type or \
                    :result-type-fn so emitted summaries have a checked result \
                    type."
                   form.name);
            ]
      in
      construct_diagnostics @ result_type_diagnostics

let hook_entries (form : Descriptor.form) =
  [
    ("bindings", form.hooks.bindings);
    ("construct", form.hooks.construct);
    ("result-type", form.hooks.result_type);
    ("infer", form.hooks.infer);
    ("check", form.hooks.check);
  ]

let normalize_name name =
  if String.length name > 0 && name.[0] = ':' then
    String.sub name 1 (String.length name - 1)
  else name

let check_artifact_hook_refs env span (form : Descriptor.form) =
  match Descriptor.extension_in_form form "artifact" with
  | None -> []
  | Some _ ->
      hook_entries form
      |> List.filter_map (function
        | _, None -> None
        | phase, Some hook_name ->
            let normalized = normalize_name hook_name in
            if
              Option.is_some (Env.lookup normalized env)
              || Eval_native_construct.has_descriptor env normalized
            then None
            else
              Some
                (diagnostic span "descriptor/unresolved-hook"
                   (Printf.sprintf
                      "Descriptor hook %S for artifact-producing form %S \
                       references unresolved hook %S."
                      phase form.name hook_name)))

let check_form env name span =
  match Descriptor.form env name with
  | None ->
      [
        diagnostic span "descriptor/form"
          (Printf.sprintf "Descriptor form %S was not registered." name);
      ]
  | Some form ->
      check_artifact_shape span form
      @ check_validators span form
      @ check_payload_contract env span form
      @ check_artifact_summary_requirements span form

let check_payload_contract env name span =
  match Artifact_payload_descriptor.contract_by_name env name with
  | Ok _ -> []
  | Error message -> [ diagnostic span "artifact/descriptor-payload" message ]

let validate env exprs =
  let diagnostics =
    top_level_items exprs
    |> List.concat_map (function
      | Form (name, span) -> check_form env name span
      | Payload_contract (name, span) -> check_payload_contract env name span)
  in
  match diagnostics with [] -> Ok () | _ -> Error diagnostics

let validate_artifact_hooks env exprs =
  let diagnostics =
    top_level_items exprs
    |> List.concat_map (function
      | Payload_contract _ -> []
      | Form (name, span) -> (
          match Descriptor.form env name with
          | None -> []
          | Some form -> check_artifact_hook_refs env span form))
  in
  match diagnostics with [] -> Ok () | _ -> Error diagnostics

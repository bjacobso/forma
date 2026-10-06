type t = {
  kind : string option;
  name : string option;
  result_type : string option;
}

let rec construct_expr_references_declaration_name = function
  | Eval.VSymbol "declaration-name" -> true
  | Eval.VList values | Eval.VVector values ->
      List.exists construct_expr_references_declaration_name values
  | _ -> false

let construct_name_follows_declaration env form =
  Descriptor.construct_fields env form
  |> List.exists (fun (field : Descriptor.construct_field) ->
      field.name = "name"
      && construct_expr_references_declaration_name field.expr)

let of_descriptor env form declaration =
  ({
     kind = Descriptor.construct_kind env form;
     name =
       (if construct_name_follows_declaration env form then
          Eval_slot.declaration_name declaration
        else None);
     result_type =
       (if Env.lookup ("__form/" ^ form) env <> None && Descriptor.result_type_hook env form <> None then None else Option.bind (Descriptor.result_type env form) Descriptor.value_text);
   }
    : t)

let mismatch_diagnostic span message =
  { Eval.span = Some span; code = "artifact/summary-mismatch"; message }

let validate ~span expectation
    (summary : Artifact_summary_types.declaration_summary) =
  let summary_kind = Artifact_summary_types.declaration_summary_kind summary in
  let summary_name = Artifact_summary_types.declaration_summary_name summary in
  let summary_result_type =
    Artifact_summary_types.declaration_summary_result_type summary
  in
  match expectation.kind with
  | Some expected when summary_kind <> expected ->
      Error
        [
          mismatch_diagnostic span
            (Printf.sprintf
               "Declaration summary kind %S does not match descriptor \
                construct kind %S."
               summary_kind expected);
        ]
  | _ -> (
      match (expectation.name, summary_name) with
      | Some expected, Some actual when actual <> expected ->
          Error
            [
              mismatch_diagnostic span
                (Printf.sprintf
                   "Declaration summary name %S does not match descriptor \
                    declaration name %S."
                   actual expected);
            ]
      | Some expected, None ->
          Error
            [
              mismatch_diagnostic span
                (Printf.sprintf
                   "Declaration summary is missing descriptor declaration name \
                    %S."
                   expected);
            ]
      | _ -> (
          match expectation.result_type with
          | Some expected when summary_result_type <> expected ->
              Error
                [
                  mismatch_diagnostic span
                    (Printf.sprintf
                       "Declaration summary resultType %S does not match \
                        descriptor result type %S."
                       summary_result_type expected);
                ]
          | _ -> Ok ()))

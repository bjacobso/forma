type payload = { value : Artifact_validated_payload.t }
type payload_contract = Artifact_payload_descriptor.contract
type validator = { name : string; value : Value.t }

type t = {
  diagnostics : Diagnostic.t list;
  payload : payload;
  payload_contract : payload_contract;
  validators : validator list;
  summary : Artifact_summary_types.declaration_summary;
  source_id : string;
  form_index : int;
  span : Ast.span;
}

let make_payload ~value = { value }
let payload_value (payload : payload) = payload.value
let make_validator ~name ~value = { name; value }
let validator_name (validator : validator) = validator.name
let validator_value (validator : validator) = validator.value

let make ~diagnostics ~payload ~payload_contract ~validators ~summary ~source_id ~form_index
    ~span =
  {
    diagnostics;
    payload;
    payload_contract;
    validators;
    summary;
    source_id;
    form_index;
    span;
  }

let payload (declaration : t) = declaration.payload
let payload_contract (declaration : t) = declaration.payload_contract
let validators (declaration : t) = declaration.validators
let summary (declaration : t) = declaration.summary
let source_id (declaration : t) = declaration.source_id
let form_index (declaration : t) = declaration.form_index
let span (declaration : t) = declaration.span

let diagnostics (declaration : t) = declaration.diagnostics

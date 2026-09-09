import { readFileSync, readdirSync, statSync } from "node:fs";
import { corpusGolden } from "./gates.mjs";

const cwd = new URL("..", import.meta.url);
const lib = new URL("lib/", cwd);
const repoRoot = new URL("../../", cwd);
const targetMaxLines = 557;

const listFiles = (directory) =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const child = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory);
    if (entry.isDirectory()) return listFiles(child);
    if (entry.name.endsWith(".ml") || entry.name.endsWith(".mli")) return [child];
    return [];
  });

const lineCount = (path) => {
  const text = readFileSync(path, "utf8");
  return text.length === 0 ? 0 : text.replace(/\r?\n$/, "").split(/\r?\n/).length;
};

const occurrences = (text, snippet) => text.split(snippet).length - 1;

const failures = [];

for (const file of listFiles(lib)) {
  const name = file.pathname.slice(lib.pathname.length);
  const lines = lineCount(file);

  if (lines > targetMaxLines) {
    failures.push(`${name} is ${lines} LOC; lib files must stay under ${targetMaxLines} LOC.`);
  }
}

const dist = new URL("dist/", cwd);
if (statSync(dist, { throwIfNoEntry: false })) {
  const generated = listFiles(dist).filter((file) => file.pathname.endsWith(".json"));
  for (const file of generated) {
    const text = readFileSync(file, "utf8");
    if (text.includes('"span":null')) {
      failures.push(`${file.pathname} contains a span:null diagnostic.`);
    }
  }
}

const expectSourceIncludes = (fileName, snippets) => {
  const file = new URL(`lib/${fileName}`, cwd);
  const text = readFileSync(file, "utf8");
  for (const snippet of snippets) {
    if (!text.includes(snippet)) {
      failures.push(`${fileName} is missing typed IR boundary guard: ${snippet}`);
    }
  }
};

const expectSourceExcludes = (fileName, snippets) => {
  const file = new URL(`lib/${fileName}`, cwd);
  const text = readFileSync(file, "utf8");
  for (const snippet of snippets) {
    if (text.includes(snippet)) {
      failures.push(`${fileName} reintroduced forbidden reset pattern: ${snippet}`);
    }
  }
};

const expectLibReferencesOnly = (snippet, allowedFileNames) => {
  const allowed = new Set(allowedFileNames);
  for (const file of listFiles(lib)) {
    const name = file.pathname.slice(lib.pathname.length);
    const text = readFileSync(file, "utf8");
    if (text.includes(snippet) && !allowed.has(name)) {
      failures.push(
        `${name} uses ${snippet}; allowed reset boundary files are ${[...allowed].join(", ")}.`,
      );
    }
  }
};

expectSourceIncludes("elaborate.ml", [
  "Canonical_ir_decl.declaration_of_runtime_value",
  "Artifact_summary_expectation.of_descriptor",
  "Artifact_summary_expectation.validate ~span:emitted.span",
  "Artifact_validator_descriptor.names env form",
  "Artifact_payload_descriptor.contract env form",
  "Artifact_payload_contract.of_declaration ~span ~summary",
  "payload_contract =",
  "Packageable_declaration.make_validator",
  "Packageable_declaration.make ~payload",
  "artifact/untyped-runtime-declaration",
]);

expectSourceExcludes("elaborate.ml", [
  'validator "http"',
  "Http_ir",
  'payload_string_field "kind"',
  'payload_string_field "name"',
]);

expectSourceExcludes("descriptor_contract.ml", [
  "Artifact_validator_descriptor",
  "artifact_validator_names",
  "artifact_validator_name_list",
  "Descriptor artifact validators",
]);

expectSourceIncludes("artifact_validator_descriptor.ml", [
  "let names env form_name",
  "validator_name_list form.name values",
  "must not repeat",
  "must not be empty",
]);

expectSourceExcludes("descriptor_contract.mli", ["artifact_validator_names"]);

expectSourceIncludes("artifact_payload_descriptor.ml", [
  "type field_kind =",
  "type field_constraint =",
  "field_constraints : field_constraint list",
  "let field_constraint_field constraint_",
  "let field_constraint_kind constraint_",
  "let field_constraint_literal constraint_",
  "let contract_required_fields contract",
  "let contract_field_constraints contract",
  "known_payload_clause_names",
  '"contract"',
  "payload_contract_value artifact",
  "payload_contract_names form_name payload",
  "payload_contract_by_name env form_name",
  "payload_contract_descriptor_value form_name name",
  "merge_contract_list form_name",
  "merge_contracts form_name",
  "is recursive",
  "validate_known_payload_clauses form_name",
  "payload clauses with textual clause names",
  "Unknown descriptor artifact payload clause",
  "literal_fields_from_value form_name",
  "kind_constraints form_name",
  "validate_literal_kind_constraints form_name",
  "conflicting kind constraints",
  "cannot also be constrained",
  "let contract env form_name",
  "not repeat field",
  "not repeat contract",
]);

expectSourceExcludes("artifact_payload_descriptor.mli", [
  "type field_constraint = {",
  "type contract = {",
]);

expectSourceIncludes("eval_toplevel.ml", [
  '"define-payload-contract"',
  'Descriptor.declaration_value "payload-contract" name clauses',
]);

expectSourceIncludes("typed_toplevel.ml", [
  '"define-payload-contract"',
  "typecheck/define-payload-contract",
]);

expectSourceIncludes("artifact_summary_expectation.ml", [
  "Descriptor.construct_kind env form",
  "construct_name_follows_declaration env form",
  "Eval_slot.declaration_name declaration",
  "Artifact_summary_types.declaration_summary_kind summary",
  "Artifact_summary_types.declaration_summary_name summary",
  "Artifact_summary_types.declaration_summary_result_type summary",
]);

expectSourceIncludes("elaborate.mli", [
  "type collected_declaration",
  "type emitted_value",
  "type emitted_declaration",
]);

expectSourceExcludes("elaborate.mli", [
  "summary_expectation :",
  "form_index : int",
  "span : Ast.span",
]);

expectSourceIncludes("artifact_summary_expectation.mli", ["type t"]);

expectSourceExcludes("artifact_summary_expectation.mli", [
  "kind : string option",
  "name : string option",
  "result_type : string option",
]);

expectSourceIncludes("artifact_declaration_packaging.ml", [
  "Artifact_types.make_provenance_span",
  "Artifact_types.make_declaration_provenance",
  "Artifact_types.make_package_declaration",
  "Packageable_declaration.payload_value",
  "Packageable_declaration.payload declaration",
  "Packageable_declaration.summary declaration",
]);

expectSourceExcludes("artifact_declaration_packaging.ml", [
  "Typed_canonical",
  "Typed_http",
  "Http_ir.declaration_payload_value",
  "match artifact_declaration.payload",
  "Artifact_validated_payload.to_json",
  "Artifact_validated_payload.canonical_json",
  "Ir_json.to_string",
  "declaration_values_json",
]);

expectSourceExcludes("artifact_declaration_packaging.mli", ["declaration_values_json"]);

expectSourceIncludes("packageable_declaration.ml", [
  "type payload = {",
  "value : Artifact_validated_payload.t",
  "type payload_contract = Artifact_payload_descriptor.contract",
  "payload_contract : payload_contract;",
  "type validator = {",
  "name : string;",
  "value : Value.t",
  "validators : validator list;",
  "let make_payload ~value",
  "let payload_value (payload : payload)",
  "let make_validator ~name ~value",
  "let validator_name (validator : validator)",
  "let make ~payload ~payload_contract ~validators ~summary ~source_id ~form_index",
  "let payload (declaration : t)",
  "let payload_contract (declaration : t)",
  "let validators (declaration : t)",
  "let summary (declaration : t)",
  "let span (declaration : t)",
]);

expectSourceExcludes("packageable_declaration.ml", [
  "Typed_canonical",
  "Typed_http",
  "Http of",
  "Http_ir",
  "kind : string option",
  "name : string option",
]);

expectSourceExcludes("packageable_declaration.mli", [
  "type payload = {",
  "type payload_contract = Artifact_payload_descriptor.contract = {",
  "type validator = {",
  "type t = {",
]);

expectSourceIncludes("artifact_validated_payload.ml", [
  "type t = { declaration : Canonical_ir_decl.declaration }",
  "let of_declaration declaration",
  "let canonical_json payload",
  "Canonical_ir_decl.declaration_to_json payload.declaration",
  "let canonical_declaration payload",
]);

expectSourceExcludes("artifact_validated_payload.ml", [
  "type t = { value : Ir_json.t }",
  "let to_json payload",
  "Canonical_ir_decl.declaration_of_json",
]);

expectSourceIncludes("artifact_validated_payload.mli", [
  "type t",
  "val of_declaration : Canonical_ir_decl.declaration -> t",
  "val canonical_json : t -> Ir_json.t",
  "val canonical_declaration : t -> Canonical_ir_decl.declaration",
]);

expectSourceExcludes("artifact_validated_payload.mli", [
  "val to_json",
  "to_canonical_declaration",
  "Ir_json.t option",
]);

expectSourceIncludes("artifact_types.ml", [
  "type engine_manifest = {",
  "let make_engine_manifest ~name ~version",
  "let engine_manifest_name (engine : engine_manifest)",
  "let engine_manifest_version (engine : engine_manifest)",
  "type source_manifest = {",
  "hash : Artifact_package_metadata.source_hash;",
  "type provenance_span = {",
  "type declaration_provenance = {",
  "type package_declaration = {",
  "value : Artifact_validated_payload.t;",
  "ir_version : Artifact_package_metadata.ir_version;",
  "kind : Artifact_package_metadata.kind;",
  "hash_algorithm : Artifact_package_metadata.hash_algorithm;",
  "declarations_hash : Artifact_package_metadata.declarations_hash;",
  "let make_source_manifest ~id ~hash",
  "let source_manifest_id (manifest : source_manifest)",
  "let make_provenance_span",
  "let provenance_span_start_offset (span : provenance_span)",
  "let make_declaration_provenance",
  "let declaration_provenance_index (provenance : declaration_provenance)",
  "let make_package_declaration ~value ~provenance ~type_summary",
  "let package_declaration_value (declaration : package_declaration)",
  "let make_package ~ir_version ~kind",
  "let package_ir_version (package : package)",
  "let package_kind (package : package)",
  "let package_declarations (package : package)",
  "let make_artifact ~name ~media_type ~content",
  "let artifact_content (artifact : artifact)",
]);

expectSourceExcludes("artifact_types.mli", [
  "type engine_manifest = {",
  "type source_manifest = {",
  "type provenance_span = {",
  "type declaration_provenance = {",
  "type package_declaration = {",
  "type package = {",
  "type artifact = {",
]);

expectSourceIncludes("artifact_json.ml", [
  "Artifact_types.source_manifest_id manifest",
  "Artifact_validated_payload.canonical_json",
  "Artifact_types.package_declaration_value declaration",
  "Artifact_types.package_declaration_type_summary declaration",
  "Artifact_types.package_declaration_provenance declaration",
  "Artifact_types.declaration_provenance_index provenance",
  "Artifact_summary_types.make_derived_manifest",
  "let declaration_summary_json summary",
  "let package_summary_json summary",
  "let derived_manifest_json manifest",
  "Artifact_summary_types.derived_manifest_kind manifest",
  "Artifact_summary_types.derived_manifest_declarations manifest",
  "Artifact_types.package_ir_version package",
  "Artifact_types.package_kind package",
  "Artifact_types.engine_manifest_name engine",
  "Artifact_types.engine_manifest_version engine",
  "Artifact_types.package_declarations package",
  "Artifact_types.artifact_content artifact",
  "Artifact_package_metadata.hash_algorithm_to_string",
  "Artifact_package_metadata.source_hash_to_string",
  "Artifact_package_metadata.declarations_hash_to_string",
]);

expectSourceIncludes("artifact_manifest.ml", [
  "Artifact_types.make_engine_manifest",
  "Artifact_types.make_source_manifest",
  "Artifact_types.make_package",
  "Artifact_package_metadata.current_ir_version",
  "Artifact_package_metadata.canonical_ir_kind",
  "Artifact_package_metadata.md5_hash_algorithm",
  "Artifact_package_metadata.source_hash (Source.hash source)",
  "Artifact_package_hash.hash_declarations ~algorithm:hash_algorithm",
]);

expectSourceExcludes("artifact_manifest.ml", [
  "Artifact_validated_payload.to_json",
  "Artifact_validated_payload.canonical_json",
  "Ir_json.to_string",
  "declaration_values_json",
]);

expectSourceIncludes("artifact_package_hash.ml", [
  "let declaration_values_json declarations",
  "Artifact_validated_payload.canonical_json",
  "Artifact_types.package_declaration_value declaration",
  "Ir_json.to_string (Ir_json.Array values)",
  "let hash_declarations ~algorithm declarations",
  "Artifact_package_metadata.hash_declarations algorithm",
]);

expectSourceIncludes("artifact_package_metadata.ml", [
  "type ir_version = Ir_version of string",
  "type kind = Kind of string",
  "type hash_algorithm = Hash_algorithm of string",
  "type source_hash = Source_hash of string",
  "type declarations_hash = Declarations_hash of string",
  'let current_ir_version = Ir_version "1"',
  'let canonical_ir_kind = Kind "CanonicalIr"',
  'let md5_hash_algorithm = Hash_algorithm "md5"',
  "let ir_version_to_string",
  "let kind_to_string",
  "let hash_algorithm_to_string",
  "let source_hash_to_string",
  "let declarations_hash_to_string",
  "let hash_declarations algorithm value",
]);

expectSourceIncludes("artifact_summary_types.ml", [
  "type declaration_summary = {",
  "let make_declaration_summary ~kind ~name ~type_name",
  "let declaration_summary_kind summary",
  "let declaration_summary_name summary",
  "let declaration_summary_result_type summary",
  "type package_summary = {",
  "let make_package_summary ~declaration_count ~result_types",
  "let package_summary_declaration_count summary",
  "let package_summary_result_types summary",
  "type derived_manifest = {",
  "let make_derived_manifest",
  "let derived_manifest_kind manifest",
  "let derived_manifest_declarations manifest",
]);

expectSourceExcludes("artifact_summary_types.mli", [
  "type declaration_summary = {",
  "type package_summary = {",
  "type derived_manifest = {",
  "declaration_summary_json",
  "package_summary_json",
  "derived_manifest_json",
]);

expectSourceIncludes("artifact_summary.ml", [
  "Artifact_summary_types.declaration_summary_result_type",
  "Artifact_summary_types.make_package_summary",
]);

expectSourceExcludes("artifact_package_metadata.ml", [
  "let ir_version value",
  "let kind value",
  "let hash_algorithm value",
]);

expectSourceExcludes("artifact_package_metadata.mli", [
  "val ir_version : string -> ir_version",
  "val kind : string -> kind",
  "val hash_algorithm : string -> hash_algorithm",
]);

expectSourceIncludes("http_ir.ml", ["let schema_payload_value", "let http_api_payload_value"]);

expectSourceIncludes("http_ir_validation.ml", [
  "type declaration = {",
  "let make_declaration ~index ~span ~value",
  "let declaration_index declaration",
  "let declaration_span declaration",
  "let declaration_value declaration",
]);

expectSourceIncludes("http_ir_validation.mli", [
  "type declaration",
  "val make_declaration :",
  "val declaration_index : declaration -> int",
  "val declaration_span : declaration -> Ast.span",
  "val declaration_value : declaration -> Http_ir.value",
]);

expectSourceExcludes("http_ir_validation.mli", ["type declaration = {"]);

const forbiddenHttpDeclarationShape = [
  "type declaration",
  "Schema_decl",
  "Http_api",
  "declaration_of_value",
  "let declaration_value",
  "declaration_payload_value",
];

expectSourceExcludes("http_ir.ml", [
  ...forbiddenHttpDeclarationShape,
  "declaration_summary_value",
  "declaration_value_with_summary",
  "artifact_payload_value",
  "http_payload_kind",
  '"$summary"',
  'result_type:"SchemaDecl"',
  'result_type:"HttpApiDecl"',
]);

expectSourceExcludes("http_ir.mli", forbiddenHttpDeclarationShape);

expectSourceIncludes("canonical_ir_decl.ml", ['key <> "$summary"']);

expectSourceIncludes("canonical_ir_decl.mli", [
  "type declaration",
  "payload_string_field",
  "payload_field",
  "declaration_to_json",
]);

expectSourceExcludes("canonical_ir_decl.mli", ["type declaration = {"]);

expectSourceIncludes("canonical_ir_decl.ml", [
  "type declaration = { value : Ir_json.t }",
  "let declaration_of_json",
  "let declaration_of_runtime_value",
  "let payload_string_field",
  "let payload_field",
]);

expectSourceIncludes("artifact_payload_contract.ml", [
  "Canonical_ir_decl.payload_field field declaration",
  "Canonical_ir_decl.payload_field field payload",
  "Artifact_typed_payload_validator.validate_declaration declaration",
  "Artifact_typed_payload_validator.validate_declaration payload",
  "let typed_protocol_diagnostic span",
  "let package_typed_protocol_diagnostic ~path span",
  "let matches_kind kind",
  "let validate_constraint",
  "Artifact_payload_descriptor.field_constraint_field constraint_",
  "Artifact_payload_descriptor.field_constraint_kind constraint_",
  "Artifact_payload_descriptor.field_constraint_literal constraint_",
  "Artifact_payload_descriptor.contract_field_constraints contract",
  "Artifact_payload_descriptor.contract_required_fields contract",
  "literal %S does not match",
  'Canonical_ir_decl.payload_string_field "kind" declaration',
  'Canonical_ir_decl.payload_string_field "name" declaration',
  "descriptor artifact contract.",
  "let validate_packageable_declaration index",
  "Artifact_validated_payload.of_declaration declaration",
  "Packageable_declaration.make_payload",
  "Artifact_validated_payload.canonical_declaration",
  "Packageable_declaration.payload_value",
  "Packageable_declaration.payload declaration",
  "Packageable_declaration.payload_contract declaration",
  "Packageable_declaration.summary declaration",
  "Artifact_typed_payload_validator.diagnostic_code diagnostic",
  "Artifact_typed_payload_validator.diagnostic_path diagnostic",
  "Artifact_typed_payload_validator.diagnostic_message diagnostic",
  "artifact/summary-mismatch",
]);

expectLibReferencesOnly("Artifact_validated_payload.canonical_json", [
  "artifact_json.ml",
  "artifact_package_hash.ml",
]);

expectLibReferencesOnly("Artifact_validated_payload.to_json", []);

expectLibReferencesOnly("Artifact_validated_payload.canonical_declaration", [
  "artifact_payload_contract.ml",
]);

expectLibReferencesOnly("Canonical_ir_decl.declaration_to_json", ["artifact_validated_payload.ml"]);

expectSourceIncludes("artifact_typed_payload_validator.ml", [
  "type diagnostic = {",
  "code : string;",
  "path : string;",
  "message : string",
  "let diagnostic_code diagnostic",
  "let diagnostic_path diagnostic",
  "let diagnostic_message diagnostic",
  "type validator = {",
  "validate : Canonical_ir_decl.declaration -> diagnostic list",
  "Canonical_query_decl.diagnostic_path d",
  "Canonical_record_decl.diagnostic_path d",
  "Canonical_entity_decl.diagnostic_path d",
  "Canonical_edge_decl.diagnostic_path d",
  "Canonical_operation_decl.diagnostic_path d",
  "Canonical_surface_decl.diagnostic_path d",
  "Canonical_rule_decl.diagnostic_path d",
  "Canonical_workflow_decl.diagnostic_path d",
  "Canonical_content_decl.diagnostic_path d",
  "let validators =",
  "Canonical_query_decl.validate_declaration",
  "Canonical_record_decl.validate_declaration",
  "Canonical_entity_decl.validate_declaration",
  "Canonical_edge_decl.validate_declaration",
  "Canonical_operation_decl.validate_declaration",
  "Canonical_surface_decl.validate_declaration",
  "Canonical_rule_decl.validate_declaration",
  "Canonical_workflow_decl.validate_declaration",
  "Canonical_content_decl.validate_declaration",
  "artifact/query-payload",
  "artifact/record-payload",
  "artifact/entity-payload",
  "artifact/edge-payload",
  "artifact/operation-payload",
  "artifact/surface-payload",
  "artifact/rule-payload",
  "artifact/workflow-payload",
  "artifact/content-payload",
  "let validate_declaration declaration",
]);

expectSourceIncludes("artifact_typed_payload_validator.mli", [
  "type diagnostic",
  "val diagnostic_code : diagnostic -> string",
  "val diagnostic_path : diagnostic -> string",
  "val diagnostic_message : diagnostic -> string",
]);

expectSourceExcludes("artifact_typed_payload_validator.mli", ["type diagnostic = {"]);

expectSourceExcludes("artifact_payload_contract.ml", [
  "Http_ir",
  "Entity of",
  "Query of",
  "Action of",
]);

for (const canonicalPayloadModule of [
  "canonical_query_decl",
  "canonical_record_decl",
  "canonical_entity_decl",
  "canonical_edge_decl",
  "canonical_operation_decl",
  "canonical_surface_decl",
  "canonical_rule_decl",
  "canonical_workflow_decl",
  "canonical_content_decl",
]) {
  expectSourceIncludes(`${canonicalPayloadModule}.mli`, [
    "type diagnostic",
    "val diagnostic_path : diagnostic -> string",
    "val diagnostic_message : diagnostic -> string",
    "val validate_declaration : Canonical_ir_decl.declaration -> diagnostic list",
  ]);
  expectSourceExcludes(`${canonicalPayloadModule}.mli`, [
    "type diagnostic = {",
    "val of_declaration",
    "type t =",
    "Ir_json.t",
  ]);
}

expectSourceIncludes("canonical_query_decl.ml", [
  "type t = {",
  "from : string option;",
  "select : string list option;",
  "let query_of_declaration declaration",
  'Some "Query"',
  "validate_declaration",
]);

expectSourceIncludes("canonical_record_decl.ml", [
  "type t = {",
  "fields : (string * Ir_json.t) list;",
  "let record_of_declaration declaration",
  'Some "Record"',
  "validate_declaration",
]);

expectSourceIncludes("canonical_entity_decl.ml", [
  "type field = {",
  "field_types : (string * Ir_json.t) list option;",
  "let entity_of_declaration declaration kind",
  'Some ("Entity" as kind)',
  'Some ("MetaEntity" as kind)',
  "validate_declaration",
]);

expectSourceIncludes("canonical_edge_decl.ml", [
  "type relation_field = {",
  "type link_field =",
  "Relation_payload of relation",
  "Link_payload of link",
  'Some "Relation"',
  'Some "Link"',
  "validate_declaration",
]);

expectSourceIncludes("canonical_operation_decl.ml", [
  "type input = {",
  "body : Ir_json.t;",
  "let operation_of_declaration declaration kind",
  'Some ("Action" as kind)',
  'Some ("Mutation" as kind)',
  "validate_declaration",
]);

expectSourceIncludes("canonical_surface_decl.ml", [
  "type column = {",
  "View_payload of view",
  "Workspace_payload of container",
  "let view_of_declaration declaration",
  "let workspace_of_declaration declaration",
  'Some "View"',
  'Some "Workspace"',
  "validate_declaration",
]);

expectSourceIncludes("canonical_rule_decl.ml", [
  "type assignment = {",
  "type resolution = {",
  "task_assignments : assignment list option;",
  "let rule_of_declaration declaration",
  'Some "Constraint"',
  "validate_declaration",
]);

expectSourceIncludes("canonical_workflow_decl.ml", [
  "type flow = {",
  "type work_item = {",
  "Flow_payload of flow",
  "Work_item_payload of work_item",
  "let flow_of_declaration declaration",
  "let work_item_of_declaration declaration",
  'Some "Process"',
  'Some "TaskDefinition"',
  "validate_declaration",
]);

expectSourceIncludes("canonical_content_decl.ml", [
  "type template = {",
  "type locale_bundle = {",
  "type localized_bundle = {",
  "type file_binding = {",
  "template_file : string option;",
  "template_filename : string option;",
  "document_name : string option;",
  "document_ref : Ir_json.t option;",
  "Template_payload of template",
  "File_binding_payload of file_binding",
  "let template_of_declaration declaration",
  "let locale_bundle_of_declaration declaration",
  "let localized_bundle_of_declaration declaration",
  "let file_binding_of_declaration declaration",
  'Some "Document"',
  'Some "DocumentLocale"',
  'Some "DocumentLocalized"',
  'Some "PdfMapping"',
  "validate_declaration",
]);

expectSourceIncludes("canonical_content_mapping_decl.ml", [
  "type mapping_entry = {",
  "let required_non_empty_array field label parse declaration",
  "let validate_mapping_kind_shape index kind entries cases",
  "let parse_mapping_cases index prefix values",
  "let required_case_assignments mapping_index case_index prefix entries",
  "let mappings_of_declaration declaration",
  "%s payload must not be empty.",
  "Content mapping kind must be direct, computed, or switch.",
  "Content mapping switch cases must not be empty.",
  "Content mapping case assignments must not be empty.",
  "Content mapping assignment",
  "transform",
  "value",
]);

expectSourceExcludes("canonical_ir_decl.ml", [
  "summary_result_type",
  "declaration_result_type",
  "result_type : string",
  "result_type = Some result_type",
  "let declaration_of_json ~result_type",
  "let declaration_of_runtime_value ~result_type",
  "declaration_of_json ?result_type",
  "declaration_of_runtime_value ?result_type",
]);

expectSourceIncludes("artifact_validation.ml", [
  "Artifact_payload_contract.validate_packageable_declaration",
  "Artifact_validator_registry.validate",
  "Artifact_validator_catalog.builtins",
  "validator_payloads declarations",
  "Packageable_declaration.validators declaration",
  "Packageable_declaration.validator_name validator",
  "Packageable_declaration.validator_value validator",
  "Packageable_declaration.span declaration",
  "Artifact_validator.make_payload",
]);

expectSourceExcludes("artifact_validation.ml", [
  "Http of",
  "Packageable_declaration.Http",
  "Http_ir_validation",
  '"http"',
  "declaration.payload.kind",
  "declaration.payload.name",
]);

expectSourceIncludes("artifact_validator_registry.ml", [
  "let known_validator specs name",
  "Artifact_validator.payload_name payload",
  "Artifact_validator.spec_name spec",
  "Artifact_validator.validate_spec spec",
  "Artifact_validator.diagnostic payload",
  "artifact/unknown-validator",
]);

expectSourceExcludes("artifact_validator_registry.ml", [
  "Artifact_http_validator",
  "Http_ir_validation",
  '"http"',
]);

expectSourceIncludes("artifact_validator_catalog.ml", [
  "let builtins = [",
  "Artifact_http_validator.spec",
]);

expectSourceIncludes("artifact_http_validator.ml", [
  'Artifact_validator.make_spec ~name:"http" ~validate',
  "type payload = Artifact_validator.payload",
  "Http_ir_validation.make_declaration",
  "Artifact_validator.payload_index payload",
  "Artifact_validator.payload_span payload",
  "Artifact_validator.payload_value payload",
  "Http_ir_validation.validate_declarations",
  "http_declarations payloads",
]);

expectSourceExcludes("artifact_http_validator.ml", [
  "Http_ir_validation.index",
  ": Http_ir_validation.declaration",
]);

expectSourceIncludes("artifact_validator.ml", [
  "type payload = {",
  "let make_payload ~name ~index ~span ~value",
  "let payload_name payload",
  "let payload_index payload",
  "let payload_span payload",
  "let payload_value payload",
  "type spec = {",
  "let make_spec ~name ~validate",
  "let spec_name spec",
  "let validate_spec spec payloads",
]);

expectSourceExcludes("artifact_validator.mli", ["value : Value.t", "type spec = {"]);

expectSourceIncludes("artifact_validator.mli", [
  "type payload",
  "val make_payload :",
  "val payload_name : payload -> string",
  "val payload_index : payload -> int",
  "val payload_span : payload -> Ast.span",
  "val payload_value : payload -> Value.t",
  "type spec",
  "val make_spec :",
  "val spec_name : spec -> string",
  "val validate_spec : spec -> payload list -> Diagnostic.t list",
]);

expectSourceIncludes("descriptor_metacheck.ml", ["Artifact_validator.spec_name"]);

expectSourceIncludes("http_ir_validation.ml", [
  "type declaration = {",
  "index : int;",
  "span : Ast.span;",
  "value : Http_ir.value;",
  "validate_http_declaration_shapes declarations",
  "Http_ir.schema_payload_of_value",
  "Http_ir.http_api_payload_of_value",
]);

expectSourceExcludes("http_ir_validation.ml", [
  "Packageable_declaration",
  "Typed_canonical",
  "Typed_http",
  "Http_ir.Schema_decl",
  "Http_ir.Http_api",
  "declaration.payload",
]);

expectSourceIncludes("artifact.ml", [
  "match validate_declarations declarations with",
  "Declaration_packaging.package_declarations sources declarations",
  "Artifact_types.make_artifact",
]);

expectSourceIncludes("descriptor_contract.ml", [
  "required_declaration_summary_of_emitted_value",
  'Descriptor.value_keyword ":$summary" value',
  'required_summary_text "resultType" summary_value',
  "Artifact_summary_types.make_declaration_summary",
]);

const expectTextIncludes = (path, snippets) => {
  const text = readFileSync(path, "utf8");
  for (const snippet of snippets) {
    if (!text.includes(snippet)) {
      failures.push(`${path.pathname} is missing reset guard text: ${snippet}`);
    }
  }
};

const payloadContractBlocks = (text) => {
  const blocks = [];
  const marker = "(:payload";
  let searchFrom = 0;

  while (true) {
    const start = text.indexOf(marker, searchFrom);
    if (start === -1) break;

    let depth = 0;
    let end = -1;

    for (let index = start; index < text.length; index += 1) {
      const char = text[index];
      if (char === "(") depth += 1;
      if (char === ")") {
        depth -= 1;
        if (depth === 0) {
          end = index + 1;
          break;
        }
      }
    }

    if (end === -1) {
      failures.push("preludes/ontology.lisp contains an unterminated :payload contract.");
      break;
    }

    blocks.push({
      start,
      block: text.slice(start, end),
    });
    searchFrom = end;
  }

  return blocks;
};

const malformedFixtureSourceBlock = (text, fixture) => {
  const fixtureCall = `(${fixture} `;
  const fixtureIndex = text.indexOf(fixtureCall);
  if (fixtureIndex === -1) return null;
  const start = text.lastIndexOf("const ", fixtureIndex);
  const end = text.indexOf("`;", fixtureIndex);
  if (start === -1 || end === -1) return null;
  return text.slice(start, end);
};

const malformedFixtureSymbolBase = (fixture) =>
  fixture
    .replace(/^define-/, "")
    .split("-")
    .map((part, index) => (index === 0 ? part : `${part[0].toUpperCase()}${part.slice(1)}`))
    .join("");

const typedMalformedFixtureCaseBlock = (text, fixture) => {
  const formSnippet = `form: "(${fixture} `;
  const formIndex = text.indexOf(formSnippet);
  if (formIndex === -1) return null;
  const start = text.lastIndexOf("    {", formIndex);
  const end = text.indexOf("\n    },", formIndex);
  if (start === -1 || end === -1) return null;
  return text.slice(start, end);
};

const typedMalformedPayloadSourcesBlock = (text) => {
  const start = text.indexOf("const typedMalformedPayloadSources = [");
  if (start === -1) return null;
  const end = text.indexOf("\n  ];", start);
  if (end === -1) return null;
  return text.slice(start, end);
};

const phase3CorpusPayloadMatrix = [
  {
    kind: "Record",
    contract: "RecordPayload",
    validatorModule: "Canonical_record_decl",
    diagnosticCode: "artifact/record-payload",
    malformedFixture: "define-malformed-record-payload",
  },
  {
    kind: "Link",
    contract: "LinkPayload",
    validatorModule: "Canonical_edge_decl",
    diagnosticCode: "artifact/edge-payload",
    malformedFixture: "define-malformed-link-payload",
  },
  {
    kind: "Entity",
    contract: "EntityPayload",
    validatorModule: "Canonical_entity_decl",
    diagnosticCode: "artifact/entity-payload",
    malformedFixture: "define-malformed-entity-payload",
  },
  {
    kind: "Query",
    contract: "QueryPayload",
    validatorModule: "Canonical_query_decl",
    diagnosticCode: "artifact/query-payload",
    malformedFixture: "define-malformed-query-payload",
  },
  {
    kind: "Action",
    contract: "ActionPayload",
    validatorModule: "Canonical_operation_decl",
    diagnosticCode: "artifact/operation-payload",
    malformedFixture: "define-malformed-operation-payload",
  },
  {
    kind: "View",
    contract: "ViewPayload",
    validatorModule: "Canonical_surface_decl",
    diagnosticCode: "artifact/surface-payload",
    malformedFixture: "define-malformed-surface-payload",
  },
  {
    kind: "Constraint",
    contract: "ConstraintPayload",
    validatorModule: "Canonical_rule_decl",
    diagnosticCode: "artifact/rule-payload",
    malformedFixture: "define-malformed-rule-payload",
  },
  {
    kind: "Relation",
    contract: "RelationPayload",
    validatorModule: "Canonical_edge_decl",
    diagnosticCode: "artifact/edge-payload",
    malformedFixture: "define-malformed-edge-payload",
  },
  {
    kind: "DocumentLocale",
    contract: "DocumentLocalePayload",
    validatorModule: "Canonical_content_decl",
    diagnosticCode: "artifact/content-payload",
    malformedFixture: "define-malformed-content-locale-payload",
  },
  {
    kind: "Document",
    contract: "DocumentPayload",
    validatorModule: "Canonical_content_decl",
    diagnosticCode: "artifact/content-payload",
    malformedFixture: "define-malformed-content-payload",
  },
  {
    kind: "DocumentLocalized",
    contract: "DocumentLocalizedPayload",
    validatorModule: "Canonical_content_decl",
    diagnosticCode: "artifact/content-payload",
    malformedFixture: "define-malformed-content-localized-payload",
  },
  {
    kind: "Workspace",
    contract: "WorkspacePayload",
    validatorModule: "Canonical_surface_decl",
    diagnosticCode: "artifact/surface-payload",
    malformedFixture: "define-malformed-workspace-payload",
  },
  {
    kind: "Process",
    contract: "ProcessPayload",
    validatorModule: "Canonical_workflow_decl",
    diagnosticCode: "artifact/workflow-payload",
    malformedFixture: "define-malformed-workflow-payload",
  },
  {
    kind: "Schema",
    contract: "SchemaPayload",
    httpValidator: true,
    malformedFixture: "http-api.mjs",
  },
  {
    kind: "TaskDefinition",
    contract: "TaskPayload",
    validatorModule: "Canonical_workflow_decl",
    diagnosticCode: "artifact/workflow-payload",
    malformedFixture: "define-malformed-task-payload",
  },
  {
    kind: "HttpApi",
    contract: "HttpApiPayload",
    httpValidator: true,
    malformedFixture: "http-api.mjs",
  },
  {
    kind: "PdfMapping",
    contract: "PdfMappingPayload",
    validatorModule: "Canonical_content_decl",
    diagnosticCode: "artifact/content-payload",
    malformedFixture: "define-malformed-content-mapping-payload",
  },
];

const forbiddenOntologyForms = [
  "define-entity",
  "define-meta-entity",
  "define-relation",
  "define-record",
  "define-link",
  "define-query",
  "define-datalog-query",
  "define-query-preset",
  "define-role",
  "define-group",
  "define-membership",
  "define-contextual-role",
  "define-permission",
  "define-view",
  "define-view-component",
  "define-workspace",
  "define-constraint",
  "define-action",
  "define-mutation",
  "define-process",
  "define-task",
  "define-document",
  "define-document-locale",
  "define-document-localized",
  "define-pdf-mapping",
];

for (const file of listFiles(lib)) {
  const relativeName = file.pathname.slice(lib.pathname.length);
  const text = readFileSync(file, "utf8");
  for (const formName of forbiddenOntologyForms) {
    if (text.includes(formName)) {
      failures.push(
        `${relativeName} hardcodes ontology form '${formName}'. New ontology forms belong in preludes/elaboration, not OCaml engine branches.`,
      );
    }
  }
}

const forbiddenDomainShapeSnippets = [
  "type pdf_mapping",
  "type document_locale",
  "type document_localized",
  "type task_definition",
  "type workspace",
  "type view_component",
  "Pdf_mapping",
  "Document_locale",
  "Document_localized",
  "Task_definition",
  "Workspace of",
  "View_component",
  "Entity of",
  "Query of",
  "Action of",
  "Mutation of",
  "Document of",
];

for (const file of listFiles(lib)) {
  const relativeName = file.pathname.slice(lib.pathname.length);
  const text = readFileSync(file, "utf8");
  for (const snippet of forbiddenDomainShapeSnippets) {
    if (text.includes(snippet)) {
      failures.push(
        `${relativeName} hardcodes ontology declaration shape '${snippet}'. OCaml must keep declarations generic and read artifact data from elaboration.`,
      );
    }
  }
}

expectTextIncludes(new URL("scripts/require-build.mjs", cwd), [
  "dist/native/forma_cli.exe",
  "@formalang/ocaml#build completes first",
]);

expectTextIncludes(new URL("package.json", repoRoot), [
  '"build:js"',
  "turbo run build",
  "--filter=@formalang/ts",
  "--filter=@formalang/host",
  "--filter=@formalang/editor",
  "--filter=@formalang/language-server",
  "--filter=@formalang/website",
  '"test:ocaml"',
]);

expectTextIncludes(new URL("turbo.json", repoRoot), [
  '"dependsOn": ["^build"]',
  '"dependsOn": ["^build", "build"]',
]);

expectSourceIncludes("abi_source_ops.ml", [
  "let typecheck_typed_core type_env eval_env program",
  "let typecheck_core_success_json ?(typed_core = false) program",
  "typecheck_core_result_json ~typed type_env eval_env program",
  "typecheck_core_success_json ~typed_core:typed program",
]);

expectSourceIncludes("descriptor_protocol.ml", [
  "let empty_hooks =",
  "bindings = (fun _ -> Ok []);",
  "typed_slots = (fun _ -> Ok ());",
  "result_type = (fun _ -> Ok None);",
  "infer = (fun _ -> Ok None);",
  "check = (fun _ -> Ok None);",
]);

expectSourceIncludes("descriptor_protocol.mli", ["val empty_hooks : descriptor_hooks"]);

expectSourceIncludes("typecheck.ml", [
  "Type_env.with_pending_reset",
  "Type_env.discharge_and_return env subst (subst, ty)",
  "Type_env.discharge_and_apply env subst ty",
]);

expectSourceExcludes("typecheck.ml", [
  "let rec typecheck_core_program program",
  "let typecheck_core_program program",
  "and typecheck_core_program_with_env env program",
  "let typecheck_core_program_with_env env program",
  "let rec typecheck_program exprs",
  "let typecheck_program exprs",
  "let rec typecheck_core_program_typed program",
  "let typecheck_core_program_typed program",
  "let rec typecheck_core_program_typed_with_env env program",
  "let typecheck_core_program_typed_with_env env program",
  "let with_pending_reset",
  "Type_env.reset_pending_constraints",
  "Type_env.discharge_pending_constraints",
  "let env_bind =",
  "let resolve_type_expr =",
  "type scheme = Type_env.scheme",
  "type env = Type_env.env",
  "type diagnostic = Type_diagnostic.t",
  "let diagnostic_to_json = Type_diagnostic.to_json",
  "let diagnostic = Type_diagnostic.make",
  "let with_span = Type_diagnostic.with_span",
]);

expectSourceExcludes("typecheck.mli", [
  "type scheme = Type_env.scheme",
  "type env = Type_env.env",
  "type diagnostic = Type_diagnostic.t",
  "val diagnostic_to_json :",
  "val typecheck_program :",
  "val typecheck_core_program :",
  "val typecheck_core_program_with_env :",
  "val typecheck_core_program_typed :",
  "val typecheck_core_program_typed_with_env :",
]);

expectSourceIncludes("abi_source_ops.ml", [
  "Typecheck.typecheck_core_program_typed_with_descriptor_infer",
  "Descriptor_protocol.empty_hooks [] program",
  "Descriptor_protocol.empty_hooks type_env program",
]);

expectSourceIncludes("abi_response.ml", ["Type_diagnostic.to_json"]);

expectSourceIncludes("abi_session_ops.ml", ["Type_diagnostic.to_json"]);

expectTextIncludes(new URL("bin/forma_cli.ml", cwd), [
  "module Type_diagnostic = Forma_ocaml.Type_diagnostic",
]);

expectSourceIncludes("session.ml", ["mutable type_env : Type_env.env;"]);

expectSourceIncludes("session.mli", ["mutable type_env : Type_env.env;"]);

expectSourceIncludes("type_env.ml", [
  "let with_pending_reset f =",
  "reset_pending_constraints ();",
  "let discharge_and_return env subst value =",
  "let discharge_and_apply env subst ty =",
]);

expectSourceIncludes("type_env.mli", [
  "val with_pending_reset : (unit -> ('a, 'error) result) -> ('a, 'error) result",
  "val discharge_and_return :",
  "val discharge_and_apply :",
]);

expectSourceExcludes("elaborate.ml", [
  "summary_kind",
  "strip_suffix",
  "declaration_summary kind name",
  "Descriptor.construct_kind env form_name",
  "resolved_result_type_of_declaration",
  "result_type : string option",
  "summary : Artifact_summary_types.declaration_summary option",
  "summary_for",
  "summary = None",
]);

expectSourceExcludes("descriptor_contract.ml", ["~default:value"]);

expectSourceExcludes("descriptor_contract.ml", [
  "explicit_declaration_summary_of_emitted_value",
  "resolved_result_type_of_declaration",
  "summary_result_type",
  "~result_type",
  "result_type:string option",
  "Artifact_summary_types.declaration_summary option",
]);

expectSourceExcludes("eval_meta_builders.ml", [
  "with_summary",
  'Value.equal key (VKeyword ":$summary")',
  'List.assoc_opt (VKeyword ":kind") entries',
  'List.assoc_opt (VKeyword ":name") entries',
]);

expectSourceExcludes("abi_source_ops.ml", [
  "Typecheck.typecheck_core_program program",
  "Typecheck.typecheck_core_program_with_env type_env program",
]);

expectSourceExcludes("abi_emit_ops.ml", [
  "match Artifact.validate_declarations declarations with",
  'phase:"validateArtifact"',
]);

expectSourceIncludes("abi_session_ops.ml", ['"define-payload-contract"']);

const expectConstructDeclarationsCarrySummaries = (path) => {
  const text = readFileSync(path, "utf8");
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index].includes("(construct/declaration")) continue;

    const window = lines.slice(index, Math.min(lines.length, index + 16)).join("\n");
    const summaryCount = [...window.matchAll(/:\$summary\b/g)].length;
    if (summaryCount === 0) {
      failures.push(
        `${path.pathname}:${index + 1} construct/declaration is missing explicit :$summary metadata.`,
      );
    } else if (summaryCount > 1) {
      failures.push(
        `${path.pathname}:${index + 1} construct/declaration has ${summaryCount} explicit :$summary metadata entries.`,
      );
    }
    if (!window.includes(":resultType")) {
      failures.push(
        `${path.pathname}:${index + 1} construct/declaration summary is missing explicit :resultType.`,
      );
    }
  }
};

expectConstructDeclarationsCarrySummaries(new URL("preludes/ontology-compiler.lisp", repoRoot));

expectTextIncludes(new URL("preludes/ontology-compiler.lisp", repoRoot), [
  "(construct/assoc\n      (http/schema-decl input)\n      :$summary",
  '(construct/summary\n        :kind "Schema"\n        :name (meta/declaration-name input)\n        :resultType "SchemaDecl")',
  "(construct/assoc\n      (http/error-decl input)\n      :$summary",
  "(construct/assoc\n      (http/api-group-decl input)\n      :$summary",
  '(construct/summary\n        :kind "HttpApi"\n        :name (meta/declaration-name input)\n        :resultType "HttpApiDecl")',
]);

expectTextIncludes(new URL("preludes/ontology.lisp", repoRoot), [
  "(define-payload-contract KindPayload",
  "(define-payload-contract NamedKindPayload",
  "(define-payload-contract ArrayFieldsPayload",
  "(define-payload-contract ObjectFieldsPayload",
  "(define-payload-contract SourceTargetPayload",
  "(define-payload-contract NamedSourceTargetFieldsPayload",
  "(define-payload-contract SchemaPayload",
  "(define-payload-contract HttpApiPayload",
  "(define-payload-contract IdentityDeclarationPayload",
  "(define-payload-contract RoleIdentityPayload",
  "(define-payload-contract GroupIdentityPayload",
  "(define-payload-contract MembershipIdentityPayload",
  "(define-payload-contract ContextualRoleIdentityPayload",
  "(define-payload-contract FieldSchemaPayload",
  "(define-payload-contract EntityPayload",
  "(define-payload-contract MetaEntityPayload",
  "(define-payload-contract RelationPayload",
  "(define-payload-contract RecordPayload",
  "(define-payload-contract LinkPayload",
  "(define-payload-contract QueryPayload",
  "(define-payload-contract DatalogQueryPayload",
  "(define-payload-contract QueryPresetPayload",
  "(define-payload-contract ViewPayload",
  "(define-payload-contract WorkspacePayload",
  "(define-payload-contract PermissionPayload",
  "(define-payload-contract ConstraintPayload",
  "(define-payload-contract OperationPayload",
  "(define-payload-contract ActionPayload",
  "(define-payload-contract MutationPayload",
  "(define-payload-contract ProcessPayload",
  "(define-payload-contract TaskPayload",
  "(define-payload-contract DocumentPayload",
  "(define-payload-contract DocumentLocalePayload",
  "(define-payload-contract DocumentLocalizedPayload",
  "(define-payload-contract PdfMappingPayload",
  "(:contract KindPayload)",
  "(:contract NamedKindPayload)",
  "(:contract [KindPayload ObjectFieldsPayload])",
  "(:contract [KindPayload SourceTargetPayload ArrayFieldsPayload])",
  "(:contract [NamedKindPayload ArrayFieldsPayload])",
  "(:contract [NamedKindPayload SourceTargetPayload ArrayFieldsPayload])",
  "(:artifact\n      (:validators [http])",
  "(:payload (:contract SchemaPayload))",
  "(:payload (:contract HttpApiPayload))",
  "(:payload (:contract EntityPayload))",
  "(:payload (:contract MetaEntityPayload))",
  "(:payload (:contract RelationPayload))",
  "(:payload (:contract RecordPayload))",
  "(:payload (:contract LinkPayload))",
  "(:contract QueryPayload)",
  "(:payload (:contract DatalogQueryPayload))",
  "(:payload (:contract QueryPresetPayload))",
  "(:contract ViewPayload)",
  "(:payload (:contract WorkspacePayload))",
  "(:payload (:contract PermissionPayload))",
  "(:payload (:contract ConstraintPayload))",
  "(:payload (:contract RoleIdentityPayload))",
  "(:payload (:contract GroupIdentityPayload))",
  "(:payload (:contract MembershipIdentityPayload))",
  "(:payload (:contract ContextualRoleIdentityPayload))",
  "(:payload (:contract ActionPayload))",
  "(:payload (:contract MutationPayload))",
  "(:payload (:contract ProcessPayload))",
  "(:payload (:contract TaskPayload))",
  "(:payload (:contract DocumentPayload))",
  "(:payload (:contract DocumentLocalePayload))",
  "(:payload (:contract DocumentLocalizedPayload))",
  "(:payload (:contract PdfMappingPayload))",
  '(:literal-fields [[kind "Link"]])',
  "(:contract IdentityDeclarationPayload)",
  '(:literal-fields [[kind "Process"]])',
  "(:array-fields [nodes edges])",
  "(:object-fields [trigger])",
]);

{
  const ontology = readFileSync(new URL("preludes/ontology.lisp", repoRoot), "utf8");
  const typedPayloadValidator = readFileSync(
    new URL("lib/artifact_typed_payload_validator.ml", cwd),
    "utf8",
  );
  const artifactHttpValidator = readFileSync(
    new URL("lib/artifact_http_validator.ml", cwd),
    "utf8",
  );
  const emitScript = readFileSync(new URL("scripts/emit.mjs", cwd), "utf8");
  const httpApiScript = readFileSync(new URL("scripts/http-api.mjs", cwd), "utf8");
  const validatorCount = [...ontology.matchAll(/\(:artifact\s+\(:validators\s+\[http\]\)/g)].length;
  const httpPayloadContractCount = [
    ...ontology.matchAll(
      /\(:artifact\s+\(:validators\s+\[http\]\)\s+\(:payload\s+\(:contract\s+(?:SchemaPayload|HttpApiPayload)\)\)/g,
    ),
  ].length;
  const payloadBlocks = payloadContractBlocks(ontology);
  const genericPayloadContractCount = payloadBlocks.length;
  const contractBackedPayloadCount = payloadBlocks.filter(({ block }) =>
    /:contract\b/.test(block),
  ).length;
  const directPayloadFieldBlocks = payloadBlocks.filter(({ block }) =>
    /:(?:required-fields|literal-fields|string-fields|array-fields|object-fields)\b/.test(block),
  );
  if (validatorCount !== 3) {
    failures.push(
      `preludes/ontology.lisp should declare three HTTP artifact validator descriptor contracts, found ${validatorCount}.`,
    );
  }
  if (httpPayloadContractCount !== 3) {
    failures.push(
      `preludes/ontology.lisp should declare three HTTP artifact payload descriptor contracts, found ${httpPayloadContractCount}.`,
    );
  }
  if (genericPayloadContractCount < 28) {
    failures.push(
      `preludes/ontology.lisp should declare descriptor payload contracts for HTTP and corpus-heavy ontology forms, found ${genericPayloadContractCount}.`,
    );
  }
  if (contractBackedPayloadCount !== genericPayloadContractCount) {
    failures.push(
      `preludes/ontology.lisp should route every artifact payload descriptor through a named payload contract; found ${contractBackedPayloadCount}/${genericPayloadContractCount}.`,
    );
  }

  const matrixKinds = new Set(phase3CorpusPayloadMatrix.map((entry) => entry.kind));
  const corpusKinds = new Set(Object.keys(corpusGolden.kindCounts));
  const typedMatrixEntries = phase3CorpusPayloadMatrix.filter((entry) => !entry.httpValidator);
  const typedSourceBlock = typedMalformedPayloadSourcesBlock(emitScript);
  const typedMalformedSourceCount = [...emitScript.matchAll(/label: "malformed [^"]+ payload"/g)]
    .length;
  const typedMalformedCaseCount = [...emitScript.matchAll(/label: "typed [^"]+ payload"/g)].length;
  for (const kind of corpusKinds) {
    if (!matrixKinds.has(kind)) {
      failures.push(`Phase 3 descriptor payload matrix is missing corpus-emitted kind ${kind}.`);
    }
  }
  if (typedMalformedSourceCount !== typedMatrixEntries.length) {
    failures.push(
      `scripts/emit.mjs typed malformed payload source table has ${typedMalformedSourceCount} cases; expected ${typedMatrixEntries.length} non-HTTP Phase 3 matrix entries.`,
    );
  }
  if (typedSourceBlock == null) {
    failures.push("scripts/emit.mjs must keep typedMalformedPayloadSources table-driven.");
  }
  if (typedMalformedCaseCount !== typedMatrixEntries.length) {
    failures.push(
      `scripts/emit.mjs typed malformed payload table has ${typedMalformedCaseCount} cases; expected ${typedMatrixEntries.length} non-HTTP Phase 3 matrix entries.`,
    );
  }

  const typedFixtureOwners = new Map();
  for (const entry of phase3CorpusPayloadMatrix) {
    const count = corpusGolden.kindCounts[entry.kind];
    if (typeof count !== "number" || count <= 0) {
      failures.push(
        `Phase 3 descriptor payload matrix includes ${entry.kind}, but corpus golden has count ${count}.`,
      );
    }
    if (!ontology.includes(`(define-payload-contract ${entry.contract}`)) {
      failures.push(
        `preludes/ontology.lisp is missing descriptor payload contract ${entry.contract} for corpus kind ${entry.kind}.`,
      );
    }
    if (!ontology.includes(`(:contract ${entry.contract})`)) {
      failures.push(
        `preludes/ontology.lisp does not route corpus kind ${entry.kind} through ${entry.contract}.`,
      );
    }

    if (entry.httpValidator) {
      if (!artifactHttpValidator.includes('Artifact_validator.make_spec ~name:"http" ~validate')) {
        failures.push(`${entry.kind} must remain covered by the HTTP artifact validator spec.`);
      }
      if (!artifactHttpValidator.includes("Http_ir_validation.validate_declarations")) {
        failures.push(`${entry.kind} must remain validated through Http_ir_validation.`);
      }
      if (!httpApiScript.includes("http-api ok")) {
        failures.push(
          `${entry.kind} malformed/ref fixture coverage should remain in scripts/http-api.mjs.`,
        );
      }
      continue;
    }

    if (!typedPayloadValidator.includes(`${entry.validatorModule}.validate_declaration`)) {
      failures.push(
        `${entry.kind} must remain covered by ${entry.validatorModule}.validate_declaration.`,
      );
    }
    if (!typedPayloadValidator.includes(entry.diagnosticCode)) {
      failures.push(`${entry.kind} must keep typed payload diagnostic ${entry.diagnosticCode}.`);
    }
    const symbolBase = malformedFixtureSymbolBase(entry.malformedFixture);
    if (typedSourceBlock != null) {
      if (!typedSourceBlock.includes(`sourceId: ${symbolBase}SourceId`)) {
        failures.push(
          `${entry.kind} malformed fixture ${entry.malformedFixture} must be loaded from ${symbolBase}SourceId.`,
        );
      }
      if (!typedSourceBlock.includes(`source: ${symbolBase}Source`)) {
        failures.push(
          `${entry.kind} malformed fixture ${entry.malformedFixture} must load ${symbolBase}Source.`,
        );
      }
    }
    if (!emitScript.includes(entry.malformedFixture)) {
      failures.push(
        `${entry.kind} must keep malformed fixture ${entry.malformedFixture} in scripts/emit.mjs.`,
      );
    }
    if (!emitScript.includes(`form: "(${entry.malformedFixture} `)) {
      failures.push(
        `${entry.kind} malformed fixture ${entry.malformedFixture} must be asserted in typedMalformedPayloadCases.`,
      );
    }
    if (!emitScript.includes(`code: "${entry.diagnosticCode}"`)) {
      failures.push(
        `${entry.kind} typed malformed payload case must assert diagnostic ${entry.diagnosticCode}.`,
      );
    }
    const caseBlock = typedMalformedFixtureCaseBlock(emitScript, entry.malformedFixture);
    if (caseBlock == null) {
      failures.push(
        `${entry.kind} malformed fixture ${entry.malformedFixture} must have a typedMalformedPayloadCases table entry.`,
      );
    } else {
      if (!caseBlock.includes(`sourceId: ${symbolBase}SourceId`)) {
        failures.push(
          `${entry.kind} malformed fixture ${entry.malformedFixture} must assert diagnostics against ${symbolBase}SourceId.`,
        );
      }
      if (!caseBlock.includes(`source: ${symbolBase}Source`)) {
        failures.push(
          `${entry.kind} malformed fixture ${entry.malformedFixture} must assert offsets against ${symbolBase}Source.`,
        );
      }
      if (!caseBlock.includes(`code: "${entry.diagnosticCode}"`)) {
        failures.push(
          `${entry.kind} malformed fixture ${entry.malformedFixture} must assert diagnostic ${entry.diagnosticCode} in its own typedMalformedPayloadCases entry.`,
        );
      }
      if (!caseBlock.includes("messageIncludes: [")) {
        failures.push(
          `${entry.kind} malformed fixture ${entry.malformedFixture} must assert diagnostic message text in typedMalformedPayloadCases.`,
        );
      }
    }
    const fixtureBlock = malformedFixtureSourceBlock(emitScript, entry.malformedFixture);
    if (fixtureBlock == null) {
      failures.push(
        `${entry.kind} malformed fixture ${entry.malformedFixture} must be defined as a source block in scripts/emit.mjs.`,
      );
    } else {
      if (!fixtureBlock.includes(`(:payload (:contract ${entry.contract}))`)) {
        failures.push(
          `${entry.kind} malformed fixture ${entry.malformedFixture} must target ${entry.contract}.`,
        );
      }
      if (!fixtureBlock.includes(`:kind "${entry.kind}"`)) {
        failures.push(
          `${entry.kind} malformed fixture ${entry.malformedFixture} must emit kind ${entry.kind}.`,
        );
      }
    }
    const fixtureOwners = typedFixtureOwners.get(entry.malformedFixture) ?? [];
    fixtureOwners.push(entry.kind);
    typedFixtureOwners.set(entry.malformedFixture, fixtureOwners);
  }

  for (const [fixture, owners] of typedFixtureOwners) {
    if (owners.length > 1) {
      failures.push(
        `Typed malformed fixture ${fixture} is shared by ${owners.join(
          ", ",
        )}; Phase 3 requires branch-specific malformed fixture coverage.`,
      );
    }
    if (occurrences(emitScript, fixture) < 3) {
      failures.push(
        `Typed malformed fixture ${fixture} should be defined, invoked, and asserted in scripts/emit.mjs.`,
      );
    }
  }

  for (const { start, block } of directPayloadFieldBlocks) {
    const line = ontology.slice(0, start).split(/\r?\n/).length;
    failures.push(
      `preludes/ontology.lisp:${line} should not put generic field clauses directly inside artifact :payload; move them to define-payload-contract instead:\n${block}`,
    );
  }
}

const result = {
  ok: failures.length === 0,
  targetMaxLines,
  failures,
};

console.log(JSON.stringify(result, null, 2));

if (failures.length > 0) {
  process.exit(1);
}

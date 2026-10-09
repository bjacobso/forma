/** Canonical domain boundary schemas, mirroring canonical_*_decl.ml. */
import { Result, Schema, SchemaIssue } from "effect";
import type { Diagnostic } from "../diagnostic/diagnostic.js";
import type { ArtifactValidatorRegistry, ValidatorInput } from "./validator-registry.js";
import { validatorDiagnostic } from "./validator-registry.js";

const text = Schema.String;
const nonempty = text.check(Schema.isMinLength(1));
const any = Schema.Unknown;
const value = any.check(Schema.makeFilter((input) => input !== null && input !== undefined));
const object = Schema.Record(text, any);
const optional = <S extends Schema.Top>(schema: S) => Schema.optional(Schema.NullOr(schema));
const loc = { loc: optional(object) };
const typedField = Schema.Struct({ name: nonempty, type: value });
const namedInput = Schema.Struct({ name: nonempty });
const namedRecord = Schema.Record(text, any);
const entity = Schema.Struct({ name: text, fields: Schema.Array(typedField), fieldTypes: optional(Schema.Record(nonempty, value)), doc: optional(text), role: optional(text), idPattern: optional(text), ...loc });
const relation = Schema.Struct({ name: text, source: text, target: text, fields: Schema.Array(typedField) });
const link = Schema.Struct({ relation: text, source: text, target: text, sourceId: optional(text), targetId: optional(text), fields: Schema.Union([namedRecord, Schema.Array(Schema.Struct({ name: nonempty, value: any.check(Schema.makeFilter(input => input !== undefined)) }))]) });
const operation = Schema.Struct({ name: text, doc: optional(text), inputs: Schema.Array(typedField), do: value, ...loc });
const query = Schema.Struct({ name: text, from: optional(text), select: optional(Schema.Array(text)), datalog: optional(object), typeAnnotations: optional(object), ...loc });
const record = Schema.Struct({ id: text, entity: text, fields: namedRecord, ...loc });
const constraint = Schema.Struct({ name: text, doc: optional(text), entity: text, severity: text, message: value, taskAssignments: optional(Schema.Array(Schema.Struct({ role: optional(text), priority: optional(text) }))), resolutions: Schema.Array(Schema.Struct({ label: optional(text), action: optional(text), mutation: optional(text), auto: optional(text) })), ...loc });
const view = Schema.Struct({ name: text, query: optional(text), title: optional(text), columns: Schema.Array(Schema.Struct({ name: nonempty, label: optional(text) })), ...loc });
const workspace = Schema.Struct({ name: text, title: optional(text), views: Schema.Array(nonempty) });
const process = Schema.Struct({ name: text, description: optional(text), trigger: Schema.Struct({ triggerKind: nonempty, entity: optional(text) }), nodes: Schema.Array(Schema.Struct({ id: nonempty, action: optional(text), mutation: optional(text), inputs: optional(Schema.Array(namedInput)) })), edges: Schema.Array(Schema.Struct({ from: nonempty, to: nonempty })), ...loc });
const task = Schema.Struct({ name: text, title: text, description: optional(text), inputs: Schema.Array(Schema.Struct({ name: nonempty, required: optional(Schema.Boolean) })), ...loc });
const contentField = Schema.Struct({ type: nonempty, path: nonempty, options: optional(Schema.Array(object)) });
const document = Schema.Struct({ name: nonempty, description: optional(text), pages: Schema.Array(Schema.Struct({ sectionId: optional(text), assignee: nonempty, fields: optional(Schema.Array(contentField)) })), ...loc });
const localeEntry = (key: string) => Schema.Struct({ [key]: value, label: optional(text), description: optional(text) });
const locale = Schema.Struct({ documentName: nonempty, locale: nonempty, roles: Schema.Array(localeEntry("name")), sections: Schema.Array(localeEntry("name")), fields: Schema.Array(localeEntry("path")), ...loc });
const localized = Schema.Struct({ documentName: nonempty, locales: Schema.Array(nonempty), defaultLocale: optional(text), ...loc });
const mappingCase = Schema.Struct({ when: optional(text), assignments: Schema.Array(Schema.Struct({ pdfField: nonempty, value })).check(Schema.isMinLength(1)) });
const mapping = Schema.Struct({ kind: nonempty, pdfField: optional(text), source: optional(text), transform: optional(text), cases: optional(Schema.Array(mappingCase)) });
const pdf = Schema.Struct({ name: nonempty, templateBlob: nonempty, templateFile: optional(text), templateFilename: optional(text), documentName: optional(text), documentRef: optional(object), mappings: Schema.Array(mapping).check(Schema.isMinLength(1)), ...loc });

export const domainPayloadSchemas = {
  Entity: entity, MetaEntity: entity, Relation: relation, Link: link, Action: operation, Mutation: operation, Query: query, Record: record, Constraint: constraint, View: view, Workspace: workspace, Process: process, TaskDefinition: task, Document: document, DocumentLocale: locale, DocumentLocalized: localized, PdfMapping: pdf,
} as const;
const families = {
  Entity: "entity", MetaEntity: "entity", Relation: "edge", Link: "edge", Action: "operation", Mutation: "operation", Query: "query", Record: "record", Constraint: "rule", View: "surface", Workspace: "surface", Process: "workflow", TaskDefinition: "workflow", Document: "content", DocumentLocale: "content", DocumentLocalized: "content", PdfMapping: "content",
} as const;

export function registerDomainPayloadValidators(registry: ArtifactValidatorRegistry): void {
  for (const [kind, schema] of Object.entries(domainPayloadSchemas)) {
    const code = `artifact/${families[kind as keyof typeof families]}-payload`;
    registry.registerPayload({ kind, validate: (input) => {
      const diagnostics: Diagnostic[] = [];
      const result = Schema.decodeUnknownResult(schema)(input.declaration.payload, { errors: "all" });
      if (Result.isFailure(result)) for (const issue of SchemaIssue.makeFormatterStandardSchemaV1()(result.failure.issue).issues) {
        const path = "$" + (issue.path ?? []).map(key => typeof key === "number" ? `[${key}]` : `.${typeof key === "object" ? String(key.key) : String(key)}`).join("");
        diagnostics.push(validatorDiagnostic(input, code, `${kind} payload ${path}: ${issue.message}`, path));
      }
      const payload = input.declaration.payload;
      if (payload && typeof payload === "object" && !Array.isArray(payload)) {
        const p = payload as Record<string, unknown>;
        if (kind === "Link" && p["fields"] && typeof p["fields"] === "object" && !Array.isArray(p["fields"]) && Object.hasOwn(p["fields"], "")) diagnostics.push(validatorDiagnostic(input, code, "Link field name must not be empty.", "$.fields"));
        if ((kind === "Record" || kind === "Entity" || kind === "MetaEntity") && p[kind === "Record" ? "fields" : "fieldTypes"] && typeof p[kind === "Record" ? "fields" : "fieldTypes"] === "object" && Object.hasOwn(p[kind === "Record" ? "fields" : "fieldTypes"] as object, "")) diagnostics.push(validatorDiagnostic(input, code, "Payload field names must not be empty.", kind === "Record" ? "$.fields" : "$.fieldTypes"));
        if (kind === "Constraint" && !((Object.hasOwn(p, "when") !== Object.hasOwn(p, "query")) && (p["when"] ?? p["query"]) != null)) diagnostics.push(validatorDiagnostic(input, code, "A constraint requires exactly one of when or query.", "$.when"));
        if (kind === "PdfMapping" && Array.isArray(p["mappings"])) validateMappingShapes(input, p["mappings"], diagnostics);
      }
      return diagnostics;
    } });
  }
}

function validateMappingShapes(input: ValidatorInput, mappings: unknown[], diagnostics: Diagnostic[]): void {
  for (const [index, entry] of mappings.entries()) {
    if (!entry || typeof entry !== "object") continue;
    const m = entry as Record<string, unknown>;
    const path = `$.mappings[${index}]`;
    const report = (field: string, message: string) => diagnostics.push(validatorDiagnostic(input, "artifact/content-payload", message, `${path}.${field}`));
    const kind = typeof m["kind"] === "string" ? m["kind"].toLowerCase() : undefined;
    if (kind === "direct" || kind === "computed") {
      if (typeof m["pdfField"] !== "string" || m["pdfField"] === "") report("pdfField", "Content mapping must include a nonempty pdfField string.");
      if (kind === "computed" && m["expr"] == null) report("expr", "Content mapping must include a non-null expr.");
    } else if (kind === "switch") {
      if (!Array.isArray(m["cases"]) || !m["cases"].length) report("cases", "Content mapping switch cases must not be empty.");
    } else if (kind !== undefined) report("kind", "Content mapping kind must be direct, computed, or switch.");
  }
}

/** Shared HTTP typing checks used by standalone generation and artifacts. */
import type { JsonValue, PackageableDeclaration } from "./artifact.js";
import type { Diagnostic } from "../diagnostic/diagnostic.js";
import { checkMechanicsDeclarations } from "../mechanics/check.js";
import { emissionSchema, emissionDatum } from "../descriptor/form-emitter.js";
import { arrayItems, isRecord, isAssignable, typeFromJson, type MField, type MType } from "../mechanics/types.js";
import { validatorDiagnostic, type ValidatorInput } from "./validator-registry.js";

export type HttpDeclaration = PackageableDeclaration & { readonly formName?: string };
export function checkHttpApiDeclarations(projected: readonly HttpDeclaration[], mechanics: readonly PackageableDeclaration[], report: (declaration: HttpDeclaration, code: string, message: string, operation?: string) => void): void {
  const info = checkMechanicsDeclarations(mechanics).info;
  const type = (value: JsonValue): MType =>
    typeFromJson(schemaProjection(value), info.env);
  const apis = projected.filter((d) => d.formName === "api");
  const groupHandlers = new Set<string>();
  for (const declaration of projected) {
    const payload = declaration.payload;
    if (!isRecord(payload)) continue;
    if (declaration.formName === "api") {
      const groups = new Set<string>();
      for (const group of arrayItems(payload["groups"]).filter(isRecord)) {
        const groupName = String(group["name"]);
        if (groups.has(groupName))
          report(
            declaration,
            "duplicate-group",
            `Duplicate group ${groupName}.`,
          );
        groups.add(groupName);
        const endpoints = new Set<string>();
        for (const endpoint of arrayItems(group["endpoints"]).filter(
          isRecord,
        )) {
          const endpointName = String(endpoint["name"]);
          if (endpoints.has(endpointName))
            report(
              declaration,
              "duplicate-endpoint",
              `Duplicate endpoint ${groupName}.${endpointName}.`,
            );
          endpoints.add(endpointName);
          for (const error of arrayItems(endpoint["errors"]))
            if (errorName(error) !== "InternalError" && !info.env.errors.has(errorName(error) ?? ""))
              report(
                declaration,
                "error-schema",
                `Endpoint ${endpointName} refers to undeclared error ${String(error)}.`,
              );
          if (
            ["get", "delete"].includes(String(endpoint["method"]).toLowerCase()) &&
            endpoint["payload"] != null
          )
            report(
              declaration,
              "payload-method",
              `Endpoint ${endpointName}: payload schemas require a body method (post, put, or patch).`,
            );
          if (
            typeof endpoint["path"] !== "string" ||
            !endpoint["path"].startsWith("/")
          )
            report(
              declaration,
              "path",
              `Endpoint ${endpointName} needs an absolute HTTP path.`,
            );
        }
      }
    }
    if (declaration.formName !== "handle") continue;
    const key = `${String(payload["api"])}.${String(payload["group"])}`;
    if (groupHandlers.has(key))
      report(
        declaration,
        "duplicate-handle",
        `Group ${key} already has a handle declaration.`,
      );
    groupHandlers.add(key);
    const api = apis.find(
      (d) => isRecord(d.payload) && d.payload["name"] === payload["api"],
    );
    const group = isRecord(api?.payload)
      ? arrayItems(api.payload["groups"])
          .filter(isRecord)
          .find((g) => g["name"] === payload["group"])
      : undefined;
    if (!group) {
      report(declaration, "unknown-group", `Unknown HTTP group ${key}.`);
      continue;
    }
    const handled = new Set<string>();
    for (const handler of arrayItems(payload["handlers"]).filter(isRecord)) {
      const endpointName = String(handler["endpoint"]),
        operation = String(handler["operation"]);
      if (handled.has(endpointName))
        report(
          declaration,
          "duplicate-handler",
          `Endpoint ${key}.${endpointName} is handled twice.`,
          operation,
        );
      handled.add(endpointName);
      const endpoint = arrayItems(group["endpoints"])
        .filter(isRecord)
        .find((e) => e["name"] === endpointName);
      const signature = info.operations.get(operation);
      if (!endpoint) {
        report(
          declaration,
          "unknown-endpoint",
          `Unknown endpoint ${key}.${endpointName}.`,
          operation,
        );
        continue;
      }
      if (!signature) {
        report(
          declaration,
          "unknown-operation",
          `Unknown Effect operation ${operation}.`,
          operation,
        );
        continue;
      }
      const allowed = new Set(arrayItems(endpoint["errors"]).map(errorName));
      for (const error of signature.result.errors.keys())
        if (!allowed.has(error))
          report(
            declaration,
            "undeclared-error",
            `Handler ${operation} can fail with ${error}, but endpoint ${endpointName} does not declare it.`,
            operation,
          );
      if (
        endpoint["success"] !== undefined &&
        !isAssignable(
          signature.result.success,
          type(endpoint["success"]),
          info.env,
        )
      )
        report(
          declaration,
          "handler-success",
          `Handler ${operation} does not return the success type of endpoint ${endpointName}.`,
          operation,
        );
      const fields: MField[] = [];
      for (const field of ["params", "payload"] as const)
        if (endpoint[field] != null)
          fields.push({
            name: field,
            type: type(endpoint[field]),
            optional: false,
          });
      const request: MType = { kind: "struct", fields };
      if (
        signature.params.length !== 1 ||
        !isAssignable(request, signature.params[0]!.type, info.env)
      )
        report(
          declaration,
          "handler-request",
          `Handler ${operation} must accept one request matching endpoint ${endpointName}.`,
          operation,
        );
    }
    for (const endpoint of arrayItems(group["endpoints"]).filter(isRecord))
      if (!handled.has(String(endpoint["name"])))
        report(
          declaration,
          "missing-handler",
          `Endpoint ${key}.${String(endpoint["name"])} has no handler.`,
        );
  }
}

export function validateHttpArtifacts(inputs: readonly ValidatorInput[], all: readonly PackageableDeclaration[]): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const schemas = new Set<string>(["InternalError"]), errors = new Set<string>(["InternalError"]);
  for (const d of all) if (isRecord(d.payload) && typeof d.payload["name"] === "string") {
    if (["Schema", "SchemaDef", "ErrorDef", "ClassDef"].includes(String(d.payload["kind"]))) schemas.add(d.payload["name"]);
    if (d.payload["kind"] === "ErrorDef" || d.payload["schemaKind"] === "Error") errors.add(d.payload["name"]);
  }
  const references = (input: ValidatorInput, node: JsonValue | undefined, path: string, declared: Set<string>, code: string): void => {
    if (Array.isArray(node)) { for (const [i, child] of node.entries()) references(input, child, `${path}[${i}]`, declared, code); }
    else if (isRecord(node)) {
      if (node["kind"] === "Ref") {
        const target = node["name"] ?? node["target"];
        if (typeof target === "string" && !declared.has(target)) diagnostics.push(validatorDiagnostic(input, code, `Unknown schema reference ${JSON.stringify(target)}.`, path));
      }
      for (const [field, child] of Object.entries(node)) if (!["kind", "name", "target", "span", "annotations"].includes(field) && !(node["kind"] === "Literal" && ["value", "values"].includes(field))) references(input, child, `${path}.${field}`, declared, code);
    }
  };
  for (const input of inputs) {
    const p = input.declaration.payload;
    if (!isRecord(p) || !["Schema", "SchemaDef", "ErrorDef", "ClassDef", "HttpApi", "HttpHandle"].includes(String(p["kind"]))) {
      diagnostics.push(validatorDiagnostic(input, "http/invalid-declaration", "HTTP artifact validator received a declaration that is not a schema or HTTP API payload."));
      continue;
    }
    const reportShape = (path: string, message: string) => diagnostics.push(validatorDiagnostic(input, "http/invalid-declaration", message, path));
    const schemaRefs = (value: JsonValue | undefined, path: string, declared: Set<string>, code: string) => {
      try {
        const schema = value == null ? undefined : schemaProjection(value);
        if (!isSchemaNode(schema)) reportShape(path, "HTTP schema must be a valid schema node.");
        else references(input, schema, path, declared, code);
      } catch { reportShape(path, "HTTP schema must be a valid schema node."); }
    };
    if (typeof p["name"] !== "string" && p["kind"] !== "HttpHandle") reportShape("$.name", "HTTP declaration must include a textual name.");
    if (["Schema", "SchemaDef", "ErrorDef", "ClassDef"].includes(String(p["kind"]))) schemaRefs(p["schema"], "$.schema", schemas, "http/unknown-schema-ref");
    if (p["kind"] === "HttpApi" && !Array.isArray(p["groups"]) && !Array.isArray(p["endpoints"])) reportShape("$.groups", "HTTP API must include groups or endpoints.");
    for (const [g, group] of apiGroups(p).entries()) {
      const groupPath = `$.groups[${g}]`;
      if (!isRecord(group) || typeof group["name"] !== "string" || !Array.isArray(group["endpoints"])) { reportShape(groupPath, "HTTP groups require a name and endpoint array."); continue; }
      if (Array.isArray(group["pathParams"])) {
        for (const [i, field] of group["pathParams"].entries()) {
          if (!isRecord(field) || typeof field["name"] !== "string") reportShape(`${groupPath}.pathParams[${i}]`, "HTTP path parameters require a name and schema.");
          else schemaRefs(field["schema"], `${groupPath}.pathParams[${i}].schema`, schemas, "http/unknown-schema-ref");
        }
      } else if (group["pathParams"] != null) schemaRefs(group["pathParams"], `${groupPath}.pathParams`, schemas, "http/unknown-schema-ref");
      for (const [e, endpoint] of group["endpoints"].entries()) {
        const base = `${groupPath}.endpoints[${e}]`;
        if (!isRecord(endpoint)) { reportShape(base, "HTTP endpoint must be an object."); continue; }
        for (const field of ["name", "method", "path"]) if (typeof endpoint[field] !== "string") reportShape(`${base}.${field}`, `HTTP endpoint ${field} must be a string.`);
        for (const field of ["params", "payload", "query", "headers", "success"]) if (endpoint[field] != null || field === "success") schemaRefs(endpoint[field], `${base}.${field}`, schemas, "http/unknown-schema-ref");
        if (endpoint["errors"] === undefined || endpoint["errors"] === null) continue;
        if (!Array.isArray(endpoint["errors"])) { reportShape(`${base}.errors`, "HTTP errors must be an array."); continue; }
        for (const [i, error] of endpoint["errors"].entries()) schemaRefs(error, `${base}.errors[${i}]`, errors, "http/undeclared-error");
      }
    }
  }
  const projected = all.map(d => ({ ...d, payload: isRecord(d.payload) && d.payload["kind"] === "HttpApi" ? { ...d.payload, groups: apiGroups(d.payload) } : d.payload, formName: (d as HttpDeclaration).formName ?? (d.summary.kind === "HttpApi" ? "api" : d.summary.kind === "HttpHandle" ? "handle" : "") }));
  if (diagnostics.some(d => d.code === "http/invalid-declaration")) return diagnostics;
  checkHttpApiDeclarations(projected, all.filter(d => /Def$/.test(d.summary.kind)), (d, code, message) => {
    const index = all.findIndex(candidate => candidate.sourceId === d.sourceId && candidate.formIndex === d.formIndex);
    diagnostics.push(validatorDiagnostic({ declaration: d, index }, `http-api/${code}`, message));
  });
  return diagnostics;
}

function apiGroups(payload: Record<string, JsonValue>): readonly JsonValue[] {
  if (Array.isArray(payload["groups"])) return payload["groups"];
  if (Array.isArray(payload["endpoints"])) return [{ name: payload["name"] ?? "default", pathParams: payload["pathParams"] ?? {}, endpoints: payload["endpoints"] }];
  return [];
}
function schemaProjection(value: JsonValue): JsonValue {
  return isRecord(value) && typeof value["kind"] === "string" ? value : emissionSchema(emissionDatum(value));
}
function errorName(value: JsonValue): string | undefined {
  if (typeof value === "string") return value;
  if (isRecord(value)) { const name = value["name"] ?? value["target"]; return typeof name === "string" ? name : undefined; }
  return undefined;
}

function isSchemaNode(value: JsonValue | undefined): boolean {
  if (!isRecord(value)) return false;
  switch (value["kind"]) {
    case "Ref": return typeof (value["name"] ?? value["target"]) === "string";
    case "Primitive": return typeof (value["name"] ?? value["prim"]) === "string";
    case "Literal": return "value" in value || Array.isArray(value["values"]);
    case "Array": case "Optional": return isSchemaNode(value["item"]);
    case "Map": return isSchemaNode(value["value"]);
    case "Brand": case "Annotated": return isSchemaNode(value["schema"]);
    case "Struct": return Array.isArray(value["fields"]) && value["fields"].every(f => isRecord(f) && typeof f["name"] === "string" && isSchemaNode(f["schema"]));
    case "Union": return Array.isArray(value["variants"]) && value["variants"].every(isSchemaNode);
    case "Tuple": return Array.isArray(value["items"]) && value["items"].every(isSchemaNode);
    default: return false;
  }
}

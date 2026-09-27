import type { JsonValue, PackageableDeclaration } from "../artifact/artifact.js";

export interface MechanicsEffectTypeScriptModule {
  readonly code: string;
  readonly operationNames: readonly string[];
}

interface EffectDefPayload {
  readonly kind: "EffectDef";
  readonly name: string;
  readonly params: readonly JsonValue[];
  readonly effect: JsonValue;
  readonly body: JsonValue;
}

interface ServiceDefPayload {
  readonly kind: "ServiceDef";
  readonly name: string;
  readonly methods: readonly JsonValue[];
}

interface SchemaDefPayload {
  readonly kind: "SchemaDef";
  readonly name: string;
  readonly schema: JsonValue;
}

interface ErrorDefPayload {
  readonly kind: "ErrorDef";
  readonly name: string;
  readonly schema: JsonValue;
}

interface BrandDef {
  readonly name: string;
  readonly base: JsonValue | undefined;
}

export function generateMechanicsEffectTypeScriptModule(
  declarations: readonly PackageableDeclaration[],
): MechanicsEffectTypeScriptModule {
  const schemas = declarations
    .map((declaration) => schemaPayload(declaration.payload))
    .filter((payload): payload is SchemaDefPayload => payload !== undefined);
  const errors = declarations
    .map((declaration) => errorPayload(declaration.payload))
    .filter((payload): payload is ErrorDefPayload => payload !== undefined);
  const services = declarations
    .map((declaration) => servicePayload(declaration.payload))
    .filter((payload): payload is ServiceDefPayload => payload !== undefined);
  const effects = declarations
    .map((declaration) => effectPayload(declaration.payload))
    .filter((payload): payload is EffectDefPayload => payload !== undefined);

  const lines = ['import { Context, Effect } from "effect";', ""];
  const brands = uniqueBrands([...schemas.map((schema) => schema.schema), ...errors.map((error) => error.schema)]);
  if (brands.length > 0) {
    lines.push('type Brand<Name extends string, Type> = Type & { readonly "__brand": Name };');
    for (const brand of brands) {
      lines.push(`export type ${typeName(brand.name)} = Brand<${JSON.stringify(brand.name)}, ${typeExprTs(brand.base)}>;`);
    }
    lines.push("");
  }

  for (const schema of schemas) {
    lines.push(...schemaTypeLines(schema.name, schema.schema, "type"));
    lines.push("");
  }

  for (const error of errors) {
    lines.push(...schemaTypeLines(error.name, error.schema, "error"));
    lines.push("");
  }

  for (const service of services) {
    lines.push(...serviceClassLines(service));
    lines.push("");
  }

  for (const effect of effects) {
    lines.push(...operationLines(effect));
    lines.push("");
  }

  return {
    code: lines.join("\n").trimEnd() + "\n",
    operationNames: effects.map((effect) => effect.name),
  };
}

function schemaPayload(payload: PackageableDeclaration["payload"]): SchemaDefPayload | undefined {
  if (!isRecord(payload) || payload["kind"] !== "SchemaDef") return undefined;
  const name = payload["name"];
  const schema = payload["schema"];
  if (typeof name !== "string" || schema === undefined) return undefined;
  return { kind: "SchemaDef", name, schema };
}

function errorPayload(payload: PackageableDeclaration["payload"]): ErrorDefPayload | undefined {
  if (!isRecord(payload) || payload["kind"] !== "ErrorDef") return undefined;
  const name = payload["name"];
  const schema = payload["schema"];
  if (typeof name !== "string" || schema === undefined) return undefined;
  return { kind: "ErrorDef", name, schema };
}

function servicePayload(payload: PackageableDeclaration["payload"]): ServiceDefPayload | undefined {
  if (!isRecord(payload) || payload["kind"] !== "ServiceDef") return undefined;
  const name = payload["name"];
  const methods = payload["methods"];
  if (typeof name !== "string" || !Array.isArray(methods)) return undefined;
  return { kind: "ServiceDef", name, methods };
}

function effectPayload(payload: PackageableDeclaration["payload"]): EffectDefPayload | undefined {
  if (!isRecord(payload) || payload["kind"] !== "EffectDef") return undefined;
  const name = payload["name"];
  const params = payload["params"];
  const effect = payload["effect"];
  const body = payload["body"];
  if (typeof name !== "string" || !Array.isArray(params) || effect === undefined || body === undefined) {
    return undefined;
  }
  return { kind: "EffectDef", name, params, effect, body };
}

function schemaTypeLines(name: string, schema: JsonValue, kind: "type" | "error"): readonly string[] {
  const type = typeName(name);
  if (!isRecord(schema) || schema["kind"] !== "Struct") {
    return [`export type ${type} = ${typeExprTs(schema)};`];
  }
  const lines = [`export interface ${type} {`];
  if (kind === "error") {
    lines.push(`  readonly _tag?: ${JSON.stringify(type)};`);
  }
  for (const field of arrayItems(schema["fields"])) {
    const fieldLine = structFieldLine(field);
    if (fieldLine) lines.push(fieldLine);
  }
  lines.push("}");
  return lines;
}

function structFieldLine(field: JsonValue): string | null {
  if (!isRecord(field) || typeof field["name"] !== "string") return null;
  const schema = field["schema"];
  const optional = isRecord(schema) && schema["kind"] === "Optional";
  const type = optional && isRecord(schema) ? typeExprTs(schema["item"]) : typeExprTs(schema);
  return `  readonly ${safePropertyName(field["name"])}${optional ? "?" : ""}: ${type};`;
}

function serviceClassLines(service: ServiceDefPayload): readonly string[] {
  const serviceName = typeName(service.name);
  const lines = [
    `export class ${serviceName} extends Context.Service<`,
    `  ${serviceName},`,
    "  {",
  ];
  for (const method of service.methods) {
    if (!isRecord(method) || typeof method["name"] !== "string") continue;
    const params = arrayItems(method["params"]).map(methodParamTs).join(", ");
    lines.push(
      `    readonly ${safePropertyName(method["name"])}: (${params}) => ${effectTypeTs(method["effect"], { includeRequirements: false })};`,
    );
  }
  lines.push("  }", `>()(${JSON.stringify(service.name)}) {}`);
  return lines;
}

function methodParamTs(param: JsonValue): string {
  if (!isRecord(param) || typeof param["name"] !== "string") return "value: unknown";
  return `${safeIdentifier(param["name"])}: ${typeExprTs(param["type"])}`;
}

function operationLines(effect: EffectDefPayload): readonly string[] {
  const params = effect.params.map(methodParamTs).join(", ");
  const returnType = effectTypeTs(effect.effect, { includeRequirements: true });
  const lines = [`export const ${safeIdentifier(effect.name)} = (${params}): ${returnType} =>`, "  Effect.gen(function* () {"];

  const services = Array.from(collectServiceCalls(effect.body)).sort();
  for (const service of services) {
    lines.push(`    const ${serviceVar(service)} = yield* ${typeName(service)};`);
  }

  lines.push(...effectBodyLines(effect.body, "    "));
  lines.push("  });");
  return lines;
}

function effectBodyLines(body: JsonValue | undefined, indent: string): readonly string[] {
  if (!isRecord(body)) return [`${indent}return undefined as never;`];

  switch (body["kind"]) {
    case "Do": {
      const lines: string[] = [];
      for (const binding of arrayItems(body["bindings"])) {
        if (!isRecord(binding) || typeof binding["name"] !== "string") continue;
        lines.push(`${indent}const ${safeIdentifier(binding["name"])} = ${yieldableExpr(binding["value"])};`);
      }
      lines.push(...returnLines(body["body"], indent));
      return lines;
    }
    default:
      return returnLines(body, indent);
  }
}

function returnLines(expr: JsonValue | undefined, indent: string): readonly string[] {
  if (!isRecord(expr)) return [`${indent}return undefined as never;`];
  switch (expr["kind"]) {
    case "Succeed":
      return [`${indent}return ${valueExprTs(expr["value"])};`];
    case "Pure":
      return [`${indent}return ${valueExprTs(expr["value"])};`];
    case "Fail":
      return [`${indent}return yield* Effect.fail(${errorExprTs(expr["error"])});`];
    default:
      return [`${indent}return ${yieldableExpr(expr)};`];
  }
}

function yieldableExpr(expr: JsonValue | undefined): string {
  if (!isRecord(expr)) return "undefined as never";
  switch (expr["kind"]) {
    case "ServiceCall":
      return `yield* ${serviceVar(String(expr["service"] ?? "service"))}.${safePropertyName(String(expr["method"] ?? "method"))}(${arrayItems(expr["args"]).map(valueExprTs).join(", ")})`;
    case "OperationCall":
      return `yield* ${safeIdentifier(String(expr["operation"] ?? "operation"))}(${arrayItems(expr["args"]).map(valueExprTs).join(", ")})`;
    case "Succeed":
      return `yield* Effect.succeed(${valueExprTs(expr["value"])})`;
    case "Fail":
      return `yield* Effect.fail(${errorExprTs(expr["error"])})`;
    case "Pure":
      return valueExprTs(expr["value"]);
    default:
      return "undefined as never";
  }
}

function valueExprTs(expr: JsonValue | undefined): string {
  if (!isRecord(expr)) return JSON.stringify(expr) ?? "undefined";
  switch (expr["kind"]) {
    case "Var":
      return safeIdentifier(String(expr["name"] ?? "value"));
    case "Literal":
      return JSON.stringify(expr["value"]) ?? "undefined";
    case "Record":
      return `{ ${arrayItems(expr["entries"]).map(recordEntryTs).join(", ")} }`;
    case "Vector":
    case "List":
      return `[${arrayItems(expr["items"]).map(valueExprTs).join(", ")}]`;
    case "Expr":
      return "undefined";
    default:
      return "undefined";
  }
}

function recordEntryTs(entry: JsonValue | undefined): string {
  if (!isRecord(entry)) return "";
  const key = recordKeyTs(entry["key"]);
  return `${key}: ${valueExprTs(entry["value"])}`;
}

function recordKeyTs(key: JsonValue | undefined): string {
  if (!isRecord(key)) return String(key);
  if (key["kind"] === "Literal") return safePropertyName(String(key["value"]));
  if (key["kind"] === "Var") return safePropertyName(String(key["name"]));
  return "unknown";
}

function errorExprTs(error: JsonValue | undefined): string {
  if (typeof error === "string") return `{ _tag: ${JSON.stringify(error)} }`;
  return valueExprTs(error ?? null);
}

function collectServiceCalls(
  expr: JsonValue | undefined,
  services = new Set<string>(),
): ReadonlySet<string> {
  if (Array.isArray(expr)) {
    for (const item of expr) collectServiceCalls(item, services);
    return services;
  }
  if (!isRecord(expr)) return services;
  if (expr["kind"] === "ServiceCall" && typeof expr["service"] === "string") {
    services.add(expr["service"]);
  }
  for (const value of Object.values(expr)) collectServiceCalls(value, services);
  return services;
}

function effectTypeTs(effect: JsonValue | undefined, options: { readonly includeRequirements: boolean }): string {
  if (!isRecord(effect) || effect["kind"] !== "Effect") return "Effect.Effect<unknown>";
  const success = typeExprTs(effect["success"]);
  const errors = symbolUnion(effect["errors"], "never");
  if (!options.includeRequirements) return `Effect.Effect<${success}, ${errors}>`;
  return `Effect.Effect<${success}, ${errors}, ${serviceRequirements(effect["requirements"])}>`;
}

function typeExprTs(type: JsonValue | undefined): string {
  if (!isRecord(type)) return "unknown";
  switch (type["kind"]) {
    case "Primitive":
      return primitiveTs(type["name"]);
    case "Ref":
      return typeName(String(type["name"] ?? "Unknown"));
    case "Brand":
      return typeName(String(type["name"] ?? "Brand"));
    case "Struct":
      return `{ ${arrayItems(type["fields"]).map(structInlineFieldTs).join("; ")} }`;
    case "Array":
      return `ReadonlyArray<${typeExprTs(type["item"])}>`;
    case "Optional":
      return `${typeExprTs(type["item"])} | undefined`;
    case "Map":
      return `Readonly<Record<string, ${typeExprTs(type["value"])}>>`;
    case "Literal":
      return literalUnion(type["values"]);
    case "Tuple":
      return `readonly [${arrayItems(type["items"]).map(typeExprTs).join(", ")}]`;
    case "Union":
      return arrayItems(type["variants"]).map(typeExprTs).join(" | ") || "never";
    case "Effect":
      return effectTypeTs(type, { includeRequirements: true });
    default:
      return "unknown";
  }
}

function structInlineFieldTs(field: JsonValue): string {
  if (!isRecord(field) || typeof field["name"] !== "string") return "";
  const schema = field["schema"];
  const optional = isRecord(schema) && schema["kind"] === "Optional";
  const type = optional && isRecord(schema) ? typeExprTs(schema["item"]) : typeExprTs(schema);
  return `readonly ${safePropertyName(field["name"])}${optional ? "?" : ""}: ${type}`;
}

function literalUnion(values: JsonValue | undefined): string {
  const literals = arrayItems(values).map((value) => JSON.stringify(value));
  return literals.length === 0 ? "never" : literals.join(" | ");
}

function primitiveTs(name: JsonValue | undefined): string {
  switch (name) {
    case "String":
      return "string";
    case "Int":
    case "Float":
    case "Number":
      return "number";
    case "Bool":
      return "boolean";
    case "Unit":
      return "void";
    default:
      return "unknown";
  }
}

function symbolUnion(value: JsonValue | undefined, empty: string): string {
  const items = arrayItems(value).filter((item): item is string => typeof item === "string");
  return items.length === 0 ? empty : items.map(typeName).join(" | ");
}

function serviceRequirements(value: JsonValue | undefined): string {
  const capabilities = arrayItems(value).filter((item): item is string => typeof item === "string");
  const services = [...new Set(capabilities.map((capability) => typeName(capability.split(".")[0] ?? capability)))];
  return services.length === 0 ? "never" : services.join(" | ");
}

function uniqueBrands(schemas: readonly JsonValue[]): readonly BrandDef[] {
  const brands = new Map<string, BrandDef>();
  for (const schema of schemas) {
    collectBrands(schema, brands);
  }
  return [...brands.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function collectBrands(schema: JsonValue | undefined, brands: Map<string, BrandDef>): void {
  if (Array.isArray(schema)) {
    for (const item of schema) collectBrands(item, brands);
    return;
  }
  if (!isRecord(schema)) return;
  if (schema["kind"] === "Brand" && typeof schema["name"] === "string") {
    brands.set(schema["name"], { name: schema["name"], base: schema["schema"] });
  }
  for (const value of Object.values(schema)) collectBrands(value, brands);
}

function arrayItems(value: JsonValue | undefined): readonly JsonValue[] {
  return Array.isArray(value) ? value : [];
}

function safeIdentifier(name: string): string {
  const normalized = name.replace(/[^A-Za-z0-9_$]/g, "_");
  if (/^[A-Za-z_$][\w$]*$/.test(normalized)) return normalized;
  return `_${normalized}`;
}

function safePropertyName(name: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(name) ? name : JSON.stringify(name);
}

function serviceVar(name: string): string {
  const identifier = safeIdentifier(typeName(name));
  return `${identifier.charAt(0).toLowerCase()}${identifier.slice(1)}`;
}

function typeName(name: string): string {
  const normalized = name
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join("");
  return /^[A-Za-z]/.test(normalized) ? normalized : `Generated${normalized}`;
}

function isRecord(value: unknown): value is Readonly<Record<string, JsonValue>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

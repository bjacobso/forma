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
  if (effects.some((effect) => usesTruthiness(effect.body))) {
    lines.push("const formaTruthy = (value: unknown): boolean => value !== null && value !== false && value !== undefined;", "");
  }
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
    lines.push(`  readonly _tag: ${JSON.stringify(type)};`);
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
  if (!isRecord(body)) throw new Error("Effect TypeScript: expected an effect body node");

  switch (body["kind"]) {
    case "Succeed":
    case "Pure":
      return [`${indent}return ${valueExprTs(body["value"])};`];
    case "Fail":
      return [`${indent}return yield* Effect.fail(${errorExprTs(body["error"])});`];
    case "ServiceCall":
      return [`${indent}return yield* ${serviceVar(requiredString(body, "service"))}.${safePropertyName(requiredString(body, "method"))}(${arrayItems(body["args"]).map(valueExprTs).join(", ")});`];
    case "OperationCall":
      return [`${indent}return yield* ${safeIdentifier(requiredString(body, "operation"))}(${arrayItems(body["args"]).map(valueExprTs).join(", ")});`];
    case "Do": {
      const lines: string[] = [];
      for (const binding of arrayItems(body["bindings"])) {
        if (!isRecord(binding)) throw new Error("Effect TypeScript: invalid Do binding");
        const name = requiredString(binding, "name");
        const value = `yield* ${effectExprTs(binding["value"], indent)}`;
        lines.push(name === "_" ? `${indent}${value};` : `${indent}const ${safeIdentifier(name)} = ${value};`);
      }
      if (body["body"] !== undefined) {
        lines.push(...effectBodyLines(body["body"], indent));
      } else {
        const forms = arrayItems(body["forms"]);
        for (const form of forms.slice(0, -1)) {
          lines.push(`${indent}yield* ${effectExprTs(form, indent)};`);
        }
        lines.push(...(forms.length > 0 ? effectBodyLines(forms[forms.length - 1], indent) : [`${indent}return null;`]));
      }
      return lines;
    }
    case "Let": {
      const lines: string[] = [];
      for (const binding of arrayItems(body["bindings"])) {
        if (!isRecord(binding)) throw new Error("Effect TypeScript: invalid Let binding");
        lines.push(`${indent}const ${safeIdentifier(requiredString(binding, "name"))} = yield* ${effectExprTs(binding["value"], indent)};`);
      }
      lines.push(...effectBodyLines(body["body"], indent));
      return lines;
    }
    case "Bind": {
      const value = effectExprTs(body["value"], indent);
      if (body["body"] === undefined) return [`${indent}return yield* ${value};`];
      const name = typeof body["name"] === "string" ? safeIdentifier(body["name"]) : "_bound";
      return [`${indent}const ${name} = yield* ${value};`, ...effectBodyLines(body["body"], indent)];
    }
    case "Catch":
      return [`${indent}return yield* Effect.catchTag(${effectExprTs(body["body"], indent)}, ${JSON.stringify(requiredString(body, "errorType"))}, (${safeIdentifier(requiredString(body, "binding"))}) => ${effectExprTs(body["handler"], indent)});`];
    case "If":
      return [
        `${indent}if (formaTruthy(${valueExprTs(body["condition"])})) {`,
        ...effectBodyLines(body["then"], `${indent}  `),
        `${indent}} else {`,
        ...effectBodyLines(body["else"], `${indent}  `),
        `${indent}}`,
      ];
    case "When":
    case "Unless": {
      const condition = valueExprTs(body["condition"]);
      return [
        `${indent}if (${body["kind"] === "Unless" ? "!" : ""}formaTruthy(${condition})) {`,
        ...effectBodyLines(body["body"], `${indent}  `),
        `${indent}}`,
        `${indent}return null;`,
      ];
    }
    case "Cond": {
      const lines: string[] = [];
      for (const clause of arrayItems(body["clauses"])) {
        if (!isRecord(clause)) throw new Error("Effect TypeScript: invalid Cond clause");
        lines.push(`${indent}if (formaTruthy(${valueExprTs(clause["condition"])})) {`);
        lines.push(...effectBodyLines(clause["body"], `${indent}  `));
        lines.push(`${indent}}`);
      }
      lines.push(`${indent}return null;`);
      return lines;
    }
    default:
      throw new Error(`Effect TypeScript: unsupported effect body kind ${String(body["kind"])}`);
  }
}

function effectExprTs(body: JsonValue | undefined, indent: string): string {
  if (isRecord(body)) {
    switch (body["kind"]) {
      case "ServiceCall":
        return `${serviceVar(requiredString(body, "service"))}.${safePropertyName(requiredString(body, "method"))}(${arrayItems(body["args"]).map(valueExprTs).join(", ")})`;
      case "OperationCall":
        return `${safeIdentifier(requiredString(body, "operation"))}(${arrayItems(body["args"]).map(valueExprTs).join(", ")})`;
      case "Succeed":
      case "Pure":
        return `Effect.succeed(${valueExprTs(body["value"])})`;
      case "Fail":
        return `Effect.fail(${errorExprTs(body["error"])})`;
    }
  }
  const nested = `${indent}  `;
  return `Effect.gen(function* () {\n${effectBodyLines(body, nested).join("\n")}\n${indent}})`;
}

function valueExprTs(expr: JsonValue | undefined): string {
  if (!isRecord(expr)) {
    if (expr === undefined) throw new Error("Effect TypeScript: missing value node");
    return JSON.stringify(expr);
  }
  switch (expr["kind"]) {
    case "Var": {
      const name = requiredString(expr, "name");
      if (name === "nil") return "null";
      if (name === "true" || name === "false") return name;
      return safeIdentifier(name);
    }
    case "Literal":
      if (expr["value"] === undefined) throw new Error("Effect TypeScript: missing literal value");
      return JSON.stringify(expr["value"]);
    case "Record":
      return `{ ${arrayItems(expr["entries"]).map(recordEntryTs).join(", ")} }`;
    case "Vector":
    case "List":
      return `[${arrayItems(expr["items"]).map(valueExprTs).join(", ")}]`;
    case "Error":
      return `({ ...${valueExprTs(expr["payload"])}, _tag: ${JSON.stringify(requiredString(expr, "errorType"))} as const })`;
    case "Expr": {
      const source = expr["source"];
      if (isRecord(source) && source["kind"] === "Symbol") return JSON.stringify(requiredString(source, "name"));
      if (isRecord(source) && (source["kind"] === "String" || source["kind"] === "Number" || source["kind"] === "Bool")) {
        return JSON.stringify(source["value"]);
      }
      throw new Error(`Effect TypeScript: unsupported expression value ${JSON.stringify(source)}`);
    }
    default:
      throw new Error(`Effect TypeScript: unsupported value kind ${String(expr["kind"])}`);
  }
}

function recordEntryTs(entry: JsonValue | undefined): string {
  if (!isRecord(entry)) throw new Error("Effect TypeScript: invalid record entry");
  const key = recordKeyTs(entry["key"]);
  return `${key}: ${valueExprTs(entry["value"])}`;
}

function recordKeyTs(key: JsonValue | undefined): string {
  if (!isRecord(key)) throw new Error("Effect TypeScript: invalid record key");
  if (key["kind"] === "Literal") return safePropertyName(String(key["value"]).replace(/^:/, ""));
  if (key["kind"] === "Var") return `[${valueExprTs(key)}]`;
  if (key["kind"] === "Expr" && isRecord(key["source"]) && key["source"]["kind"] === "Symbol") {
    return safePropertyName(requiredString(key["source"], "name").replace(/^:/, ""));
  }
  throw new Error(`Effect TypeScript: unsupported record key ${JSON.stringify(key)}`);
}

function errorExprTs(error: JsonValue | undefined): string {
  if (typeof error === "string") return `{ _tag: ${JSON.stringify(error)} }`;
  return valueExprTs(error);
}

function requiredString(record: Readonly<Record<string, JsonValue>>, key: string): string {
  const value = record[key];
  if (typeof value !== "string") throw new Error(`Effect TypeScript: expected string ${key}`);
  return value;
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

function usesTruthiness(value: JsonValue): boolean {
  if (Array.isArray(value)) return value.some(usesTruthiness);
  if (!isRecord(value)) return false;
  if (["If", "When", "Unless", "Cond"].includes(String(value["kind"]))) return true;
  return Object.values(value).some(usesTruthiness);
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

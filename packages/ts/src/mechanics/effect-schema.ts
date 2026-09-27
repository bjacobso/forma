import type { JsonValue, PackageableDeclaration } from "../artifact/artifact.js";

export interface MechanicsEffectSchemaModule {
  readonly code: string;
  readonly schemaNames: readonly string[];
}

interface SchemaDefPayload {
  readonly kind: "SchemaDef";
  readonly name: string;
  readonly schema: JsonValue;
}

export function generateMechanicsEffectSchemaModule(
  declarations: readonly PackageableDeclaration[],
): MechanicsEffectSchemaModule {
  const schemas = declarations
    .map((declaration) => schemaPayload(declaration.payload))
    .filter((payload): payload is SchemaDefPayload => payload !== undefined);
  const lines = ['import { Schema } from "effect";', ""];

  for (const payload of schemas) {
    lines.push(`export const ${schemaConst(payload.name)} = ${effectSchemaExpr(payload.schema)};`);
    lines.push(`export type ${typeName(payload.name)} = typeof ${schemaConst(payload.name)}.Type;`);
    lines.push("");
  }

  return {
    code: lines.join("\n").trimEnd() + "\n",
    schemaNames: schemas.map((payload) => schemaConst(payload.name)),
  };
}

function schemaPayload(payload: PackageableDeclaration["payload"]): SchemaDefPayload | undefined {
  if (!isRecord(payload) || payload["kind"] !== "SchemaDef") return undefined;
  const name = payload["name"];
  if (typeof name !== "string" || payload["schema"] === undefined) return undefined;
  return { kind: "SchemaDef", name, schema: payload["schema"] };
}

function effectSchemaExpr(schema: JsonValue | undefined): string {
  if (!isRecord(schema)) return "Schema.Unknown";
  switch (schema["kind"]) {
    case "Primitive":
      return primitiveSchema(schema["name"]);
    case "Struct":
      return `Schema.Struct({ ${fieldEntries(schema["fields"]).join(", ")} })`;
    case "Array":
      return `Schema.Array(${effectSchemaExpr(schema["item"])})`;
    case "Optional":
      return `Schema.optional(${effectSchemaExpr(schema["item"])})`;
    case "Map":
      return `Schema.Record(Schema.String, ${effectSchemaExpr(schema["value"])})`;
    case "Ref":
      return refSchema(schema["name"]);
    case "Brand":
      return `${effectSchemaExpr(schema["schema"])}.pipe(Schema.brand(${JSON.stringify(String(schema["name"] ?? "Brand"))}))`;
    case "Literal":
      return literalSchema(schema["values"]);
    case "Tuple":
      return `Schema.Tuple(${arrayItems(schema["items"]).map(effectSchemaExpr).join(", ")})`;
    case "Union":
      return `Schema.Union(${arrayItems(schema["variants"]).map(effectSchemaExpr).join(", ")})`;
    case "TaggedUnion":
      return taggedUnionSchema(schema);
    case "Annotated":
      return annotatedSchema(schema);
    default:
      return "Schema.Unknown";
  }
}

function fieldEntries(fields: JsonValue | undefined): readonly string[] {
  return arrayItems(fields).flatMap((field) => {
    if (!isRecord(field) || typeof field["name"] !== "string") return [];
    return [`${safeFieldName(field["name"])}: ${effectSchemaExpr(field["schema"])}`];
  });
}

function taggedUnionSchema(schema: Readonly<Record<string, JsonValue>>): string {
  const discriminator = typeof schema["discriminator"] === "string" ? schema["discriminator"] : "tag";
  const variants = arrayItems(schema["variants"]).flatMap((variant) => {
    if (!isRecord(variant) || typeof variant["tag"] !== "string") return [];
    return `Schema.Struct({ ${safeFieldName(discriminator)}: Schema.Literal(${JSON.stringify(variant["tag"])}), ...${effectSchemaExpr(variant["schema"])}.fields })`;
  });
  return variants.length === 0 ? "Schema.Never" : `Schema.Union(${variants.join(", ")})`;
}

function annotatedSchema(schema: Readonly<Record<string, JsonValue>>): string {
  const base = effectSchemaExpr(schema["schema"]);
  const metadata = isRecord(schema["metadata"]) ? schema["metadata"] : {};
  const annotations: string[] = [];
  for (const [key, value] of Object.entries(metadata)) {
    if (key === "doc") annotations.push(`description: ${JSON.stringify(String(value))}`);
    if (key === "identifier") annotations.push(`identifier: ${JSON.stringify(String(value))}`);
    if (key === "pattern") annotations.push(`pattern: ${JSON.stringify(String(value))}`);
  }
  return annotations.length === 0 ? base : `${base}.annotate({ ${annotations.join(", ")} })`;
}

function primitiveSchema(name: JsonValue | undefined): string {
  switch (name) {
    case "String":
      return "Schema.String";
    case "Int":
      return "Schema.Int";
    case "Float":
    case "Number":
      return "Schema.Number";
    case "Bool":
      return "Schema.Boolean";
    case "Unit":
      return "Schema.Void";
    case "Json":
      return "Schema.Json";
    case "Bytes":
      return "Schema.Uint8Array";
    case "DateTime":
      return "Schema.Date";
    default:
      return "Schema.Unknown";
  }
}

function literalSchema(values: JsonValue | undefined): string {
  const literals = arrayItems(values).map((value) => JSON.stringify(value));
  return literals.length === 0 ? "Schema.Never" : `Schema.Literal(${literals.join(", ")})`;
}

function refSchema(name: JsonValue | undefined): string {
  return typeof name === "string" ? schemaConst(name) : "Schema.Unknown";
}

function arrayItems(value: JsonValue | undefined): readonly JsonValue[] {
  return Array.isArray(value) ? value : [];
}

function schemaConst(name: string): string {
  return `${typeName(name)}Schema`;
}

function typeName(name: string): string {
  const normalized = name
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join("");
  return /^[A-Za-z]/.test(normalized) ? normalized : `Schema${normalized}`;
}

function safeFieldName(name: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(name) ? name : JSON.stringify(name);
}

function isRecord(value: unknown): value is Readonly<Record<string, JsonValue>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

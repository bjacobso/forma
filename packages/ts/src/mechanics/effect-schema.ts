import type { JsonValue, PackageableDeclaration } from "../artifact/artifact.js";
import { propertyName, typeName } from "./naming.js";

export interface MechanicsEffectSchemaModule {
  readonly code: string;
  readonly schemaNames: readonly string[];
}

interface SchemaDefPayload {
  readonly kind: "SchemaDef";
  readonly name: string;
  readonly schema: JsonValue;
}

/** How schema declarations are named in the emitting module. */
export interface SchemaNaming {
  /** The runtime schema constant for a declared or hoisted schema. */
  readonly schemaConst: (name: string) => string;
}

export function generateMechanicsEffectSchemaModule(
  declarations: readonly PackageableDeclaration[],
): MechanicsEffectSchemaModule {
  const schemas = declarations
    .map((declaration) => schemaPayload(declaration.payload))
    .filter((payload): payload is SchemaDefPayload => payload !== undefined);
  const naming: SchemaNaming = { schemaConst: (name) => `${typeName(name)}Schema` };
  const declared = new Set(schemas.map((schema) => schema.name));
  const brands = inlineBrands(schemas.map((schema) => schema.schema)).filter((brand) => !declared.has(brand.name));
  const ordered = orderSchemaDeclarations([
    ...brands.map((brand) => ({ name: brand.name, schema: brand.schema as JsonValue })),
    ...schemas,
  ]);
  const lines = ['import { Schema } from "effect";', ""];

  for (const payload of ordered) {
    const constName = naming.schemaConst(payload.name);
    lines.push(`export const ${constName} = ${schemaExpressionTs(payload.schema, naming, true)};`);
    lines.push(`export type ${typeName(payload.name)} = typeof ${constName}.Type;`);
    lines.push("");
  }

  return {
    code: lines.join("\n").trimEnd() + "\n",
    schemaNames: ordered.map((payload) => naming.schemaConst(payload.name)),
  };
}

function schemaPayload(payload: PackageableDeclaration["payload"]): SchemaDefPayload | undefined {
  if (!isRecord(payload) || payload["kind"] !== "SchemaDef") return undefined;
  const name = payload["name"];
  if (typeof name !== "string" || payload["schema"] === undefined) return undefined;
  return { kind: "SchemaDef", name, schema: payload["schema"] };
}

/**
 * Renders a mechanics schema node as an Effect 4 `Schema` expression.
 * `top` is true for the root of a declaration, where an inline brand is the
 * declaration itself rather than a reference to a hoisted brand.
 */
export function schemaExpressionTs(schema: JsonValue | undefined, naming: SchemaNaming, top = false): string {
  if (!isRecord(schema)) return "Schema.Unknown";
  switch (schema["kind"]) {
    case "Primitive":
      return primitiveSchema(schema["name"]);
    case "Struct":
      return structSchema(schema["fields"], naming);
    case "Array":
      return `Schema.Array(${schemaExpressionTs(schema["item"], naming)})`;
    case "Optional":
      return `Schema.optionalKey(${schemaExpressionTs(schema["item"], naming)})`;
    case "Map":
      return `Schema.Record(Schema.String, ${schemaExpressionTs(schema["value"], naming)})`;
    case "Ref":
      return typeof schema["name"] === "string" ? naming.schemaConst(schema["name"]) : "Schema.Unknown";
    case "Brand":
      if (!top && typeof schema["name"] === "string") return naming.schemaConst(schema["name"]);
      return `${schemaExpressionTs(schema["schema"], naming)}.pipe(Schema.brand(${JSON.stringify(String(schema["name"] ?? "Brand"))}))`;
    case "Literal":
      return literalSchema(schema["values"]);
    case "Tuple":
      return `Schema.Tuple([${arrayItems(schema["items"]).map((item) => schemaExpressionTs(item, naming)).join(", ")}])`;
    case "Union":
      return `Schema.Union([${arrayItems(schema["variants"]).map((variant) => schemaExpressionTs(variant, naming)).join(", ")}])`;
    case "TaggedUnion":
      return taggedUnionSchema(schema, naming);
    case "Annotated":
      return annotatedSchema(schema, naming, top);
    default:
      return "Schema.Unknown";
  }
}

function structSchema(fields: JsonValue | undefined, naming: SchemaNaming): string {
  const entries = arrayItems(fields).flatMap((field) => {
    if (!isRecord(field) || typeof field["name"] !== "string") return [];
    return [`${propertyName(field["name"])}: ${schemaExpressionTs(field["schema"], naming)}`];
  });
  return entries.length === 0 ? "Schema.Struct({})" : `Schema.Struct({ ${entries.join(", ")} })`;
}

function taggedUnionSchema(schema: Readonly<Record<string, JsonValue>>, naming: SchemaNaming): string {
  const discriminator = typeof schema["discriminator"] === "string" ? schema["discriminator"] : "tag";
  const variants = arrayItems(schema["variants"]).flatMap((variant) => {
    if (!isRecord(variant) || typeof variant["tag"] !== "string") return [];
    const tag = `${propertyName(discriminator)}: Schema.Literal(${JSON.stringify(variant["tag"])})`;
    const body = variant["schema"];
    if (isRecord(body) && body["kind"] === "Struct") {
      const fields = arrayItems(body["fields"]).flatMap((field) =>
        isRecord(field) && typeof field["name"] === "string" && field["name"] !== discriminator
          ? [`${propertyName(field["name"])}: ${schemaExpressionTs(field["schema"], naming)}`]
          : [],
      );
      return [`Schema.Struct({ ${[tag, ...fields].join(", ")} })`];
    }
    return [`Schema.Struct({ ${tag}, ...${schemaExpressionTs(body, naming)}.fields })`];
  });
  if (variants.length === 0) return "Schema.Never";
  return variants.length === 1 ? variants[0]! : `Schema.Union([${variants.join(", ")}])`;
}

function annotatedSchema(schema: Readonly<Record<string, JsonValue>>, naming: SchemaNaming, top: boolean): string {
  const base = schemaExpressionTs(schema["schema"], naming, top);
  const metadata = isRecord(schema["metadata"]) ? schema["metadata"] : {};
  const annotations: string[] = [];
  let checked = base;
  for (const [key, value] of Object.entries(metadata)) {
    if (key === "doc" || key === "description") annotations.push(`description: ${JSON.stringify(String(value))}`);
    if (key === "title") annotations.push(`title: ${JSON.stringify(String(value))}`);
    if (key === "identifier") annotations.push(`identifier: ${JSON.stringify(String(value))}`);
    if (key === "pattern") checked = `${checked}.check(Schema.isPattern(new RegExp(${JSON.stringify(String(value))})))`;
  }
  return annotations.length === 0 ? checked : `${checked}.annotate({ ${annotations.join(", ")} })`;
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
  if (literals.length === 0) return "Schema.Never";
  return literals.length === 1 ? `Schema.Literal(${literals[0]})` : `Schema.Literals([${literals.join(", ")}])`;
}

export interface InlineBrand {
  readonly name: string;
  readonly schema: JsonValue;
}

/** Brands written inline in a field become their own named schema. */
export function inlineBrands(schemas: readonly JsonValue[]): readonly InlineBrand[] {
  const brands = new Map<string, InlineBrand>();
  const visit = (node: JsonValue | undefined, top: boolean): void => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item, false);
      return;
    }
    if (!isRecord(node)) return;
    if (node["kind"] === "Brand" && typeof node["name"] === "string" && !top && !brands.has(node["name"])) {
      brands.set(node["name"], { name: node["name"], schema: { ...node } });
    }
    for (const [key, value] of Object.entries(node)) {
      if (key !== "span") visit(value, false);
    }
  };
  for (const schema of schemas) visit(schema, true);
  return [...brands.values()];
}

/**
 * Orders declarations so every schema constant is defined before it is
 * referenced, keeping source order otherwise.
 */
export function orderSchemaDeclarations<T extends { readonly name: string; readonly schema: JsonValue }>(
  declarations: readonly T[],
): readonly T[] {
  const byName = new Map(declarations.map((declaration) => [declaration.name, declaration]));
  const ordered: T[] = [];
  const state = new Map<string, "visiting" | "done">();
  const visit = (declaration: T): void => {
    const current = state.get(declaration.name);
    if (current) return;
    state.set(declaration.name, "visiting");
    for (const reference of schemaReferences(declaration.schema)) {
      const target = byName.get(reference);
      if (target && target !== declaration) visit(target);
    }
    state.set(declaration.name, "done");
    ordered.push(declaration);
  };
  for (const declaration of declarations) visit(declaration);
  return ordered;
}

/** Names a schema node refers to (schema references and inline brands). */
export function schemaReferences(node: JsonValue | undefined, top = true): readonly string[] {
  if (Array.isArray(node)) return node.flatMap((item) => schemaReferences(item, false));
  if (!isRecord(node)) return [];
  const names: string[] = [];
  if (node["kind"] === "Ref" && typeof node["name"] === "string") names.push(node["name"]);
  if (node["kind"] === "Brand" && typeof node["name"] === "string" && !top) names.push(node["name"]);
  for (const [key, value] of Object.entries(node)) {
    if (key !== "span") names.push(...schemaReferences(value, false));
  }
  return names;
}

function arrayItems(value: JsonValue | undefined): readonly JsonValue[] {
  return Array.isArray(value) ? value : [];
}

function isRecord(value: unknown): value is Readonly<Record<string, JsonValue>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

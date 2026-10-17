/** The deliberately small JSON Schema projection used by the MCP prototype. */
export type McpJsonSchema = Record<string, unknown>;

const identifier = /^[A-Za-z_][A-Za-z0-9_-]*$/;
export function assertMcpIdentifier(name: string): void {
  if (!identifier.test(name) || ["__proto__", "constructor", "prototype"].includes(name)) {
    throw new Error(`Unsupported Forma identifier in MCP binding: ${JSON.stringify(name)}`);
  }
}

/** Constraints such as minimum/pattern stay in the runtime JSON validator. */
export function mcpSchemaType(schema: McpJsonSchema): string {
  for (const key of ["$ref", "$dynamicRef", "allOf", "oneOf", "not", "if", "then", "else", "prefixItems"]) {
    if (key in schema) throw new Error(`Unsupported MCP schema keyword: ${key}`);
  }
  if (Array.isArray(schema.anyOf)) {
    return `(Union ${schema.anyOf.map((item) => mcpSchemaType(asSchema(item))).join(" ")})`;
  }
  if (Array.isArray(schema.type)) {
    return `(Union ${schema.type.map((type) => mcpSchemaType({ ...schema, type })).join(" ")})`;
  }
  if ("const" in schema) return literal(schema.const);
  if (Array.isArray(schema.enum)) {
    if (!schema.enum.length) throw new Error("An empty MCP enum has no Forma value type");
    return schema.enum.length === 1 ? literal(schema.enum[0]) : `(Union ${schema.enum.map(literal).join(" ")})`;
  }
  switch (schema.type) {
    case "string": return "String";
    case "integer": return "Int";
    case "number": return "Float";
    case "boolean": return "Bool";
    case "null": return "Unit";
    case "array": return `(List ${mcpSchemaType(asSchema(schema.items))})`;
    case "object": {
      const properties = schema.properties === undefined ? {} : asSchema(schema.properties);
      const required = new Set(Array.isArray(schema.required) ? schema.required as string[] : []);
      if ([...required].some((key) => !Object.hasOwn(properties, key))) {
        throw new Error("MCP required fields must have property schemas");
      }
      const fields = Object.entries(properties).map(([key, value]) => {
        assertMcpIdentifier(key);
        const type = mcpSchemaType(asSchema(value));
        return `:${key} ${required.has(key) ? type : `(Option ${type})`}`;
      });
      return `{${fields.join(" ")}}`;
    }
    case undefined:
      if (Object.keys(schema).every((key) => ["description", "title", "$schema", "$id", "default", "examples"].includes(key))) return "Json";
      throw new Error("MCP schema needs a supported explicit type");
    default: throw new Error(`Unsupported MCP schema type: ${String(schema.type)}`);
  }
}

export function asSchema(value: unknown): McpJsonSchema {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected an MCP JSON Schema object");
  }
  return value as McpJsonSchema;
}

function literal(value: unknown): string {
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  throw new Error("Only string, boolean, and numeric MCP enum/const values are supported");
}

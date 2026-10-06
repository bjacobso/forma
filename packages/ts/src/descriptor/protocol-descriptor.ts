import type { DescriptorExtensionValue, FormDescriptor } from "./FormDescriptor.js";

export const PROTOCOL_OBJECT_EXTENSION_KEY = "protocol/object";
export const PROTOCOL_UNION_EXTENSION_KEY = "protocol/union";
export const PROTOCOL_MODULE_EXTENSION_KEY = "protocol/module";
export const PROTOCOL_TYPE_EXTENSION_KEY = "protocol/type";
export const PROTOCOL_ENUM_EXTENSION_KEY = "protocol/enum";
export const PROTOCOL_CATALOG_EXTENSION_KEY = "protocol/catalog";

export type ProtocolPrimitiveType = "string" | "number" | "boolean" | "null" | "unknown";

export type ProtocolScalarLiteral = string | number | boolean | null;

export type ProtocolTypeDescriptor =
  | { readonly kind: ProtocolPrimitiveType }
  | { readonly kind: "literal"; readonly values: readonly ProtocolScalarLiteral[] }
  | { readonly kind: "ref"; readonly ref: string }
  | { readonly kind: "array"; readonly item: ProtocolTypeDescriptor }
  | { readonly kind: "record"; readonly value: ProtocolTypeDescriptor }
  | { readonly kind: "object"; readonly fields: readonly ProtocolObjectFieldDescriptor[] }
  | { readonly kind: "union"; readonly variants: readonly ProtocolTypeDescriptor[] };

export interface ProtocolObjectFieldDescriptor {
  readonly name: string;
  readonly type: ProtocolTypeDescriptor;
  readonly required: boolean;
  readonly aliases: readonly string[];
  readonly doc?: string;
  readonly default?: DescriptorExtensionValue;
}

export interface ProtocolObjectDescriptor {
  readonly kind: "object";
  readonly descriptorName: string;
  readonly name: string;
  readonly schemaName: string;
  readonly fields: readonly ProtocolObjectFieldDescriptor[];
  readonly extensionKey: string;
}

export interface ProtocolUnionMemberDescriptor {
  readonly name: string;
  readonly tag: string;
  readonly type: ProtocolTypeDescriptor;
  readonly doc?: string;
}

export interface ProtocolUnionDescriptor {
  readonly kind: "union";
  readonly descriptorName: string;
  readonly name: string;
  readonly schemaName: string;
  readonly discriminator?: string;
  readonly members: readonly ProtocolUnionMemberDescriptor[];
  readonly extensionKey: string;
}

export interface ProtocolLiteralSchemaDescriptor {
  readonly name: string;
  readonly values: readonly ProtocolScalarLiteral[];
  readonly description?: string;
}

export interface ProtocolTypeAliasDescriptor {
  readonly kind: "type";
  readonly descriptorName: string;
  readonly name: string;
  readonly schemaName: string;
  readonly type: ProtocolTypeDescriptor;
  readonly description?: string;
  readonly extensionKey: string;
}

export interface ProtocolEnumDescriptor {
  readonly kind: "enum";
  readonly descriptorName: string;
  readonly name: string;
  readonly schemaName: string;
  readonly values: readonly ProtocolScalarLiteral[];
  readonly description?: string;
  readonly extensionKey: string;
}

export interface ProtocolModuleImportDescriptor {
  readonly name: string;
  readonly from: string;
  readonly schemaName?: string;
  readonly typeOnly: boolean;
}

export interface ProtocolModuleDescriptor {
  readonly kind: "module";
  readonly descriptorName: string;
  readonly name: string;
  readonly types: readonly string[];
  readonly enums: readonly string[];
  readonly objects: readonly string[];
  readonly unions: readonly string[];
  readonly imports: readonly ProtocolModuleImportDescriptor[];
  readonly literalSchemas: readonly ProtocolLiteralSchemaDescriptor[];
  readonly extensionKey: string;
}

export interface ProtocolCatalogDescriptor {
  readonly kind: "catalog";
  readonly descriptorName: string;
  readonly name: string;
  readonly entries: readonly Readonly<Record<string, DescriptorExtensionValue>>[];
  readonly extensionKey: string;
}

function isRecord(
  value: DescriptorExtensionValue | undefined,
): value is Readonly<Record<string, DescriptorExtensionValue>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isScalarLiteral(value: DescriptorExtensionValue): value is ProtocolScalarLiteral {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

function asString(value: DescriptorExtensionValue | undefined): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asBoolean(value: DescriptorExtensionValue | undefined): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function asStringArray(value: DescriptorExtensionValue | undefined): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function parseProtocolModuleImport(
  raw: DescriptorExtensionValue,
): ProtocolModuleImportDescriptor | undefined {
  if (Array.isArray(raw)) {
    const [name, marker, from, schemaName] = raw;
    if (typeof name !== "string" || marker !== "from" || typeof from !== "string") {
      return undefined;
    }
    return {
      name,
      from,
      ...(typeof schemaName === "string" ? { schemaName } : {}),
      typeOnly: false,
    };
  }

  if (!isRecord(raw)) return undefined;
  const name = asString(raw["name"]);
  const from = asString(raw["from"] ?? raw["module"]);
  if (!name || !from) return undefined;
  const schemaName = asString(raw["schema"] ?? raw["schema-name"]);
  return {
    name,
    from,
    ...(schemaName !== undefined ? { schemaName } : {}),
    typeOnly: asBoolean(raw["type-only"]) ?? false,
  };
}

function parseProtocolModuleImports(
  raw: DescriptorExtensionValue | undefined,
): readonly ProtocolModuleImportDescriptor[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    const parsed = parseProtocolModuleImport(item);
    return parsed ? [parsed] : [];
  });
}

function asLiteralArray(
  value: DescriptorExtensionValue | undefined,
): readonly ProtocolScalarLiteral[] {
  if (value === undefined) return [];
  if (Array.isArray(value)) return value.filter(isScalarLiteral);
  return isScalarLiteral(value) ? [value] : [];
}

function primitiveType(name: string): ProtocolPrimitiveType | undefined {
  const normalized = name.toLowerCase();
  switch (normalized) {
    case "string":
    case "str":
      return "string";
    case "number":
    case "num":
      return "number";
    case "boolean":
    case "bool":
      return "boolean";
    case "null":
    case "nil":
      return "null";
    case "unknown":
    case "any":
      return "unknown";
    default:
      return undefined;
  }
}

function unknownType(): ProtocolTypeDescriptor {
  return { kind: "unknown" };
}

function parseNamedType(name: string): ProtocolTypeDescriptor {
  const primitive = primitiveType(name);
  return primitive ? { kind: primitive } : { kind: "ref", ref: name };
}

function parseArrayType(raw: DescriptorExtensionValue | undefined): ProtocolTypeDescriptor {
  return {
    kind: "array",
    item: raw === undefined ? unknownType() : parseProtocolType(raw),
  };
}

function parseRecordType(raw: DescriptorExtensionValue | undefined): ProtocolTypeDescriptor {
  return {
    kind: "record",
    value: raw === undefined ? unknownType() : parseProtocolType(raw),
  };
}

function parseUnionType(raw: DescriptorExtensionValue | undefined): ProtocolTypeDescriptor {
  const variants = Array.isArray(raw) ? raw.map(parseProtocolType) : [];
  return {
    kind: "union",
    variants: variants.length > 0 ? variants : [unknownType()],
  };
}

function parseLiteralType(raw: DescriptorExtensionValue | undefined): ProtocolTypeDescriptor {
  const values = asLiteralArray(raw);
  return { kind: "literal", values };
}

export function parseProtocolType(
  raw: DescriptorExtensionValue | undefined,
): ProtocolTypeDescriptor {
  if (raw === undefined || raw === null) return unknownType();
  if (typeof raw === "string") return parseNamedType(raw);
  if (typeof raw === "number" || typeof raw === "boolean") {
    return { kind: "literal", values: [raw] };
  }
  if (Array.isArray(raw)) {
    return { kind: "union", variants: raw.map(parseProtocolType) };
  }
  if (!isRecord(raw)) return unknownType();

  const explicitRef = asString(raw["ref"]);
  if (explicitRef) return { kind: "ref", ref: explicitRef };

  const inlineArray = raw["array"];
  if (inlineArray !== undefined) return parseArrayType(inlineArray);

  const inlineObject = raw["object"];
  if (inlineObject !== undefined) return { kind: "object", fields: parseProtocolFields(inlineObject) };

  const inlineRecord = raw["record"];
  if (inlineRecord !== undefined) return parseRecordType(inlineRecord);

  const inlineUnion = raw["union"];
  if (inlineUnion !== undefined) return parseUnionType(inlineUnion);

  const inlineLiteral = raw["literal"];
  if (inlineLiteral !== undefined) return parseLiteralType(inlineLiteral);

  const rawType = raw["type"];
  if (rawType !== undefined && typeof rawType !== "string") return parseProtocolType(rawType);

  const kind = asString(raw["kind"]) ?? asString(raw["type"]);
  switch (kind) {
    case "array":
    case "list":
      return parseArrayType(raw["item"] ?? raw["items"] ?? raw["element"]);
    case "record":
    case "map":
      return parseRecordType(raw["value"] ?? raw["value-type"] ?? raw["element"]);
    case "union":
      return parseUnionType(raw["variants"] ?? raw["members"]);
    case "literal":
      return parseLiteralType(raw["value"] ?? raw["values"]);
    default:
      return kind ? parseNamedType(kind) : unknownType();
  }
}

function parseProtocolField(
  name: string,
  raw: DescriptorExtensionValue,
): ProtocolObjectFieldDescriptor {
  const record = isRecord(raw) ? raw : {};
  const doc = asString(record["doc"]);
  const defaultValue = record["default"];
  return {
    name,
    type: parseProtocolType(raw),
    required: asBoolean(record["required"]) ?? false,
    aliases: asStringArray(record["aliases"]),
    ...(doc !== undefined ? { doc } : {}),
    ...(defaultValue !== undefined ? { default: defaultValue } : {}),
  };
}

function parseProtocolFields(
  raw: DescriptorExtensionValue | undefined,
): readonly ProtocolObjectFieldDescriptor[] {
  if (isRecord(raw)) {
    return Object.entries(raw).map(([name, value]) => parseProtocolField(name, value));
  }

  if (!Array.isArray(raw)) return [];

  return raw.flatMap((item) => {
    if (!isRecord(item)) return [];

    const name = asString(item["name"]);
    if (name) return [parseProtocolField(name, item)];

    const entries = Object.entries(item);
    if (entries.length !== 1) return [];
    const [fieldName, value] = entries[0]!;
    return [parseProtocolField(fieldName, value)];
  });
}

function defaultProtocolName(descriptor: FormDescriptor): string {
  return descriptor.produces ?? descriptor.name;
}

export function readProtocolObjectDescriptor(
  descriptor: FormDescriptor,
  extensionKey = PROTOCOL_OBJECT_EXTENSION_KEY,
): ProtocolObjectDescriptor | undefined {
  const raw = descriptor.extensions?.[extensionKey];
  if (!isRecord(raw)) return undefined;

  const name = asString(raw["name"]) ?? defaultProtocolName(descriptor);
  const schemaName = asString(raw["schema-name"]) ?? `${name}Schema`;
  return {
    kind: "object",
    descriptorName: descriptor.name,
    name,
    schemaName,
    fields: parseProtocolFields(raw["fields"]),
    extensionKey,
  };
}

function parseProtocolUnionMember(
  name: string,
  raw: DescriptorExtensionValue,
): ProtocolUnionMemberDescriptor {
  const record = isRecord(raw) ? raw : {};
  const tag = asString(record["tag"]) ?? name;
  const doc = asString(record["doc"]);

  return {
    name,
    tag,
    type: parseProtocolType(raw),
    ...(doc !== undefined ? { doc } : {}),
  };
}

function parseProtocolUnionMembers(
  raw: DescriptorExtensionValue | undefined,
): readonly ProtocolUnionMemberDescriptor[] {
  if (isRecord(raw)) {
    return Object.entries(raw).map(([name, value]) => parseProtocolUnionMember(name, value));
  }

  if (!Array.isArray(raw)) return [];

  return raw.flatMap((item) => {
    if (!isRecord(item)) return [];

    const name = asString(item["name"]);
    if (name) return [parseProtocolUnionMember(name, item)];

    const entries = Object.entries(item);
    if (entries.length !== 1) return [];
    const [memberName, value] = entries[0]!;
    return [parseProtocolUnionMember(memberName, value)];
  });
}

export function readProtocolUnionDescriptor(
  descriptor: FormDescriptor,
  extensionKey = PROTOCOL_UNION_EXTENSION_KEY,
): ProtocolUnionDescriptor | undefined {
  const raw = descriptor.extensions?.[extensionKey];
  if (!isRecord(raw)) return undefined;

  const name = asString(raw["name"]) ?? defaultProtocolName(descriptor);
  const schemaName = asString(raw["schema-name"]) ?? `${name}Schema`;
  const discriminator = asString(raw["discriminator"]);
  return {
    kind: "union",
    descriptorName: descriptor.name,
    name,
    schemaName,
    ...(discriminator !== undefined ? { discriminator } : {}),
    members: parseProtocolUnionMembers(raw["members"]),
    extensionKey,
  };
}

export function readProtocolTypeAliasDescriptor(
  descriptor: FormDescriptor,
  extensionKey = PROTOCOL_TYPE_EXTENSION_KEY,
): ProtocolTypeAliasDescriptor | undefined {
  const raw = descriptor.extensions?.[extensionKey];
  if (!isRecord(raw)) return undefined;

  const name = asString(raw["name"]) ?? defaultProtocolName(descriptor);
  const schemaName = asString(raw["schema-name"]) ?? `${name}Schema`;
  const description = asString(raw["description"] ?? raw["doc"]);

  return {
    kind: "type",
    descriptorName: descriptor.name,
    name,
    schemaName,
    type: parseProtocolType(raw["type"]),
    ...(description !== undefined ? { description } : {}),
    extensionKey,
  };
}

export function readProtocolEnumDescriptor(
  descriptor: FormDescriptor,
  extensionKey = PROTOCOL_ENUM_EXTENSION_KEY,
): ProtocolEnumDescriptor | undefined {
  const raw = descriptor.extensions?.[extensionKey];
  if (!isRecord(raw)) return undefined;

  const name = asString(raw["name"]) ?? defaultProtocolName(descriptor);
  const schemaName = asString(raw["schema-name"]) ?? name;
  const description = asString(raw["description"] ?? raw["doc"]);

  return {
    kind: "enum",
    descriptorName: descriptor.name,
    name,
    schemaName,
    values: asLiteralArray(raw["values"] ?? raw["value"]),
    ...(description !== undefined ? { description } : {}),
    extensionKey,
  };
}

function parseProtocolLiteralSchema(
  raw: DescriptorExtensionValue,
): ProtocolLiteralSchemaDescriptor | undefined {
  if (!isRecord(raw)) return undefined;
  const name = asString(raw["name"]);
  if (!name) return undefined;
  const values = asLiteralArray(raw["values"] ?? raw["value"]);
  const description = asString(raw["description"] ?? raw["doc"]);

  return {
    name,
    values,
    ...(description !== undefined ? { description } : {}),
  };
}

function parseProtocolLiteralSchemas(
  raw: DescriptorExtensionValue | undefined,
): readonly ProtocolLiteralSchemaDescriptor[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    const literal = parseProtocolLiteralSchema(item);
    return literal ? [literal] : [];
  });
}

export function readProtocolModuleDescriptor(
  descriptor: FormDescriptor,
  extensionKey = PROTOCOL_MODULE_EXTENSION_KEY,
): ProtocolModuleDescriptor | undefined {
  const raw = descriptor.extensions?.[extensionKey];
  if (!isRecord(raw)) return undefined;

  return {
    kind: "module",
    descriptorName: descriptor.name,
    name: asString(raw["name"]) ?? defaultProtocolName(descriptor),
    types: asStringArray(raw["types"] ?? raw["aliases"]),
    enums: asStringArray(raw["enums"]),
    objects: asStringArray(raw["objects"]),
    unions: asStringArray(raw["unions"]),
    imports: parseProtocolModuleImports(raw["imports"]),
    literalSchemas: parseProtocolLiteralSchemas(raw["literals"] ?? raw["literal-schemas"]),
    extensionKey,
  };
}

export function readProtocolCatalogDescriptor(
  descriptor: FormDescriptor,
  extensionKey = PROTOCOL_CATALOG_EXTENSION_KEY,
): ProtocolCatalogDescriptor | undefined {
  const raw = descriptor.extensions?.[extensionKey];
  if (!isRecord(raw)) return undefined;

  const name = asString(raw["name"]) ?? defaultProtocolName(descriptor);
  const entries = Array.isArray(raw["entries"])
    ? raw["entries"].filter(isRecord)
    : Array.isArray(raw["declarations"])
      ? raw["declarations"].filter(isRecord)
      : [];

  return {
    kind: "catalog",
    descriptorName: descriptor.name,
    name,
    entries,
    extensionKey,
  };
}

export function buildProtocolObjectDescriptors(
  descriptors: readonly FormDescriptor[],
  extensionKey = PROTOCOL_OBJECT_EXTENSION_KEY,
): readonly ProtocolObjectDescriptor[] {
  return descriptors.flatMap((descriptor) => {
    const protocol = readProtocolObjectDescriptor(descriptor, extensionKey);
    return protocol ? [protocol] : [];
  });
}

export function buildProtocolModuleDescriptors(
  descriptors: readonly FormDescriptor[],
  extensionKey = PROTOCOL_MODULE_EXTENSION_KEY,
): readonly ProtocolModuleDescriptor[] {
  return descriptors.flatMap((descriptor) => {
    const protocol = readProtocolModuleDescriptor(descriptor, extensionKey);
    return protocol ? [protocol] : [];
  });
}

export function buildProtocolUnionDescriptors(
  descriptors: readonly FormDescriptor[],
  extensionKey = PROTOCOL_UNION_EXTENSION_KEY,
): readonly ProtocolUnionDescriptor[] {
  return descriptors.flatMap((descriptor) => {
    const protocol = readProtocolUnionDescriptor(descriptor, extensionKey);
    return protocol ? [protocol] : [];
  });
}

export function buildProtocolTypeAliasDescriptors(
  descriptors: readonly FormDescriptor[],
  extensionKey = PROTOCOL_TYPE_EXTENSION_KEY,
): readonly ProtocolTypeAliasDescriptor[] {
  return descriptors.flatMap((descriptor) => {
    const protocol = readProtocolTypeAliasDescriptor(descriptor, extensionKey);
    return protocol ? [protocol] : [];
  });
}

export function buildProtocolEnumDescriptors(
  descriptors: readonly FormDescriptor[],
  extensionKey = PROTOCOL_ENUM_EXTENSION_KEY,
): readonly ProtocolEnumDescriptor[] {
  return descriptors.flatMap((descriptor) => {
    const protocol = readProtocolEnumDescriptor(descriptor, extensionKey);
    return protocol ? [protocol] : [];
  });
}

export function buildProtocolCatalogDescriptors(
  descriptors: readonly FormDescriptor[],
  extensionKey = PROTOCOL_CATALOG_EXTENSION_KEY,
): readonly ProtocolCatalogDescriptor[] {
  return descriptors.flatMap((descriptor) => {
    const protocol = readProtocolCatalogDescriptor(descriptor, extensionKey);
    return protocol ? [protocol] : [];
  });
}

import type {
  ProtocolEnumDescriptor,
  ProtocolModuleDescriptor,
  ProtocolModuleImportDescriptor,
  ProtocolObjectDescriptor,
  ProtocolScalarLiteral,
  ProtocolTypeAliasDescriptor,
  ProtocolTypeDescriptor,
  ProtocolUnionDescriptor,
} from "./protocol-descriptor.js";

export type ProtocolSchemaRefResolver = (ref: string) => string;

export interface ProtocolModuleImportEmitterOptions {
  readonly moduleSpecifiers: Readonly<Record<string, string>>;
}

export interface ProtocolSchemaRefResolverOptions {
  readonly module: ProtocolModuleDescriptor;
  readonly objects?: readonly ProtocolObjectDescriptor[] | undefined;
  readonly unions?: readonly ProtocolUnionDescriptor[] | undefined;
  readonly typeAliases?: readonly ProtocolTypeAliasDescriptor[] | undefined;
  readonly enums?: readonly ProtocolEnumDescriptor[] | undefined;
  readonly overrides?: Readonly<Record<string, string>> | undefined;
  readonly fallback?: ProtocolSchemaRefResolver | undefined;
}

export interface EmitProtocolSchemaOptions {
  readonly resolveSchemaRef?: ProtocolSchemaRefResolver | undefined;
  readonly exportSchema?: boolean | undefined;
}

export interface EmitProtocolUnionSchemaOptions extends EmitProtocolSchemaOptions {
  readonly description?: string | undefined;
}

export interface EmitProtocolLiteralSchemaOptions {
  readonly name: string;
  readonly values: readonly ProtocolScalarLiteral[];
  readonly description?: string | undefined;
}

export interface EmitProtocolModuleOptions {
  readonly header: readonly string[];
  readonly imports: readonly string[];
  readonly typeAliases?: readonly ProtocolTypeAliasDescriptor[] | undefined;
  readonly enums?: readonly ProtocolEnumDescriptor[] | undefined;
  readonly objects: readonly ProtocolObjectDescriptor[];
  readonly unions?: readonly ProtocolUnionDescriptor[] | undefined;
  readonly afterTypeDeclarations?: readonly string[] | undefined;
  readonly literalSchemas?: readonly EmitProtocolLiteralSchemaOptions[] | undefined;
  readonly schemaOptions?: EmitProtocolSchemaOptions | undefined;
  readonly unionDescriptions?: Readonly<Record<string, string>> | undefined;
  readonly footer?: readonly string[] | undefined;
}

function defaultSchemaRef(ref: string): string {
  return `${ref}Schema`;
}

function suspendedSchemaRef(ref: string, schemaName: string): string {
  return `Schema.suspend((): Schema.Schema<${ref}> => ${schemaName}).annotate({ identifier: ${JSON.stringify(ref)} })`;
}

function importSpecifierName(importDescriptor: ProtocolModuleImportDescriptor): string {
  if (importDescriptor.typeOnly) return `type ${importDescriptor.name}`;
  const schemaName = importDescriptor.schemaName;
  if (schemaName !== undefined && schemaName !== importDescriptor.name) {
    return `type ${importDescriptor.name}, ${schemaName}`;
  }
  return importDescriptor.name;
}

export function emitProtocolModuleImports(
  module: ProtocolModuleDescriptor,
  options: ProtocolModuleImportEmitterOptions,
): string[] {
  const byModule = new Map<string, Set<string>>();

  for (const importDescriptor of module.imports) {
    const moduleSpecifier = options.moduleSpecifiers[importDescriptor.from];
    if (!moduleSpecifier) {
      throw new Error(
        `Missing TypeScript module specifier for protocol import '${importDescriptor.from}' in '${module.name}'`,
      );
    }

    const imports = byModule.get(moduleSpecifier) ?? new Set<string>();
    imports.add(importSpecifierName(importDescriptor));
    byModule.set(moduleSpecifier, imports);
  }

  return [...byModule.entries()].map(
    ([moduleSpecifier, imports]) =>
      `import { ${[...imports].sort().join(", ")} } from ${JSON.stringify(moduleSpecifier)};`,
  );
}

export function createProtocolSchemaRefResolver(
  options: ProtocolSchemaRefResolverOptions,
): ProtocolSchemaRefResolver {
  const moduleObjectNames = new Set(options.module.objects);
  const moduleUnionNames = new Set(options.module.unions);
  const moduleAliasNames = new Set(options.module.types);
  const moduleEnumNames = new Set(options.module.enums);
  const objectByName = new Map(
    (options.objects ?? [])
      .filter((object) => moduleObjectNames.has(object.name))
      .map((object) => [object.name, object]),
  );
  const unionByName = new Map(
    (options.unions ?? [])
      .filter((union) => moduleUnionNames.has(union.name))
      .map((union) => [union.name, union]),
  );
  const aliasByName = new Map(
    (options.typeAliases ?? [])
      .filter((alias) => moduleAliasNames.has(alias.name))
      .map((alias) => [alias.name, alias]),
  );
  const enumByName = new Map(
    (options.enums ?? [])
      .filter((enumDescriptor) => moduleEnumNames.has(enumDescriptor.name))
      .map((enumDescriptor) => [enumDescriptor.name, enumDescriptor]),
  );
  const literalSchemaByName = new Map(
    options.module.literalSchemas.map((literalSchema) => [literalSchema.name, literalSchema]),
  );
  const importSchemaByName = new Map(
    options.module.imports.flatMap((importDescriptor) =>
      importDescriptor.schemaName !== undefined
        ? ([[importDescriptor.name, importDescriptor.schemaName]] as const)
        : [],
    ),
  );

  return (ref) => {
    const override = options.overrides?.[ref];
    if (override !== undefined) return override;

    const enumDescriptor = enumByName.get(ref);
    if (enumDescriptor) return enumDescriptor.schemaName;

    const literalSchema = literalSchemaByName.get(ref);
    if (literalSchema) return literalSchema.name;

    const object = objectByName.get(ref);
    if (object) return suspendedSchemaRef(ref, object.schemaName);

    const union = unionByName.get(ref);
    if (union) return suspendedSchemaRef(ref, union.schemaName);

    const alias = aliasByName.get(ref);
    if (alias) return suspendedSchemaRef(ref, alias.schemaName);

    const importedSchema = importSchemaByName.get(ref);
    if (importedSchema) return importedSchema;

    return options.fallback?.(ref) ?? defaultSchemaRef(ref);
  };
}

export function requiredProtocolUnion(
  unions: readonly ProtocolUnionDescriptor[],
  name: string,
): ProtocolUnionDescriptor {
  const union = unions.find((candidate) => candidate.name === name);
  if (!union) throw new Error(`Missing protocol union '${name}'`);
  return union;
}

export function requiredProtocolObject(
  objects: readonly ProtocolObjectDescriptor[],
  name: string,
): ProtocolObjectDescriptor {
  const object = objects.find((candidate) => candidate.name === name);
  if (!object) throw new Error(`Missing protocol object '${name}'`);
  return object;
}

export function requiredProtocolTypeAlias(
  aliases: readonly ProtocolTypeAliasDescriptor[],
  name: string,
): ProtocolTypeAliasDescriptor {
  const alias = aliases.find((candidate) => candidate.name === name);
  if (!alias) throw new Error(`Missing protocol type alias '${name}'`);
  return alias;
}

export function requiredProtocolEnum(
  enums: readonly ProtocolEnumDescriptor[],
  name: string,
): ProtocolEnumDescriptor {
  const enumDescriptor = enums.find((candidate) => candidate.name === name);
  if (!enumDescriptor) throw new Error(`Missing protocol enum '${name}'`);
  return enumDescriptor;
}

export function requiredProtocolModule(
  modules: readonly ProtocolModuleDescriptor[],
  name: string,
): ProtocolModuleDescriptor {
  const module = modules.find((candidate) => candidate.name === name);
  if (!module) throw new Error(`Missing protocol module '${name}'`);
  return module;
}

export function protocolObjectsForModule(
  module: ProtocolModuleDescriptor,
  allObjects: readonly ProtocolObjectDescriptor[],
): readonly ProtocolObjectDescriptor[] {
  return module.objects.map((name) => requiredProtocolObject(allObjects, name));
}

export function protocolTypeAliasesForModule(
  module: ProtocolModuleDescriptor,
  allAliases: readonly ProtocolTypeAliasDescriptor[],
): readonly ProtocolTypeAliasDescriptor[] {
  return module.types.map((name) => requiredProtocolTypeAlias(allAliases, name));
}

export function protocolEnumsForModule(
  module: ProtocolModuleDescriptor,
  allEnums: readonly ProtocolEnumDescriptor[],
): readonly ProtocolEnumDescriptor[] {
  return module.enums.map((name) => requiredProtocolEnum(allEnums, name));
}

export function protocolUnionsForModule(
  module: ProtocolModuleDescriptor,
  allUnions: readonly ProtocolUnionDescriptor[],
): readonly ProtocolUnionDescriptor[] {
  return module.unions.map((name) => requiredProtocolUnion(allUnions, name));
}

export function protocolObjectsForUnion(
  union: ProtocolUnionDescriptor,
  allObjects: readonly ProtocolObjectDescriptor[],
): readonly ProtocolObjectDescriptor[] {
  const refs = new Set(
    union.members.flatMap((member) => (member.type.kind === "ref" ? [member.type.ref] : [])),
  );
  return allObjects.filter((object) => refs.has(object.name));
}

export function emitProtocolInterface(object: ProtocolObjectDescriptor): string[] {
  const lines = [`export interface ${object.name} {`];
  for (const field of object.fields) {
    const type = tsProtocolType(field.type);
    lines.push(
      field.required
        ? `  readonly ${safeProtocolFieldName(field.name)}: ${type};`
        : `  readonly ${safeProtocolFieldName(field.name)}?: ${type} | undefined;`,
    );
  }
  lines.push("}");
  return lines;
}

export function emitProtocolTypeAlias(alias: ProtocolTypeAliasDescriptor): string[] {
  return [`export type ${alias.name} = ${tsProtocolType(alias.type)};`];
}

export function emitProtocolUnionType(union: ProtocolUnionDescriptor): string[] {
  return [
    `export type ${union.name} =`,
    ...union.members.map((member) => `  | ${tsProtocolType(member.type)}`),
    ";",
  ];
}

export function emitProtocolObjectSchema(
  object: ProtocolObjectDescriptor,
  options: EmitProtocolSchemaOptions = {},
): string[] {
  const lines = [
    `${options.exportSchema ? "export " : ""}const ${object.schemaName} = Schema.Struct({`,
  ];
  for (const field of object.fields) {
    const schema = schemaProtocolType(field.type, options);
    lines.push(
      field.required
        ? `  ${safeProtocolFieldName(field.name)}: ${schema},`
        : `  ${safeProtocolFieldName(field.name)}: Schema.optional(${schema}),`,
    );
  }
  lines.push(
    "}).annotate({",
    `  identifier: ${JSON.stringify(object.name)},`,
    `}) as unknown as Schema.Schema<${object.name}>;`,
  );
  return lines;
}

export function emitProtocolTypeAliasSchema(
  alias: ProtocolTypeAliasDescriptor,
  options: EmitProtocolSchemaOptions = {},
): string[] {
  const exportPrefix = options.exportSchema === false ? "" : "export ";
  const lines = [
    `${exportPrefix}const ${alias.schemaName}: Schema.Schema<${alias.name}> = Schema.suspend(`,
    `  (): Schema.Schema<${alias.name}> => ${schemaProtocolType(alias.type, options)},`,
    ").annotate({",
    `  identifier: ${JSON.stringify(alias.name)},`,
  ];

  if (alias.description !== undefined) {
    lines.push(`  description: ${JSON.stringify(alias.description)},`);
  }

  lines.push(`}) as Schema.Schema<${alias.name}>;`);
  return lines;
}

export function emitProtocolUnionSchema(
  union: ProtocolUnionDescriptor,
  objectByName: ReadonlyMap<string, ProtocolObjectDescriptor>,
  options: EmitProtocolUnionSchemaOptions = {},
): string[] {
  const schemaNames = union.members.map((member) => {
    if (member.type.kind !== "ref") return schemaProtocolType(member.type, options);
    const object = objectByName.get(member.type.ref);
    return object?.schemaName ?? schemaProtocolType(member.type, options);
  });

  const lines = [
    `${options.exportSchema ? "export " : ""}const ${union.schemaName}: Schema.Schema<${union.name}> = Schema.suspend(`,
    `  (): Schema.Schema<${union.name}> => Schema.Union(${schemaNames.join(", ")}),`,
    ").annotate({",
    `  identifier: ${JSON.stringify(union.name)},`,
  ];

  if (options.description !== undefined) {
    lines.push(`  description: ${JSON.stringify(options.description)},`);
  }

  lines.push(`}) as Schema.Schema<${union.name}>;`);
  return lines;
}

export function emitProtocolEnumSchema(schema: ProtocolEnumDescriptor): string[] {
  const lines = [
    `export const ${schema.schemaName} = Schema.Literal(${schema.values.map((value) => JSON.stringify(value)).join(", ")}).annotate({`,
    `  identifier: ${JSON.stringify(schema.name)},`,
  ];

  if (schema.description !== undefined) {
    lines.push(`  description: ${JSON.stringify(schema.description)},`);
  }

  lines.push("});", `export type ${schema.name} = typeof ${schema.schemaName}.Type;`);
  return lines;
}

export function emitProtocolLiteralSchema(schema: EmitProtocolLiteralSchemaOptions): string[] {
  const lines = [
    `export const ${schema.name} = Schema.Literal(${schema.values.map((value) => JSON.stringify(value)).join(", ")}).annotate({`,
    `  identifier: ${JSON.stringify(schema.name)},`,
  ];

  if (schema.description !== undefined) {
    lines.push(`  description: ${JSON.stringify(schema.description)},`);
  }

  lines.push("});", `export type ${schema.name} = typeof ${schema.name}.Type;`);
  return lines;
}

export function emitProtocolModule(options: EmitProtocolModuleOptions): string {
  const unions = options.unions ?? [];
  const objectByName = new Map(options.objects.map((object) => [object.name, object]));
  const schemaOptions = options.schemaOptions ?? {};
  const lines: string[] = [...options.header, "", ...options.imports, ""];

  for (const enumDescriptor of options.enums ?? []) {
    lines.push(...emitProtocolEnumSchema(enumDescriptor), "");
  }

  for (const object of options.objects) {
    lines.push(...emitProtocolInterface(object), "");
  }

  for (const union of unions) {
    lines.push(...emitProtocolUnionType(union), "");
  }

  for (const alias of options.typeAliases ?? []) {
    lines.push(...emitProtocolTypeAlias(alias), "");
  }

  if (options.afterTypeDeclarations) {
    lines.push(...options.afterTypeDeclarations, "");
  }

  for (const literal of options.literalSchemas ?? []) {
    lines.push(...emitProtocolLiteralSchema(literal), "");
  }

  for (const alias of options.typeAliases ?? []) {
    lines.push(...emitProtocolTypeAliasSchema(alias, schemaOptions), "");
  }

  for (const object of options.objects) {
    lines.push(...emitProtocolObjectSchema(object, schemaOptions), "");
  }

  for (const union of unions) {
    lines.push(
      ...emitProtocolUnionSchema(union, objectByName, {
        ...schemaOptions,
        description: options.unionDescriptions?.[union.name],
      }),
      "",
    );
  }

  if (options.footer) lines.push(...options.footer);

  return lines.join("\n").trimEnd() + "\n";
}

export function tsProtocolType(type: ProtocolTypeDescriptor): string {
  switch (type.kind) {
    case "string":
      return "string";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "null":
      return "null";
    case "unknown":
      return "unknown";
    case "literal":
      return type.values.map((value) => JSON.stringify(value)).join(" | ") || "never";
    case "ref":
      return type.ref;
    case "array":
      return `readonly ${wrapTsProtocolType(type.item)}[]`;
    case "record":
      return `Record<string, ${tsProtocolType(type.value)}>`;
    case "union":
      return type.variants.map(wrapTsProtocolType).join(" | ");
  }
}

function wrapTsProtocolType(type: ProtocolTypeDescriptor): string {
  return type.kind === "union" ? `(${tsProtocolType(type)})` : tsProtocolType(type);
}

export function schemaProtocolType(
  type: ProtocolTypeDescriptor,
  options: EmitProtocolSchemaOptions = {},
): string {
  switch (type.kind) {
    case "string":
      return "Schema.String";
    case "number":
      return "Schema.Number";
    case "boolean":
      return "Schema.Boolean";
    case "null":
      return "Schema.Null";
    case "unknown":
      return "Schema.Unknown";
    case "literal":
      return `Schema.Literal(${type.values.map((value) => JSON.stringify(value)).join(", ")})`;
    case "ref":
      return (options.resolveSchemaRef ?? defaultSchemaRef)(type.ref);
    case "array":
      return `Schema.Array(${schemaProtocolType(type.item, options)})`;
    case "record":
      return `Schema.Record(Schema.String, ${schemaProtocolType(type.value, options)})`;
    case "union":
      return `Schema.Union(${type.variants.map((variant) => schemaProtocolType(variant, options)).join(", ")})`;
  }
}

export function safeProtocolFieldName(name: string): string {
  return /^[$A-Z_][0-9A-Z_$]*$/i.test(name) ? name : JSON.stringify(name);
}

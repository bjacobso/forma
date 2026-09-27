import type {
  FormDescriptor,
  IdentifierSpec,
  SlotSpec,
  ValidationCheck,
} from "./FormDescriptor.js";
import {
  readDescriptorTreeCompileSpec,
  type DescriptorTreeCompileSpec,
  type DescriptorTreeSlotCompileSpec,
} from "./descriptor-tree-compile.js";

export interface GeneratedSchemaModule {
  readonly code: string;
  readonly schemaNames: readonly string[];
}

export interface GenerateEffectSchemaModuleOptions {
  readonly descriptors: readonly FormDescriptor[];
  readonly unionType?: {
    readonly name: string;
    readonly discriminator: string;
  };
  readonly baseFields?: Readonly<Record<string, string>>;
  readonly imports?: readonly string[];
  readonly exprSchema?: string;
  readonly unknownSchema?: string;
  readonly descriptorTree?: {
    readonly extensionKey: string;
    readonly actionSchema?: string;
  };
}

const DEFAULT_EXPR_SCHEMA = "Schema.Unknown";
const DEFAULT_UNKNOWN_SCHEMA = "Schema.Unknown";

interface DescriptorTreeSchemaContext {
  readonly extensionKey: string;
  readonly actionSchema: string;
  readonly nodeSchemaName?: string;
}

export function generateEffectSchemaModule(
  options: GenerateEffectSchemaModuleOptions,
): GeneratedSchemaModule {
  const descriptors = options.descriptors;
  const schemaNames = descriptors.map((descriptor) => schemaName(descriptor.name));
  const descriptorMap = new Map(descriptors.map((descriptor) => [descriptor.name, descriptor]));
  const lines: string[] = ['import { Schema } from "effect";'];
  const descriptorTree = options.descriptorTree
    ? {
        extensionKey: options.descriptorTree.extensionKey,
        actionSchema: options.descriptorTree.actionSchema ?? DEFAULT_UNKNOWN_SCHEMA,
        ...(options.unionType ? { nodeSchemaName: `${options.unionType.name}Schema` } : {}),
      }
    : undefined;
  const schemaContext = {
    descriptorMap,
    baseFields: options.baseFields ?? {},
    exprSchema: options.exprSchema ?? DEFAULT_EXPR_SCHEMA,
    unknownSchema: options.unknownSchema ?? DEFAULT_UNKNOWN_SCHEMA,
    ...(descriptorTree ? { descriptorTree } : {}),
  };

  for (const statement of options.imports ?? []) {
    lines.push(statement);
  }

  lines.push("");

  for (const descriptor of descriptors) {
    lines.push(
      ...emitDescriptorSchema(descriptor, {
        ...schemaContext,
        ...(options.unionType ? { discriminator: options.unionType.discriminator } : {}),
      }),
      "",
    );
  }

  if (options.unionType) {
    lines.push(
      ...emitUnionSchema(options.unionType, descriptors, descriptorTree !== undefined),
      "",
    );
  }

  return {
    code: lines.join("\n").trimEnd() + "\n",
    schemaNames,
  };
}

function emitDescriptorSchema(
  descriptor: FormDescriptor,
  context: {
    readonly descriptorMap: ReadonlyMap<string, FormDescriptor>;
    readonly baseFields: Readonly<Record<string, string>>;
    readonly exprSchema: string;
    readonly unknownSchema: string;
    readonly discriminator?: string;
    readonly descriptorTree?: DescriptorTreeSchemaContext;
  },
): string[] {
  const schemaConst = schemaName(descriptor.name);
  const fieldLines = emitFields(descriptor, context);

  const lines = [`export const ${schemaConst} = Schema.Struct({`];
  for (const fieldLine of fieldLines) {
    lines.push(`  ${fieldLine}`);
  }
  lines.push(
    `}).annotate({ identifier: "${schemaConst}" })${context.descriptorTree ? " as Schema.Schema<unknown>" : ""};`,
  );
  lines.push(`export type ${schemaConst.replace(/Schema$/, "")} = typeof ${schemaConst}.Type;`);
  return lines;
}

function emitUnionSchema(
  unionType: NonNullable<GenerateEffectSchemaModuleOptions["unionType"]>,
  descriptors: readonly FormDescriptor[],
  useUnknownSchemaAnnotation: boolean,
): string[] {
  const unionSchemaName = `${unionType.name}Schema`;
  const members = descriptors.map((descriptor) => schemaName(descriptor.name)).join(", ");
  return [
    `export const ${unionSchemaName} = Schema.Union(${members}).annotate({ identifier: "${unionType.name}" })${useUnknownSchemaAnnotation ? " as Schema.Schema<unknown>" : ""};`,
    `export type ${unionType.name} = typeof ${unionSchemaName}.Type;`,
  ];
}

function emitFields(
  descriptor: FormDescriptor,
  context: {
    readonly descriptorMap: ReadonlyMap<string, FormDescriptor>;
    readonly baseFields: Readonly<Record<string, string>>;
    readonly exprSchema: string;
    readonly unknownSchema: string;
    readonly discriminator?: string;
    readonly descriptorTree?: DescriptorTreeSchemaContext;
  },
): string[] {
  const lines: string[] = [];
  const compileSpec = context.descriptorTree
    ? readDescriptorTreeCompileSpec(descriptor, context.descriptorTree.extensionKey)
    : undefined;

  if (context.discriminator) {
    lines.push(
      `${safeFieldName(context.discriminator)}: Schema.Literal(${JSON.stringify(descriptor.name)}),`,
    );
  }

  for (const [name, expr] of Object.entries(context.baseFields)) {
    lines.push(`...${name}, // ${expr}`);
  }

  for (const identifier of descriptor.identifiers) {
    lines.push(emitIdentifierField(identifier, context.unknownSchema));
  }

  for (const slot of descriptor.slots) {
    lines.push(emitSlotField(slot, descriptor.validation, context, compileSpec));
  }

  if (compileSpec && context.descriptorTree?.nodeSchemaName) {
    const children = emitDescriptorTreeChildrenField(compileSpec, context.descriptorTree);
    if (children) lines.push(children);
  }

  if (compileSpec) {
    const events = emitDescriptorTreeEventsField(compileSpec, context.descriptorTree?.actionSchema);
    if (events) lines.push(events);
  }

  return lines;
}

function emitDescriptorTreeChildrenField(
  compileSpec: DescriptorTreeCompileSpec,
  context: DescriptorTreeSchemaContext,
): string | undefined {
  const children = compileSpec.component.children;
  if (!children || children.kind === "none") return undefined;

  const nodeSchemaName = context.nodeSchemaName;
  if (!nodeSchemaName) return undefined;

  const childSchema =
    children.kind === "only"
      ? `Schema.suspend((): Schema.Schema<unknown> => ${
          children.types.length === 1
            ? schemaName(children.types[0]!)
            : `Schema.Union(${children.types.map((type) => schemaName(type)).join(", ")})`
        })`
      : `Schema.suspend((): Schema.Schema<unknown> => ${nodeSchemaName})`;
  return `children: Schema.optional(Schema.Array(${childSchema})),`;
}

function emitDescriptorTreeEventsField(
  compileSpec: DescriptorTreeCompileSpec,
  actionSchema: string | undefined,
): string | undefined {
  if (compileSpec.events.size === 0) return undefined;
  const schema = actionSchema ?? DEFAULT_UNKNOWN_SCHEMA;
  const fields = [...compileSpec.events.values()]
    .map((eventField) => `${safeFieldName(eventField)}: Schema.optional(${schema})`)
    .join(", ");
  return `events: Schema.optional(Schema.Struct({ ${fields} })),`;
}

function emitIdentifierField(identifier: IdentifierSpec, unknownSchema: string): string {
  const schemaExpr =
    identifier.kind === "String"
      ? "Schema.String"
      : identifier.kind === "Value"
        ? unknownSchema
        : "Schema.String";

  return `${safeFieldName(identifier.name)}: ${schemaExpr},`;
}

function emitSlotField(
  slot: SlotSpec,
  validation: FormDescriptor["validation"],
  context: {
    readonly descriptorMap: ReadonlyMap<string, FormDescriptor>;
    readonly exprSchema: string;
    readonly unknownSchema: string;
    readonly descriptorTree?: DescriptorTreeSchemaContext;
  },
  compileSpec?: DescriptorTreeCompileSpec,
): string {
  const slotCompileSpec = compileSpec?.slots.get(toCamelCase(slot.name));
  const fieldName = safeFieldName(slotCompileSpec?.field ?? slot.name);
  const validationSchema = deriveValidationSchema(slot, validation);
  const baseSchema =
    validationSchema ??
    emitSlotSchema(slot, {
      descriptorMap: context.descriptorMap,
      exprSchema: context.exprSchema,
      unknownSchema: context.unknownSchema,
      ...(context.descriptorTree ? { descriptorTree: context.descriptorTree } : {}),
      ...(slotCompileSpec ? { slotCompileSpec } : {}),
    });
  const schemaExpr = slot.required ? baseSchema : `Schema.optional(${baseSchema})`;
  return `${fieldName}: ${schemaExpr},`;
}

function deriveValidationSchema(
  slot: SlotSpec,
  validation: FormDescriptor["validation"],
): string | undefined {
  if (validation.kind !== "static" && validation.kind !== "composite") return undefined;

  const oneOfCheck = validation.checks.find(
    (check): check is ValidationCheck & { values: readonly string[] } =>
      check.kind === "one-of" &&
      check.slot === slot.name &&
      Array.isArray(check.values) &&
      check.values.length > 0,
  );

  if (!oneOfCheck) return undefined;
  return `Schema.Literal(${oneOfCheck.values.map((value) => JSON.stringify(value)).join(", ")})`;
}

function emitSlotSchema(
  slot: SlotSpec,
  context: {
    readonly descriptorMap: ReadonlyMap<string, FormDescriptor>;
    readonly exprSchema: string;
    readonly unknownSchema: string;
    readonly descriptorTree?: DescriptorTreeSchemaContext;
    readonly slotCompileSpec?: DescriptorTreeSlotCompileSpec;
  },
): string {
  if (context.slotCompileSpec?.kind === "json") return context.unknownSchema;
  if (context.slotCompileSpec?.kind === "node-list" && context.descriptorTree?.nodeSchemaName) {
    return `Schema.Array(Schema.suspend((): Schema.Schema<unknown> => ${context.descriptorTree.nodeSchemaName}))`;
  }

  let baseSchema = slot.mode === "expr" ? context.exprSchema : resolveTypeSchema(slot, context);

  if (slot.mode === "form") {
    const childShape = slot.childShape;
    if (childShape) {
      baseSchema = emitChildShapeSchema(childShape, context);
    } else if (slot.type && context.descriptorMap.has(slot.type)) {
      baseSchema = schemaName(slot.type);
    }
  }

  return slot.many ? `Schema.Array(${baseSchema})` : baseSchema;
}

function emitChildShapeSchema(
  childShape: NonNullable<SlotSpec["childShape"]>,
  context: {
    readonly descriptorMap: ReadonlyMap<string, FormDescriptor>;
    readonly exprSchema: string;
    readonly unknownSchema: string;
  },
): string {
  const fields = [
    `${safeFieldName("type")}: Schema.Literal(${JSON.stringify(childShape.formName)})`,
    ...childShape.identifiers.map((identifier) =>
      emitIdentifierField(identifier, context.unknownSchema).replace(/,$/, ""),
    ),
    ...childShape.slots.map((slot) =>
      emitSlotField(slot, { kind: "none" }, context).replace(/,$/, ""),
    ),
  ];

  return `Schema.Struct({ ${fields.join(", ")} })`;
}

function resolveTypeSchema(
  slot: SlotSpec,
  context: {
    readonly descriptorMap: ReadonlyMap<string, FormDescriptor>;
    readonly unknownSchema: string;
  },
): string {
  const normalized = slot.type ?? slot.typeFrom;
  if (!normalized) return context.unknownSchema;

  switch (normalized) {
    case "String":
    case "Str":
    case "Symbol":
      return "Schema.String";
    case "Number":
    case "Num":
    case "Int":
    case "Float":
      return "Schema.Number";
    case "Boolean":
    case "Bool":
      return "Schema.Boolean";
    case "Null":
      return "Schema.Null";
    case "Unknown":
    case "Any":
    case "Value":
      return context.unknownSchema;
    default:
      if (context.descriptorMap.has(normalized)) {
        return schemaName(normalized);
      }
      return context.unknownSchema;
  }
}

function schemaName(name: string): string {
  return `${toPascalCase(name)}Schema`;
}

function toPascalCase(value: string): string {
  return value
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

function toCamelCase(value: string): string {
  return value.replace(/-([a-z])/g, (_: string, c: string) => c.toUpperCase());
}

function safeFieldName(name: string): string {
  return /^[$A-Z_][0-9A-Z_$]*$/i.test(name) ? name : JSON.stringify(name);
}

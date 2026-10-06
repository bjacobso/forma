import { Effect } from "effect";
import type { KValue } from "../evaluator/types.js";
import { headSym, tail } from "../reader/types.js";
import type { SExpr } from "../reader/types.js";
import type {
  ElaborationDescriptor,
  ElaborationField,
  ElaborationObjectField,
  ElaborationSource,
} from "./ElaborationDescriptor.js";
import {
  ElaborationError,
  type ElaborationHook,
  type HookInput,
  type NormalizedChildForm,
} from "./ElaborationHook.js";
import { SimpleNormalizedSlots, type SlotValue } from "./NormalizedSlots.js";
import { normalizeRuntimeExprObject, runtimeExpr } from "./runtime-expr.js";

/**
 * Descriptor-authored construct hook interpreter. This is the TypeScript peer
 * of the OCaml native elaboration path: when a `__projection-plan` descriptor
 * is registered for a hook, this executor is preferred over the Lisp __form-hook
 * body. The Lisp body stays available during migration so parity tests can
 * prove equivalence before the body is removed from the shared prelude.
 */

export function createElaborationDescriptorHook(
  descriptor: ElaborationDescriptor,
): ElaborationHook {
  return {
    name: descriptor.hook,
    kind: "construct",
    doc: `Descriptor-authored elaboration '${descriptor.name}'.`,
    inputType: "FormMetaInput",
    outputType: descriptor.resultType,
    pure: true,
    phase: "compile",
    execute: (input: HookInput) =>
      Effect.try({
        try: () => ({
          kind: "construct" as const,
          ir: runElaborationDescriptor(descriptor, input),
        }),
        catch: (error) =>
          new ElaborationError({
            hookName: descriptor.hook,
            phase: "construct",
            message: error instanceof Error ? error.message : String(error),
          }),
      }),
  };
}

export function runElaborationDescriptor(
  descriptor: ElaborationDescriptor,
  input: HookInput,
): KValue {
  const name = descriptor.nameSource
    ? (sourceString(input, descriptor.nameSource) ?? descriptor.nameDefault)
    : undefined;
  const fields = descriptor.fields.map((field) => runField(input, field));
  const entries: [string, KValue][] = [["kind", descriptor.irKind]];

  let insertedSummary = descriptor.nameOutput === undefined;
  if (insertedSummary) {
    entries.push(["$summary", summary(descriptor.irKind, name, descriptor.resultType)]);
  }
  for (const field of fields) {
    entries.push(field);
    if (field[0] === descriptor.nameOutput && !insertedSummary) {
      entries.push(["$summary", summary(descriptor.irKind, name, descriptor.resultType)]);
      insertedSummary = true;
    }
  }
  if (!insertedSummary) {
    entries.push(["$summary", summary(descriptor.irKind, name, descriptor.resultType)]);
  }

  return new Map(entries) as unknown as KValue;
}

function summary(kind: string, name: string | undefined, resultType: string): KValue {
  const entries: [string, KValue][] = [
    ["kind", kind],
    ["resultType", resultType],
  ];
  if (name !== undefined) entries.splice(1, 0, ["name", name]);
  return new Map<string, KValue>(entries) as unknown as KValue;
}

function runField(input: HookInput, field: ElaborationField): [string, KValue] {
  switch (field.kind) {
    case "source":
      return [field.output, sourceValue(input, field.source)];
    case "assignments":
      return [field.output, runAssignments(input, field)];
    case "children":
      return [field.output, runChildren(input, field.child, field.fields)];
  }
}

function runAssignments(
  input: HookInput,
  field: Extract<ElaborationField, { readonly kind: "assignments" }>,
): KValue {
  const entries = new Map<string, KValue>();
  for (const child of childForms(input, field.child)) {
    const key = identifierString(child, field.key);
    if (key === undefined) continue;
    const rawValue = slotString(child, field.value);
    const value =
      field.default !== undefined
        ? truthyKValue(rawValue)
          ? rawValue
          : field.default
        : slotSymbol(child, field.value);
    entries.set(key, value);
  }
  return entries as unknown as KValue;
}

function runChildren(
  input: HookInput | NormalizedChildForm,
  childName: string,
  fields: readonly ElaborationObjectField[],
): KValue {
  return childForms(input, childName).map((child) => {
    const entries = fields.map(
      (field) => [field.output, sourceValue(child, field.source)] as const,
    );
    return new Map(entries) as unknown as KValue;
  }) as unknown as KValue;
}

function sourceValue(input: HookInput | NormalizedChildForm, source: ElaborationSource): KValue {
  switch (source.kind) {
    case "identifier":
      return identifierString(input, source.name) ?? null;
    case "slot-string":
      return slotString(input, source.name);
    case "slot-string-list":
      return slotStringList(input, source.name);
    case "slot-symbol":
      return slotSymbol(input, source.name);
    case "slot-expr":
      return slotValue(input, source.name);
    case "slot-runtime-expr":
      return runtimeExpr(slotValue(input, source.name));
    case "positional":
      return positional(input, source.index);
    case "loc":
      return locValue(input);
    case "format":
      return source.parts.map((part) => sourceString(input, part) ?? "").join("");
    case "default": {
      const value = sourceValue(input, source.source);
      return truthyKValue(value) ? value : source.fallback;
    }
    case "first":
      for (const candidate of source.sources) {
        const value = sourceValue(input, candidate);
        if (truthyKValue(value)) return value;
      }
      return null;
    case "ref": {
      const name = sourceString(input, source.source);
      return name !== undefined ? refValue(source.refKind, name) : null;
    }
    case "object":
      return objectValue(input, source.fields);
    case "child": {
      const child = childForms(input, source.child)[0];
      return child ? objectValue(child, source.fields) : null;
    }
    case "children":
      return childForms(input, source.child).map((child) =>
        objectValue(child, source.fields),
      ) as unknown as KValue;
    case "when":
      return truthyKValue(sourceValue(input, source.condition))
        ? sourceValue(input, source.source)
        : null;
    case "primitive":
      return primitiveValue(source.name, sourceValue(input, source.source));
    case "literal":
      return source.value;
  }
}

function primitiveValue(name: string, value: KValue): KValue {
  switch (name) {
    case "attribute-binding":
      return attributeBinding(value);
    default:
      throw new Error(`Unknown elaboration primitive '${name}'`);
  }
}

function attributeBinding(value: KValue): KValue {
  const values = Array.isArray(value) ? value : truthyKValue(value) ? [value] : [];
  if (values.length === 0) return null;

  const nthString = (index: number) => {
    const item = values[index];
    return item === undefined ? undefined : scalarString(item as KValue);
  };
  const optionString = (index: number, key: string) =>
    nthString(index) === key ? nthString(index + 1) : undefined;
  const firstOption = (key: string) =>
    optionString(1, key) ?? optionString(3, key) ?? optionString(5, key) ?? null;

  return new Map<string, KValue>([
    ["kind", "AttributeBinding"],
    ["attribute", nthString(0) ?? null],
    ["transform", firstOption(":transform")],
    ["entity", firstOption(":entity")],
    ["cardinality", firstOption(":cardinality")],
  ]) as unknown as KValue;
}

function objectValue(
  input: HookInput | NormalizedChildForm,
  fields: readonly ElaborationObjectField[],
): KValue {
  if (
    fields.some(
      (field) =>
        field.output === "kind" &&
        field.source.kind === "literal" &&
        field.source.value === "raw-expr",
    )
  ) {
    const exprField = fields.find((field) => field.output === "expr");
    return runtimeExpr(exprField ? rawSourceValue(input, exprField.source) : null) as KValue;
  }

  const obj = new Map(fields.map((field) => [field.output, sourceValue(input, field.source)]));
  return normalizeRuntimeExprObject(obj);
}

function rawSourceValue(input: HookInput | NormalizedChildForm, source: ElaborationSource): KValue {
  if (source.kind === "positional") return rawPositional(input, source.index);
  return sourceValue(input, source);
}

function positional(input: HookInput | NormalizedChildForm, index: number): KValue {
  const value = rawPositional(input, index);
  if (!value || !isSExprLike(value)) return value;
  switch (value._tag) {
    case "Sym":
      return typeof value.name === "string" ? value.name : null;
    case "Str":
      return typeof value.value === "string" ? value.value : null;
    case "Num":
      return typeof value.value === "number" ? value.value : null;
    case "Bool":
      return typeof value.value === "boolean" ? value.value : null;
    default:
      return value as unknown as KValue;
  }
}

function rawPositional(input: HookInput | NormalizedChildForm, index: number): KValue {
  const positionalArgs = tail(input.rawExpr).filter((item) => !isKeywordHead(item));
  const value = positionalArgs[index];
  if (!value) return null;
  return value as unknown as KValue;
}

function sourceString(
  input: HookInput | NormalizedChildForm,
  source: ElaborationSource,
): string | undefined {
  const value = sourceValue(input, source);
  return scalarString(value);
}

function identifierString(
  input: HookInput | NormalizedChildForm,
  name: string,
): string | undefined {
  return input.identifiers.get(name);
}

function slotString(input: HookInput | NormalizedChildForm, name: string): KValue {
  const value = slotValue(input, name);
  if (typeof value === "string") return value;
  if (isSExprLike(value)) {
    if (value._tag === "Sym" && typeof value.name === "string") return value.name;
    if (value._tag === "Str" && typeof value.value === "string") return value.value;
    if (value._tag === "Num" && typeof value.value === "number") return String(value.value);
  }
  return value ?? null;
}

function slotSymbol(input: HookInput | NormalizedChildForm, name: string): KValue {
  const value = slotValue(input, name);
  if (typeof value === "string") return value;
  if (isSExprLike(value) && value._tag === "Sym" && typeof value.name === "string") {
    return value.name;
  }
  return value ?? null;
}

function slotStringList(input: HookInput | NormalizedChildForm, name: string): KValue {
  const value = slotValue(input, name);
  if (Array.isArray(value)) return value as unknown as KValue;
  if (value === null) return [] as unknown as KValue;
  return [value] as unknown as KValue;
}

function slotValue(input: HookInput | NormalizedChildForm, name: string): KValue {
  const slotValues = normalizedSlotValues(input.normalizedSlots);
  if (slotValues) {
    const value = slotValues.get(name);
    return value ? slotValueToKValue(value) : null;
  }

  const str = input.normalizedSlots.getString(name);
  if (str !== undefined) return str;

  const sym = input.normalizedSlots.getSymbol(name);
  if (sym !== undefined) return sym;

  const expr = input.normalizedSlots.getExpr(name);
  if (expr !== undefined) return expr as unknown as KValue;

  const list = input.normalizedSlots.getStringList(name);
  if (list.length > 0) return list as unknown as KValue;

  return null;
}

function normalizedSlotValues(
  normalizedSlots: HookInput["normalizedSlots"],
): ReadonlyMap<string, SlotValue> | undefined {
  if (normalizedSlots instanceof SimpleNormalizedSlots) {
    return normalizedSlots.toReadonlyMap();
  }
  if ("toReadonlyMap" in normalizedSlots && typeof normalizedSlots.toReadonlyMap === "function") {
    return normalizedSlots.toReadonlyMap() as ReadonlyMap<string, SlotValue>;
  }
  return undefined;
}

function slotValueToKValue(slotValue: SlotValue): KValue {
  switch (slotValue.kind) {
    case "string":
    case "symbol":
      return slotValue.value;
    case "string-list":
      return slotValue.value as unknown as KValue;
    case "bool":
      return slotValue.value;
    case "expr":
      return slotValue.value as unknown as KValue;
    case "children":
      return slotValue.value as unknown as KValue;
  }
}

function refValue(kind: string, name: string): KValue {
  return new Map<string, KValue>([
    ["kind", kind],
    ["name", name],
  ]) as unknown as KValue;
}

function childForms(
  input: HookInput | NormalizedChildForm,
  name: string,
): readonly NormalizedChildForm[] {
  return input.normalizedSlots.getChildForms(name);
}

function locValue(input: HookInput | NormalizedChildForm): KValue {
  const loc = input.loc;
  return new Map<string, KValue>([
    ["start", loc.start],
    ["end", loc.end],
    ["line", loc.line],
    ["col", loc.col],
  ]) as unknown as KValue;
}

function scalarString(value: KValue): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (isSExprLike(value)) {
    if (value._tag === "Sym" && typeof value.name === "string") return value.name;
    if (value._tag === "Str" && typeof value.value === "string") return value.value;
    if (value._tag === "Num" && typeof value.value === "number") return String(value.value);
    if (value._tag === "Bool" && typeof value.value === "boolean") return String(value.value);
  }
  return undefined;
}

function truthyKValue(value: KValue): boolean {
  return value !== null && value !== false;
}

function isSExprLike(
  value: KValue,
): value is KValue & { readonly _tag: string; readonly name?: string; readonly value?: unknown } {
  return !!value && typeof value === "object" && "_tag" in value;
}

function isKeywordHead(expr: SExpr): boolean {
  return expr._tag === "List" && (headSym(expr)?.startsWith(":") ?? false);
}

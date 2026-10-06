import { normalizeUnifiedForm } from "../surface/form.js";
import type { SExpr, Loc } from "../Reader.js";
import { headSym, tail, trySym, children } from "../SExpr.js";
import type { FormDescriptor, ChildFormShape, IdentifierSpec, SlotSpec } from "./FormDescriptor.js";
import { SimpleNormalizedSlots, type SlotValue } from "./NormalizedSlots.js";
import type { FormDescriptorRegistry } from "./FormDescriptorRegistry.js";
import type { NormalizedChildForm } from "./ElaborationHook.js";
import type { RecognizedForm } from "./recognize.js";

export interface NormalizedForm {
  readonly formName: string;
  readonly descriptor: FormDescriptor;
  readonly identifiers: Map<string, string>;
  readonly slots: SimpleNormalizedSlots;
  readonly loc: Loc;
  readonly rawExpr: SExpr;
}

type ChildShape = ChildFormShape;

export function normalizeForm(
  recognized: RecognizedForm,
  registry?: FormDescriptorRegistry,
): NormalizedForm {
  const { formName, descriptor } = recognized;
  if (descriptor.surface) return normalizeUnifiedForm(descriptor, recognized.expr);
  const expr = recognized.expr;
  const args = tail(expr); // everything after the head symbol

  // Extract identifiers from positional args
  const identifiers = extractIdentifiers(args, descriptor.identifiers);

  // Extract slots from keyword-headed children
  const { values, childForms } = extractSlots(args, formName, descriptor.slots, registry);

  return {
    formName,
    descriptor,
    identifiers,
    slots: new SimpleNormalizedSlots(values, childForms),
    loc: expr.loc,
    rawExpr: expr,
  };
}

// ---------------------------------------------------------------------------
// Identifier extraction
// ---------------------------------------------------------------------------

function extractIdentifiers(
  args: readonly SExpr[],
  specs: readonly IdentifierSpec[],
): Map<string, string> {
  const result = new Map<string, string>();
  let argIdx = 0;

  for (const spec of specs) {
    // Skip keyword-headed args (those are slots)
    while (argIdx < args.length && isKeywordHead(args[argIdx]!)) {
      argIdx++;
    }
    if (argIdx >= args.length) break;

    const arg = args[argIdx]!;
    const value = extractValue(arg, spec.kind);
    if (value !== undefined) {
      result.set(spec.name, value);
    }
    argIdx++;
  }

  return result;
}

function extractValue(expr: SExpr, kind: string): string | undefined {
  switch (kind) {
    case "Symbol":
      return trySym(expr);
    case "String":
      return expr._tag === "Str" ? expr.value : trySym(expr);
    case "Value":
      return expr._tag === "Str"
        ? expr.value
        : (trySym(expr) ?? (expr._tag === "Num" ? String(expr.value) : undefined));
    default:
      return trySym(expr);
  }
}

function isKeywordHead(expr: SExpr): boolean {
  if (expr._tag !== "List") return false;
  const head = headSym(expr);
  return head !== undefined && head.startsWith(":");
}

// ---------------------------------------------------------------------------
// Slot extraction
// ---------------------------------------------------------------------------

function extractSlots(
  args: readonly SExpr[],
  formName: string,
  specs: readonly SlotSpec[],
  registry?: FormDescriptorRegistry,
): {
  readonly values: Map<string, SlotValue>;
  readonly childForms: Map<string, readonly NormalizedChildForm[]>;
} {
  const result = new Map<string, SlotValue>();
  const scalarManyValueSlots = new Set([
    "document-localized:locales",
    "define-document-localized:locales",
    "define-workspace:view",
    "workspace:view",
    "define-task:section",
    "field:bind",
    "page:depends-on",
  ]);
  const specMap = new Map<string, SlotSpec>();
  for (const s of specs) {
    specMap.set(s.name, s);
    // Also register aliases
    if (s.aliases) {
      for (const alias of s.aliases) {
        specMap.set(alias, s);
      }
    }
  }

  for (const arg of args) {
    if (!isKeywordHead(arg)) continue;

    const head = headSym(arg)!;
    const slotName = head.startsWith(":") ? head.slice(1) : head;
    const spec = specMap.get(slotName);
    if (!spec) throw new Error(`Unknown slot :${slotName} in ${formName}`);

    // Use the canonical name from the spec
    const canonicalName = spec.name;
    const slotArgs = tail(arg);

    if (spec.many) {
      if (spec.mode === "form") {
        const existing = result.get(canonicalName);
        if (existing && existing.kind === "children") {
          result.set(canonicalName, { kind: "children", value: [...existing.value, arg] });
        } else {
          result.set(canonicalName, { kind: "children", value: [arg] });
        }
      } else if (spec.mode === "expr") {
        const value =
          slotArgs.length === 1
            ? slotArgs[0]!
            : {
                _tag: "List" as const,
                items: slotArgs,
                loc: arg.loc,
              };
        result.set(canonicalName, { kind: "expr", value });
      } else if (slotArgs.length > 0) {
        if (scalarManyValueSlots.has(`${formName}:${canonicalName}`)) {
          const existingValue = result.get(canonicalName);
          const existing = existingValue?.kind === "string-list" ? [...existingValue.value] : [];
          const values = slotArgs
            .map(
              (value) =>
                trySym(value) ??
                (value._tag === "Str"
                  ? value.value
                  : value._tag === "Num"
                    ? String(value.value)
                    : undefined),
            )
            .filter((value): value is string => value !== undefined);
          result.set(canonicalName, { kind: "string-list", value: [...existing, ...values] });
        } else {
          const existing = result.get(canonicalName);
          if (existing && existing.kind === "children") {
            result.set(canonicalName, { kind: "children", value: [...existing.value, arg] });
          } else {
            result.set(canonicalName, { kind: "children", value: [arg] });
          }
        }
      }
    } else if (spec.mode === "form") {
      if (slotArgs.length > 0) {
        result.set(canonicalName, { kind: "children", value: slotArgs });
      }
    } else if (spec.mode === "expr") {
      // Expr slots may hold one expression or a sequence of sections.
      if (slotArgs.length === 1) {
        result.set(canonicalName, { kind: "expr", value: slotArgs[0]! });
      } else if (slotArgs.length > 1) {
        result.set(canonicalName, {
          kind: "expr",
          value: {
            _tag: "List",
            items: slotArgs,
            loc: arg.loc,
          },
        });
      }
    } else {
      // value mode -- extract string/symbol
      if (slotArgs.length > 0) {
        const val = slotArgs[0]!;
        if (val._tag === "Vector") {
          // Vector of strings/symbols
          const items = children(val)
            .map((c) => trySym(c) ?? (c._tag === "Str" ? c.value : ""))
            .filter(Boolean);
          result.set(canonicalName, { kind: "string-list", value: items as string[] });
        } else {
          result.set(canonicalName, scalarSlotValue(val));
        }
      }
    }
  }

  const childForms = new Map<string, readonly NormalizedChildForm[]>();
  for (const [slotName, value] of result) {
    if (value.kind !== "children") continue;
    const slotSpec = specs.find((spec) => spec.name === slotName);
    const normalized = value.value
      .map((expr) => normalizeChildForm(slotSpec, slotName, expr, registry))
      .filter((child): child is NormalizedChildForm => child !== undefined);
    if (normalized.length > 0) {
      childForms.set(slotName, normalized);
    }
  }

  return { values: result, childForms };
}

function scalarSlotValue(expr: SExpr): SlotValue {
  const sym = trySym(expr);
  if (sym !== undefined) {
    return { kind: "symbol", value: sym };
  }
  switch (expr._tag) {
    case "Str":
      return { kind: "string", value: expr.value };
    case "Num":
      return { kind: "string", value: String(expr.value) };
    case "Bool":
      return { kind: "bool", value: expr.value };
    default:
      return { kind: "expr", value: expr };
  }
}

function normalizeChildForm(
  slotSpec: SlotSpec | undefined,
  slotName: string,
  expr: SExpr,
  registry?: FormDescriptorRegistry,
): NormalizedChildForm | undefined {
  const resolved = resolveChildShape(slotSpec, slotName, expr, registry);
  if (!resolved) return undefined;

  const identifiers = extractIdentifiers(resolved.args, resolved.shape.identifiers);
  const { values, childForms } = extractSlots(
    resolved.args,
    resolved.shape.formName,
    resolved.shape.slots,
    registry,
  );

  if (resolved.shape.positionalSlots && resolved.shape.positionalSlots.length > 0) {
    const positionalArgs = collectNonKeywordArgs(resolved.args);
    const identifierCount = resolved.shape.identifiers.length;
    resolved.shape.positionalSlots.forEach((slotKey, index) => {
      const value = positionalArgs[identifierCount + index];
      if (value) {
        values.set(slotKey, scalarSlotValue(value));
      }
    });
  }

  for (const item of resolved.args) {
    if (item._tag !== "Map") continue;
    for (const [key, value] of item.pairs) {
      const keyStr = key._tag === "Sym" ? key.name : undefined;
      if (!keyStr) continue;
      const canonicalKey = keyStr.startsWith(":") ? keyStr.slice(1) : keyStr;
      if (!resolved.shape.slots.some(s => s.name === canonicalKey || s.aliases?.includes(canonicalKey))) throw new Error(`Unknown option :${canonicalKey} in ${resolved.shape.formName}`);
      values.set(canonicalKey, scalarSlotValue(value));
    }
  }

  return {
    formName: resolved.shape.formName,
    descriptor: resolved.descriptor,
    identifiers,
    normalizedSlots: new SimpleNormalizedSlots(values, childForms),
    loc: resolved.rawExpr.loc,
    rawExpr: resolved.rawExpr,
  };
}

function resolveChildShape(
  slotSpec: SlotSpec | undefined,
  slotName: string,
  expr: SExpr,
  registry?: FormDescriptorRegistry,
):
  | {
      readonly shape: ChildShape;
      readonly descriptor: FormDescriptor;
      readonly args: readonly SExpr[];
      readonly rawExpr: SExpr;
    }
  | undefined {
  if (expr._tag === "List") {
    const directHead = headSym(expr);
    if (directHead && !directHead.startsWith(":")) {
      const descriptor = registry?.get(directHead);
      if (descriptor) {
        return {
          shape: descriptorToChildShape(directHead, descriptor),
          descriptor,
          args: tail(expr),
          rawExpr: expr,
        };
      }
    }

    const keywordArgs = tail(expr);
    const nonKeyword = collectNonKeywordArgs(keywordArgs);
    if (
      nonKeyword.length === 1 &&
      nonKeyword[0]!._tag === "List" &&
      headSym(nonKeyword[0]!) &&
      !headSym(nonKeyword[0]!)!.startsWith(":")
    ) {
      const nested = nonKeyword[0]!;
      const nestedHead = headSym(nested)!;
      const descriptor = registry?.get(nestedHead);
      if (descriptor) {
        return {
          shape: descriptorToChildShape(nestedHead, descriptor),
          descriptor,
          args: tail(nested),
          rawExpr: nested,
        };
      }
    }

    const syntheticShape = slotSpec?.childShape;
    if (syntheticShape) {
      const syntheticDescriptor: FormDescriptor = {
        name: syntheticShape.formName,
        phase: "domain",
        identifiers: syntheticShape.identifiers,
        slots: syntheticShape.slots,
        bindings: { kind: "none" },
        validation: { kind: "none" },
        elaboration: { kind: "none" },
        resultType: { kind: "none" },
      };
      return {
        shape: syntheticShape,
        descriptor: syntheticDescriptor,
        args: childArgs(expr),
        rawExpr: expr,
      };
    }

    const descriptor = registry?.get(slotName);
    if (descriptor) {
      return {
        shape: descriptorToChildShape(slotName, descriptor),
        descriptor,
        args: keywordArgs,
        rawExpr: expr,
      };
    }
  }

  return undefined;
}

function descriptorToChildShape(formName: string, descriptor: FormDescriptor): ChildShape {
  return {
    formName,
    identifiers: descriptor.identifiers,
    slots: descriptor.slots,
  };
}

function collectNonKeywordArgs(args: readonly SExpr[]): readonly SExpr[] {
  return args.filter((item) => !isKeywordHead(item));
}

function childArgs(expr: SExpr): readonly SExpr[] {
  if (expr._tag === "Vector") {
    return expr.items;
  }
  if (expr._tag !== "List") {
    return [expr];
  }

  const rawArgs = tail(expr);
  const nonKeyword = collectNonKeywordArgs(rawArgs);
  if (nonKeyword.length === 1 && nonKeyword[0]!._tag === "Vector") {
    return nonKeyword[0]!.items;
  }
  return rawArgs;
}

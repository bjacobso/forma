/**
 * Meta-builtins — helper vocabulary available inside meta-fn bodies.
 *
 * These functions operate on KValue representations of HookInput, BindingMap,
 * Type, Diagnostic, etc. The HookInput is passed as a KMap
 * (ReadonlyMap<string, KValue>), and these builtins extract fields from it.
 *
 * All builtins match the BuiltinFn signature:
 *   (args: readonly KValue[], apply: (...) => Effect<KValue, KernelError>) => Effect<KValue, KernelError>
 *
 * @module meta-builtins
 */

import { Effect } from "effect";
import type { BuiltinFn } from "../evaluator/types.js";
import type { KValue } from "../evaluator/types.js";
import type { SemanticEnvironment, NormalizedChildForm } from "./ElaborationHook.js";
import type { FormDescriptor, IdentifierSpec } from "./FormDescriptor.js";
import { headSym, tail, type SExpr } from "../reader/types.js";
import { showType, type Row, type Type, TCon, TApp, TRow, REmpty, RExtend } from "../type/types.js";
import { SimpleNormalizedSlots, type SlotValue } from "./NormalizedSlots.js";
import { typeCheckDescriptorTree } from "./descriptor-tree-check.js";
import { normalizeRuntimeExprObject, runtimeExpr } from "./runtime-expr.js";
import {
  buildDescriptorTreeLayoutAliases,
  rewriteDescriptorTreeLayoutAliases,
} from "./descriptor-tree-aliases.js";
import { findDescriptorTreeProtocolRegistry } from "./descriptor-tree-metadata.js";

export type HostedMetaBuiltinsFactory = (
  semanticEnv: SemanticEnvironment,
  context: MetaBuiltinsContext,
) => Record<string, BuiltinFn>;

export interface HostedDslMetaContext {
  readonly name: string;
  readonly descriptors: readonly FormDescriptor[];
}

export interface MetaBuiltinsContext {
  readonly hostedDsls: ReadonlyMap<string, HostedDslMetaContext>;
}

export interface MetaBuiltinsOptions {
  readonly hostedBuiltins?: Record<string, BuiltinFn>;
  readonly hostedDsls?: ReadonlyMap<string, HostedDslMetaContext>;
}

export function createMetaBuiltins(
  semanticEnv: SemanticEnvironment,
  options: MetaBuiltinsOptions | Record<string, BuiltinFn> = {},
): Record<string, BuiltinFn> {
  const metaOptions = isMetaBuiltinsOptions(options) ? options : {};
  const hostedBuiltins = isMetaBuiltinsOptions(options) ? (options.hostedBuiltins ?? {}) : options;
  const hostedDsls = metaOptions.hostedDsls ?? new Map<string, HostedDslMetaContext>();

  // Strip leading ":" from keyword slot names (e.g., ":from" → "from")
  function normalizeSlotName(name: KValue | undefined): string {
    if (name === undefined || name === null) return "";
    const s = String(name);
    return s.startsWith(":") ? s.slice(1) : s;
  }

  function typeToKValue(type: Type): KValue {
    switch (type._tag) {
      case "TCon":
        return new Map<string, KValue>([
          ["_type", "constant"],
          ["name", type.name],
        ]) as unknown as KValue;
      case "TApp":
        if (type.con._tag === "TCon" && type.con.name === "List" && type.args[0]) {
          return new Map<string, KValue>([
            ["_type", "list"],
            ["element", typeToKValue(type.args[0])],
          ]) as unknown as KValue;
        }
        return new Map<string, KValue>([
          ["_type", "unknown"],
          ["name", "Unknown"],
        ]) as unknown as KValue;
      case "TRow":
        return rowTypeToKValue(type.row);
      default:
        return new Map<string, KValue>([["_type", "unknown"]]) as unknown as KValue;
    }
  }

  function isType(value: unknown): value is Type {
    return (
      !!value &&
      typeof value === "object" &&
      "_tag" in value &&
      typeof (value as { _tag?: unknown })._tag === "string"
    );
  }

  function rowTypeToKValue(row: Row): KValue {
    const fields = new Map<string, KValue>();
    let cursor: Row = row;
    while (cursor._tag === "RExtend") {
      fields.set(cursor.label, typeToKValue(cursor.type));
      cursor = cursor.tail;
    }

    return new Map<string, KValue>([
      ["_type", "row"],
      ["fields", fields as unknown as KValue],
      ["open", cursor._tag !== "REmpty"],
    ]) as unknown as KValue;
  }

  function declarationKind(name: string, formName: string): string {
    const fact = semanticEnv.getFact("declaration-kind", name);
    return typeof fact === "string" ? fact : formName;
  }

  function declarationFieldsFromRowType(type: Type | undefined): Map<string, KValue> | null {
    if (!type || type._tag !== "TRow") return null;
    const rowValue = rowTypeToKValue(type.row);
    if (!(rowValue instanceof Map)) return null;
    const fields = rowValue.get("fields");
    if (!(fields instanceof Map)) return null;
    return new Map(fields as ReadonlyMap<string, KValue>);
  }

  function lookupField(
    fields: ReadonlyMap<string, KValue>,
    name: string,
  ): readonly [string, KValue] | undefined {
    const direct = fields.get(name);
    if (direct !== undefined) return [name, direct] as const;
    const prefixed = name.startsWith(":") ? name : `:${name}`;
    const prefixedValue = fields.get(prefixed);
    if (prefixedValue !== undefined) return [prefixed, prefixedValue] as const;
    const stripped = name.replace(/^:/, "");
    for (const [fieldName, fieldType] of fields.entries()) {
      if (fieldName.replace(/^:/, "") === stripped) {
        return [fieldName, fieldType] as const;
      }
    }
    return undefined;
  }

  function declarationFieldsFromSemanticFacts(name: string): Map<string, KValue> | null {
    const typedFact =
      semanticEnv.getFact("declaration-row-type", name) ??
      semanticEnv.getFact("binding-type", name);
    return isType(typedFact) ? declarationFieldsFromRowType(typedFact) : null;
  }

  function declarationToKValue(name: string): KValue | null {
    const declared = semanticEnv.getDeclaredNames().get(name);
    if (!declared) return null;
    const declaredType =
      declared.type ??
      (() => {
        const fact = semanticEnv.getFact("binding-type", name);
        return isType(fact) ? fact : undefined;
      })();
    const fields =
      declarationFieldsFromRowType(declaredType) ?? declarationFieldsFromSemanticFacts(name);
    return new Map<string, KValue>([
      ["kind", declarationKind(declared.name, declared.formName)],
      ["name", declared.name],
      ...(declaredType ? ([["type", typeToKValue(declaredType)]] as const) : []),
      ...(fields ? ([["fields", fields as unknown as KValue]] as const) : []),
    ]) as unknown as KValue;
  }

  function declarationFieldsFromInput(
    input: ReadonlyMap<string, KValue>,
  ): Map<string, KValue> | null {
    const normalized = input.get("normalizedForm");
    if (
      !(normalized && typeof normalized === "object" && "getChildForms" in (normalized as object))
    ) {
      return null;
    }

    const fieldForms = (
      normalized as unknown as { getChildForms(name: string): readonly NormalizedChildForm[] }
    ).getChildForms("field");
    const fields = new Map<string, KValue>();
    for (const field of fieldForms) {
      const name = field.identifiers.get("name");
      const expr = field.normalizedSlots.getExpr("type");
      if (!name || !expr) continue;
      const inferred = semanticEnv.inferExpressionType(expr);
      if (inferred) {
        fields.set(name, typeToKValue(inferred));
      }
    }
    return fields;
  }

  function declarationFields(value: KValue | undefined): Map<string, KValue> | null {
    if (value instanceof Map) {
      const explicitFields = value.get("fields");
      if (explicitFields instanceof Map) {
        return new Map(explicitFields as ReadonlyMap<string, KValue>);
      }
      if (value.has("normalizedForm")) {
        return declarationFieldsFromInput(value as ReadonlyMap<string, KValue>);
      }
    }
    return null;
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

  function normalizedChildToKValue(child: NormalizedChildForm): KValue {
    const identifiers = new Map<string, KValue>();
    for (const [key, value] of child.identifiers) {
      identifiers.set(key, value);
    }
    const positionalArgs = nonKeywordPositionalArgs(child.rawExpr);
    for (const [index, spec] of child.descriptor.identifiers.entries()) {
      const identifierSpec = spec as IdentifierSpec;
      if (identifiers.has(identifierSpec.name)) continue;
      const value = positionalArgs[index]
        ? identifierValueToKValue(positionalArgs[index]!, identifierSpec.kind)
        : null;
      if (value !== null) identifiers.set(identifierSpec.name, value);
    }

    const slots = new Map<string, KValue>();
    const slotValues = normalizedSlotValues(child.normalizedSlots);
    if (slotValues) {
      for (const [key, value] of slotValues) {
        slots.set(key, slotValueToKValue(value));
      }
    }

    return new Map<string, KValue>([
      ["formName", child.formName],
      ["descriptorRef", child.descriptor as unknown as KValue],
      ["identifiers", identifiers as unknown as KValue],
      ["slots", slots as unknown as KValue],
      ["normalizedForm", child.normalizedSlots as unknown as KValue],
      ["loc", child.loc as unknown as KValue],
      ["rawExpr", child.rawExpr as unknown as KValue],
    ]) as unknown as KValue;
  }

  function normalizedSlotValues(
    normalizedSlots: NormalizedChildForm["normalizedSlots"],
  ): ReadonlyMap<string, SlotValue> | undefined {
    if (normalizedSlots instanceof SimpleNormalizedSlots) {
      return normalizedSlots.toReadonlyMap();
    }
    if ("toReadonlyMap" in normalizedSlots && typeof normalizedSlots.toReadonlyMap === "function") {
      return normalizedSlots.toReadonlyMap() as ReadonlyMap<string, SlotValue>;
    }
    return undefined;
  }

  function nonKeywordPositionalArgs(rawExpr: SExpr): readonly SExpr[] {
    if (rawExpr._tag !== "List") return [];
    return tail(rawExpr).filter((item) => {
      if (item._tag !== "List") return true;
      const head = headSym(item);
      return head === undefined || !head.startsWith(":");
    });
  }

  function identifierValueToKValue(expr: SExpr, kind: string): KValue | null {
    switch (kind) {
      case "Symbol":
        return expr._tag === "Sym" ? expr.name : null;
      case "String":
        if (expr._tag === "Str") return expr.value;
        if (expr._tag === "Sym") return expr.name;
        return null;
      case "Value":
        switch (expr._tag) {
          case "Str":
            return expr.value;
          case "Num":
            return expr.value;
          case "Bool":
            return expr.value;
          case "Sym":
            return expr.name;
          default:
            return expr as unknown as KValue;
        }
      default:
        return expr._tag === "Sym" ? expr.name : null;
    }
  }

  function normalizeTypeName(name: string): string {
    switch (name) {
      case "Bool":
        return "Boolean";
      case "Str":
        return "String";
      case "Num":
        return "Number";
      case "Nil":
        return "Unit";
      default:
        return name;
    }
  }

  function kValueToType(value: KValue | undefined): Type | undefined {
    if (!(value instanceof Map)) return undefined;
    const kind = value.get("_type");
    switch (kind) {
      case "constant": {
        const name = value.get("name");
        return typeof name === "string" ? TCon(name) : undefined;
      }
      case "list": {
        const element = kValueToType(value.get("element"));
        return element ? TApp(TCon("List"), [element]) : undefined;
      }
      case "row": {
        const fields = value.get("fields");
        if (!(fields instanceof Map)) return undefined;
        let row: Row = REmpty;
        const entries = [...(fields as ReadonlyMap<string, KValue>).entries()].reverse();
        for (const [label, fieldType] of entries) {
          const normalizedLabel = typeof label === "string" ? label : String(label);
          row = RExtend(normalizedLabel, kValueToType(fieldType) ?? TCon("Unknown"), row);
        }
        return TRow(row);
      }
      default:
        return undefined;
    }
  }

  function targetTypeName(value: KValue | undefined): string | undefined {
    if (typeof value === "string") return normalizeTypeName(value);
    const type = kValueToType(value);
    return type ? showType(type) : undefined;
  }

  function isAssignableToType(expr: KValue | undefined, targetType: KValue | undefined): boolean {
    if (!expr || typeof expr !== "object" || !("_tag" in expr)) return false;
    const inferred = semanticEnv.inferExpressionType(expr as unknown as SExpr);
    if (!inferred) return false;
    const expected = targetTypeName(targetType);
    return expected !== undefined && showType(inferred) === expected;
  }

  return {
    // =========================================================================
    // meta/* — input accessors
    // =========================================================================

    "meta/declaration-name": (args) =>
      Effect.succeed(
        (() => {
          const input = args[0] as ReadonlyMap<string, KValue> | null;
          if (!(input instanceof Map)) return null;
          const identifiers = input.get("identifiers") as ReadonlyMap<string, KValue> | undefined;
          if (!(identifiers instanceof Map)) return null;
          return identifiers.get("name") ?? null;
        })(),
      ),

    "meta/slot-symbol": (args) =>
      Effect.succeed(
        (() => {
          const input = args[0] as ReadonlyMap<string, KValue> | null;
          if (!(input instanceof Map)) return null;
          const slotName = normalizeSlotName(args[1]);
          const slots = input.get("slots") as ReadonlyMap<string, KValue> | undefined;
          if (!(slots instanceof Map)) return null;
          const value = slots.get(slotName);
          if (typeof value === "string") return value;
          if (value && typeof value === "object" && "_tag" in value && value._tag === "Sym") {
            return value.name;
          }
          return value ?? null;
        })(),
      ),

    "meta/slot-string": (args) =>
      Effect.succeed(
        (() => {
          const input = args[0] as ReadonlyMap<string, KValue> | null;
          if (!(input instanceof Map)) return null;
          const slotName = normalizeSlotName(args[1]);
          const slots = input.get("slots") as ReadonlyMap<string, KValue> | undefined;
          if (!(slots instanceof Map)) return null;
          const value = slots.get(slotName);
          if (typeof value === "string") return value;
          if (value && typeof value === "object" && "_tag" in value) {
            if (value._tag === "Sym") return value.name;
            if (value._tag === "Str") return value.value;
            if (value._tag === "Num") return String(value.value);
          }
          return value ?? null;
        })(),
      ),

    "meta/slot-string-list": (args) =>
      Effect.succeed(
        (() => {
          const input = args[0] as ReadonlyMap<string, KValue> | null;
          if (!(input instanceof Map)) return null;
          const slotName = normalizeSlotName(args[1]);
          const slots = input.get("slots") as ReadonlyMap<string, KValue> | undefined;
          if (!(slots instanceof Map)) return null;
          const val = slots.get(slotName);
          return Array.isArray(val) ? val : [];
        })(),
      ),

    "meta/slot-value": (args) =>
      Effect.succeed(
        (() => {
          function toLiteralValue(value: KValue): KValue {
            if (value === null || value === undefined) return null;
            if (typeof value === "string") {
              if (value === "nil" || value === "null") return null;
              if (value === "true") return true;
              if (value === "false") return false;
              return value;
            }
            if (typeof value === "number" || typeof value === "boolean") return value;

            const sexpr = value as unknown as SExpr;
            if (!sexpr || typeof sexpr !== "object" || !("_tag" in sexpr)) return value;

            switch (sexpr._tag) {
              case "Str":
                return sexpr.value;
              case "Num":
                return sexpr.value;
              case "Bool":
                return sexpr.value;
              case "Sym": {
                const name = sexpr.name.replace(/^:/, "");
                if (name === "nil" || name === "null") return null;
                if (name === "true") return true;
                if (name === "false") return false;
                return name;
              }
              case "Vector":
                return sexpr.items.map((item) => toLiteralValue(item as unknown as KValue));
              case "Map": {
                const result = new Map<string, KValue>();
                for (const [key, nested] of sexpr.pairs) {
                  const keyStr =
                    key._tag === "Sym"
                      ? key.name.replace(/^:/, "")
                      : String(toLiteralValue(key as unknown as KValue));
                  result.set(keyStr, toLiteralValue(nested as unknown as KValue));
                }
                return result as unknown as KValue;
              }
              default:
                return value;
            }
          }

          const input = args[0] as ReadonlyMap<string, KValue> | null;
          if (!(input instanceof Map)) return null;
          const slotName = normalizeSlotName(args[1]);
          const slots = input.get("slots") as ReadonlyMap<string, KValue> | undefined;
          if (!(slots instanceof Map)) return null;
          const value = slots.get(slotName);
          return value === undefined ? null : toLiteralValue(value);
        })(),
      ),

    "meta/form-name": (args) =>
      Effect.succeed(
        (() => {
          const input = args[0] as ReadonlyMap<string, KValue> | null;
          if (!(input instanceof Map)) return null;
          return input.get("formName") ?? null;
        })(),
      ),

    "meta/loc": (args) =>
      Effect.succeed(
        (() => {
          const input = args[0] as ReadonlyMap<string, KValue> | null;
          if (!(input instanceof Map)) return null;
          return input.get("loc") ?? null;
        })(),
      ),

    // =========================================================================
    // bindings/* — binding constructors
    // =========================================================================

    "bindings/empty": () => Effect.succeed(new Map<string, KValue>() as unknown as KValue),

    "bindings/of": (args) =>
      Effect.succeed(
        (() => {
          const bindings = new Map<string, KValue>();
          for (const arg of args) {
            if (Array.isArray(arg) && arg.length >= 2) {
              const name = arg[0] as string;
              const type = arg[1] as KValue;
              bindings.set(name, type);
            }
          }
          return bindings as unknown as KValue;
        })(),
      ),

    "bindings/merge": (args) =>
      Effect.succeed(
        (() => {
          const merged = new Map<string, KValue>();
          for (const arg of args) {
            if (arg instanceof Map) {
              for (const [k, v] of arg as Map<string, KValue>) {
                merged.set(k, v);
              }
            }
          }
          return merged as unknown as KValue;
        })(),
      ),

    "bindings/from-declaration": (args) =>
      Effect.succeed(
        (() => {
          const name = typeof args[0] === "string" ? args[0] : null;
          const type = args[1] as KValue | undefined;
          const bindings = new Map<string, KValue>();
          if (name && type !== undefined) {
            bindings.set(name, type);
          }
          return bindings as unknown as KValue;
        })(),
      ),

    "bindings/from-fields": (args) =>
      Effect.succeed(
        (() => {
          const prefix = typeof args[0] === "string" ? args[0] : "";
          const fields = args[1];
          const bindings = new Map<string, KValue>();
          if (!(fields instanceof Map)) return bindings as unknown as KValue;
          for (const [name, type] of fields as ReadonlyMap<string, KValue>) {
            bindings.set(`${prefix}${String(name).replace(/^:/, "")}`, type);
          }
          return bindings as unknown as KValue;
        })(),
      ),

    "bindings/when": (args) =>
      Effect.succeed(
        (() => {
          const condition = args[0];
          const bindings = args[1];
          if (!condition || !(bindings instanceof Map)) {
            return new Map<string, KValue>() as unknown as KValue;
          }
          return bindings as unknown as KValue;
        })(),
      ),

    // =========================================================================
    // type/* — type constructors (return KMap representations)
    // =========================================================================

    "type/unknown": () =>
      Effect.succeed(new Map<string, KValue>([["_type", "unknown"]]) as unknown as KValue),

    "type/constant": (args) =>
      Effect.succeed(
        (() => {
          const name = args[0] as string;
          return new Map<string, KValue>([
            ["_type", "constant"],
            ["name", name],
          ]) as unknown as KValue;
        })(),
      ),

    "type/list": (args) =>
      Effect.succeed(
        (() => {
          const elementType = args[0] as KValue;
          return new Map<string, KValue>([
            ["_type", "list"],
            ["element", elementType],
          ]) as unknown as KValue;
        })(),
      ),

    // =========================================================================
    // diag/* — diagnostic constructors
    // =========================================================================

    "diag/error": (args) =>
      Effect.succeed(
        (() => {
          const diag = new Map<string, KValue>();
          diag.set("severity", "error");
          for (let i = 0; i < args.length; i += 2) {
            const key = args[i] as string;
            const val = args[i + 1] as KValue;
            if (key === ":message") diag.set("message", val);
            if (key === ":slot") diag.set("slot", val);
            if (key === ":form") diag.set("form", val);
          }
          return diag as unknown as KValue;
        })(),
      ),

    "diag/concat": (args) =>
      Effect.succeed(
        (() => {
          const result: KValue[] = [];
          for (const arg of args) {
            if (Array.isArray(arg)) result.push(...arg);
            else if (arg instanceof Map) result.push(arg as unknown as KValue);
          }
          return result;
        })(),
      ),

    // =========================================================================
    // construct/* — IR constructors
    // =========================================================================

    "construct/object": (args) => Effect.succeed(constructObject(args)),
    // Aliases kept for parity with the OCaml engine; both build the same keyword map.
    "construct/query": (args) => Effect.succeed(constructObject(args)),
    "construct/declaration": (args) => Effect.succeed(constructObject(args)),

    "construct/summary": (args) =>
      Effect.succeed(
        (() => {
          const obj = new Map<string, KValue>();
          for (let i = 0; i < args.length; i += 2) {
            const key = args[i] as string;
            const val = args[i + 1] as KValue;
            if (typeof key === "string") {
              if (key.startsWith(":")) obj.set(key.slice(1), val);
              else obj.set(key, val);
            }
          }
          return obj as unknown as KValue;
        })(),
      ),

    "construct/assoc": (args) =>
      Effect.succeed(
        (() => {
          const base = args[0];
          const key = args[1];
          const value = args[2] as KValue;
          const result = new Map<string, KValue>();
          if (base instanceof Map) {
            for (const [existingKey, existingValue] of base.entries()) {
              result.set(existingKey, existingValue);
            }
          }
          const keyString =
            typeof key === "string" ? key.replace(/^:/, "") : String(key ?? "").replace(/^:/, "");
          result.set(keyString, value);
          return result as unknown as KValue;
        })(),
      ),

    // =========================================================================
    // Predicate helpers
    // =========================================================================

    "nil?": (args) => Effect.succeed(args[0] === null || args[0] === undefined),

    "empty?": (args) =>
      Effect.succeed(
        (() => {
          const val = args[0];
          if (Array.isArray(val)) return val.length === 0;
          if (val instanceof Map) return val.size === 0;
          return val === null || val === undefined;
        })(),
      ),

    "set/contains?": (args) =>
      Effect.succeed(
        (() => {
          const set = args[0];
          const val = args[1];
          if (set instanceof Map) return set.has(val as string);
          if (Array.isArray(set)) return set.includes(val);
          return false;
        })(),
      ),

    // =========================================================================
    // meta/* — additional input accessors
    // =========================================================================

    "meta/slot-ref": (args) =>
      Effect.succeed(
        (() => {
          const input = args[0] as ReadonlyMap<string, KValue> | null;
          if (!(input instanceof Map)) return null;
          const slotName = normalizeSlotName(args[1]);
          const slots = input.get("slots") as ReadonlyMap<string, KValue> | undefined;
          if (!(slots instanceof Map)) return null;
          const val = slots.get(slotName);
          if (typeof val !== "string") return null;
          const declarationKind = (args[2] as string) ?? "unknown";
          return new Map<string, KValue>([
            ["kind", declarationKind],
            ["name", val],
          ]) as unknown as KValue;
        })(),
      ),

    "meta/slot-runtime-expr": (args) =>
      Effect.succeed(
        (() => {
          const input = args[0] as ReadonlyMap<string, KValue> | null;
          if (!(input instanceof Map)) return null;
          const slotName = normalizeSlotName(args[1]);
          const slots = input.get("slots") as ReadonlyMap<string, KValue> | undefined;
          if (!(slots instanceof Map)) return null;
          return runtimeExpr(slots.get(slotName));
        })(),
      ),

    "meta/slot-expr": (args) =>
      Effect.succeed(
        (() => {
          const input = args[0] as ReadonlyMap<string, KValue> | null;
          if (!(input instanceof Map)) return null;
          const slotName = normalizeSlotName(args[1]);
          const slots = input.get("slots") as ReadonlyMap<string, KValue> | undefined;
          if (!(slots instanceof Map)) return null;
          return slots.get(slotName) ?? null;
        })(),
      ),

    "meta/descriptor": (args) =>
      Effect.succeed(
        (() => {
          const input = args[0] as ReadonlyMap<string, KValue> | null;
          if (!(input instanceof Map)) return null;
          return input.get("descriptor") ?? null;
        })(),
      ),

    "meta/normalized-form": (args) =>
      Effect.succeed(
        (() => {
          const input = args[0] as ReadonlyMap<string, KValue> | null;
          if (!(input instanceof Map)) return null;
          return input.get("normalizedForm") ?? null;
        })(),
      ),

    "meta/semantic-env": (args) =>
      Effect.succeed(
        (() => {
          const input = args[0] as ReadonlyMap<string, KValue> | null;
          if (!(input instanceof Map)) return null;
          return input.get("semanticEnv") ?? null;
        })(),
      ),

    "meta/declared-type": (args) =>
      Effect.succeed(
        (() => {
          const name = normalizeSlotName(args[1]);
          if (!name) return null;
          const declared = semanticEnv.getDeclaredNames().get(name);
          if (!declared?.type) return null;
          return typeToKValue(declared.type);
        })(),
      ),

    "meta/lookup-declaration": (args) =>
      Effect.succeed(
        (() => {
          const name = normalizeSlotName(args[1]);
          return name ? declarationToKValue(name) : null;
        })(),
      ),

    "meta/declaration-fields": (args) =>
      Effect.succeed(declarationFields(args[0]) as unknown as KValue),

    "meta/declaration-field": (args) =>
      Effect.succeed(
        (() => {
          const fields = declarationFields(args[0]);
          const name = normalizeSlotName(args[1]);
          if (!fields || !name) return null;
          const entry = lookupField(fields, name);
          if (!entry) return null;
          const [resolvedName, type] = entry;
          return new Map<string, KValue>([
            ["kind", "Field"],
            ["name", resolvedName],
            ["type", type],
          ]) as unknown as KValue;
        })(),
      ),

    "meta/declaration-type": (args) =>
      Effect.succeed(
        (() => {
          const target = args[0];
          if (!(target instanceof Map)) return null;
          const fields = declarationFields(target);
          if (fields) {
            return new Map<string, KValue>([
              ["_type", "row"],
              ["fields", fields as unknown as KValue],
              ["open", false],
            ]) as unknown as KValue;
          }
          if (target.has("type")) return target.get("type") ?? null;
          return null;
        })(),
      ),

    "meta/project-type": (args) =>
      Effect.succeed(
        (() => {
          const fields = declarationFields(args[0]);
          const requested = Array.isArray(args[1]) ? args[1] : [];
          if (!fields) return null;
          const projected = new Map<string, KValue>();
          for (const field of requested) {
            if (typeof field !== "string") continue;
            const entry = lookupField(fields, field);
            if (entry !== undefined) {
              projected.set(field, entry[1]);
            }
          }
          return new Map<string, KValue>([
            ["_type", "row"],
            ["fields", projected as unknown as KValue],
            ["open", false],
          ]) as unknown as KValue;
        })(),
      ),

    "meta/expr-type": (args) =>
      Effect.succeed(
        (() => {
          const expr = args[1];
          if (!expr || typeof expr !== "object" || !("_tag" in expr)) return null;
          const inferred = semanticEnv.inferExpressionType(expr as unknown as SExpr);
          return inferred ? typeToKValue(inferred) : null;
        })(),
      ),

    "meta/expr-assignable-to?": (args) =>
      Effect.succeed(
        (() => {
          const expr = args[1] as KValue | undefined;
          const targetType = args[2] as KValue | undefined;
          return isAssignableToType(expr, targetType);
        })(),
      ),

    // =========================================================================
    // construct/* — additional IR constructors
    // =========================================================================

    "construct/from-descriptor": (args) =>
      Effect.succeed(
        (() => {
          const obj = new Map<string, KValue>();
          for (let i = 0; i < args.length; i += 2) {
            const key = args[i] as string;
            const val = args[i + 1] as KValue;
            if (typeof key === "string") {
              if (key.startsWith(":")) obj.set(key.slice(1), val);
              else obj.set(key, val);
            }
          }
          return obj as unknown as KValue;
        })(),
      ),

    // =========================================================================
    // String helpers (needed by meta-fn bodies)
    // =========================================================================

    str: (args) =>
      Effect.succeed(
        args
          .map((a) => {
            if (a === null) return "";
            if (typeof a === "string") return a;
            return String(a);
          })
          .join(""),
      ),

    // =========================================================================
    // meta/* — child form and identifier accessors
    // =========================================================================

    "meta/child-forms": (args) =>
      Effect.succeed(
        (() => {
          const input = args[0] as ReadonlyMap<string, KValue> | null;
          if (!(input instanceof Map)) return [];
          const slotName = normalizeSlotName(args[1]);
          const ns = input.get("normalizedForm");
          if (ns && typeof ns === "object" && "getChildForms" in (ns as object)) {
            return (
              (ns as { getChildForms(name: string): readonly NormalizedChildForm[] }).getChildForms(
                slotName,
              ) ?? []
            ).map((child) => normalizedChildToKValue(child)) as KValue;
          }
          return [] as unknown as KValue;
        })(),
      ),

    "meta/child-identifier-set": (args) =>
      Effect.succeed(
        (() => {
          // Returns a set of identifier values from child forms of a slot
          // Used by process/validate: (meta/child-identifier-set input :node :id)
          const input = args[0] as ReadonlyMap<string, KValue> | null;
          if (!(input instanceof Map)) return new Map() as unknown as KValue;
          const slotName = normalizeSlotName(args[1]);
          const identifierName = normalizeSlotName(args[2]);
          const ns = input.get("normalizedForm");
          if (!(ns && typeof ns === "object" && "getChildForms" in (ns as object))) {
            return new Map() as unknown as KValue;
          }

          const identifierSet = new Map<string, KValue>();
          const childForms = (
            ns as { getChildForms(name: string): readonly NormalizedChildForm[] }
          ).getChildForms(slotName);
          for (const child of childForms ?? []) {
            const identifier = child.identifiers.get(identifierName);
            if (typeof identifier === "string") {
              identifierSet.set(identifier, true);
            }
          }

          return identifierSet as unknown as KValue;
        })(),
      ),

    "meta/identifier": (args) =>
      Effect.succeed(
        (() => {
          // Extract an identifier from a form/child node
          const form = args[0] as ReadonlyMap<string, KValue> | null;
          if (!(form instanceof Map)) return null;
          const name = normalizeSlotName(args[1]);
          const identifiers = form.get("identifiers") as ReadonlyMap<string, KValue> | undefined;
          if (identifiers instanceof Map && identifiers.has(name)) {
            return identifiers.get(name) ?? null;
          }
          return null;
        })(),
      ),

    "meta/positional-arg": (args) =>
      Effect.succeed(
        (() => {
          const form = args[0] as ReadonlyMap<string, KValue> | null;
          const index = Number(args[1] ?? -1);
          if (!(form instanceof Map) || !Number.isInteger(index) || index < 0) return null;

          const rawExpr = form.get("rawExpr") as SExpr | undefined;
          if (!rawExpr || rawExpr._tag !== "List") return null;

          const positional = tail(rawExpr).filter((item) => {
            if (item._tag !== "List") return true;
            const head = headSym(item);
            return head === undefined || !head.startsWith(":");
          });

          return (positional[index] ?? null) as unknown as KValue;
        })(),
      ),

    "meta/positional-scalar": (args) =>
      Effect.succeed(
        (() => {
          const form = args[0] as ReadonlyMap<string, KValue> | null;
          const index = Number(args[1] ?? -1);
          if (!(form instanceof Map) || !Number.isInteger(index) || index < 0) return null;

          const rawExpr = form.get("rawExpr") as SExpr | undefined;
          if (!rawExpr || rawExpr._tag !== "List") return null;

          const positional = tail(rawExpr).filter((item) => {
            if (item._tag !== "List") return true;
            const head = headSym(item);
            return head === undefined || !head.startsWith(":");
          });

          const value = positional[index];
          if (!value) return null;

          switch (value._tag) {
            case "Str":
              return value.value;
            case "Num":
              return value.value;
            case "Bool":
              return value.value;
            case "Sym":
              return value.name;
            default:
              return null;
          }
        })(),
      ),

    // =========================================================================
    // diag/* — diagnostic validators
    // =========================================================================

    "diag/validate-membership-list": (args) =>
      Effect.succeed(
        (() => {
          // Check that all values in a list are members of an allowed set
          const values = args[0];
          const allowed = args[1];
          const diagnostics: KValue[] = [];
          if (!Array.isArray(values)) return diagnostics;
          const allowedSet =
            allowed instanceof Map ? allowed : new Set(Array.isArray(allowed) ? allowed : []);
          for (const val of values) {
            const isAllowed =
              allowedSet instanceof Map
                ? allowedSet.has(val as string)
                : (allowedSet as Set<KValue>).has(val);
            if (!isAllowed) {
              const diag = new Map<string, KValue>();
              diag.set("severity", "error");
              diag.set("message", `Value '${String(val)}' is not in the allowed set`);
              diagnostics.push(diag as unknown as KValue);
            }
          }
          return diagnostics;
        })(),
      ),

    "diag/validate-default-in-list": (args) =>
      Effect.succeed(
        (() => {
          // Check that a default value is a member of a list
          const defaultVal = args[0];
          const list = args[1];
          if (defaultVal === null || defaultVal === undefined) return [];
          if (Array.isArray(list) && list.includes(defaultVal)) return [];
          const diag = new Map<string, KValue>();
          diag.set("severity", "error");
          diag.set("message", `Default value '${String(defaultVal)}' is not in the list`);
          return [diag as unknown as KValue];
        })(),
      ),

    // =========================================================================
    // type/* — additional type constructors
    // =========================================================================

    "type/project-row": (args) =>
      Effect.succeed(
        (() => {
          const rowType = args[0];
          const fields = args[1];
          if (!(rowType instanceof Map) || !Array.isArray(fields)) return rowType ?? null;

          const fieldMap = rowType.get("fields");
          if (!(fieldMap instanceof Map)) return rowType as unknown as KValue;

          const projectedFields = new Map<string, KValue>();
          for (const field of fields) {
            const label = String(field);
            const canonicalLabel = label.startsWith(":") ? label : `:${label}`;
            const terminalLabel = canonicalLabel.includes("/")
              ? `:${canonicalLabel.split("/").at(-1)}`
              : canonicalLabel;
            const resolvedKey =
              (fieldMap.has(label) ? label : undefined) ??
              (fieldMap.has(canonicalLabel) ? canonicalLabel : undefined) ??
              (fieldMap.has(terminalLabel) ? terminalLabel : undefined) ??
              [...fieldMap.keys()].find((key) => {
                if (typeof key !== "string") return false;
                if (!key.includes("/")) return false;
                return key.split("/").at(-1) === terminalLabel.slice(1);
              });
            if (resolvedKey !== undefined) {
              projectedFields.set(resolvedKey, fieldMap.get(resolvedKey) as KValue);
            }
          }

          return new Map<string, KValue>([
            ["_type", "row"],
            ["fields", projectedFields as unknown as KValue],
            ["open", false],
          ]) as unknown as KValue;
        })(),
      ),

    "meta/validate-descriptor-tree": (args) =>
      Effect.succeed(
        (() => {
          const hostedDslName = typeof args[0] === "string" ? args[0] : undefined;
          if (!hostedDslName) return [];

          const explicitExtensionKey = typeof args[1] === "string" ? args[1] : undefined;
          const layoutArgIndex = explicitExtensionKey ? 2 : 1;
          const layoutExpr = args[layoutArgIndex] as unknown as SExpr | undefined;
          if (!layoutExpr || !("_tag" in layoutExpr)) return [];

          const hostedDsl = hostedDsls.get(hostedDslName);
          if (!hostedDsl) {
            return [
              diagnosticKValue(
                "error",
                `Unknown hosted DSL '${hostedDslName}'. Registered hosted DSLs: ${[...hostedDsls.keys()].join(", ") || "(none)"}`,
              ),
            ] as unknown as KValue;
          }

          const protocolRegistry = findDescriptorTreeProtocolRegistry(hostedDsl.descriptors);
          const extensionKey = explicitExtensionKey ?? protocolRegistry?.componentExtension;
          if (!extensionKey) return [];

          const layoutAliases = buildDescriptorTreeLayoutAliases(hostedDsl.descriptors, {
            ...(protocolRegistry
              ? {
                  extensionKey: protocolRegistry.layoutAliasExtension,
                  ...(protocolRegistry.layoutAliasDefaultTo
                    ? { defaultTo: protocolRegistry.layoutAliasDefaultTo }
                    : {}),
                }
              : {}),
          });
          const layout =
            layoutAliases.size > 0
              ? rewriteDescriptorTreeLayoutAliases(layoutExpr, layoutAliases)
              : layoutExpr;
          const contextOffset = explicitExtensionKey ? 0 : -1;

          const result = typeCheckDescriptorTree({
            layout,
            descriptors: hostedDsl.descriptors,
            extensionKey,
            stateVars: toStateTypeMap(args[3 + contextOffset]!),
            queryNames: toNameSet(args[4 + contextOffset]!),
            inputParams: toNameSet(args[5 + contextOffset]!),
            defNames: toNameSet(args[6 + contextOffset]!),
          });

          return result.diagnostics.map((diagnostic) =>
            diagnosticKValue(
              diagnostic.severity,
              diagnostic.component
                ? `[${diagnostic.component}] ${diagnostic.message}`
                : diagnostic.message,
            ),
          ) as unknown as KValue;
        })(),
      ),

    "meta/compile-descriptor-tree": (args, apply) =>
      Effect.gen(function* () {
        const hostedDslName = typeof args[0] === "string" ? args[0] : undefined;
        if (!hostedDslName) return null;

        const hostedDsl = hostedDsls.get(hostedDslName);
        if (!hostedDsl) return null;

        const protocolRegistry = findDescriptorTreeProtocolRegistry(hostedDsl.descriptors);
        if (!protocolRegistry) return null;

        const explicitExtensionKey = typeof args[1] === "string" ? args[1] : undefined;
        const layoutArgIndex = explicitExtensionKey ? 2 : 1;
        const layoutExpr = args[layoutArgIndex];
        if (layoutExpr === undefined || layoutExpr === null) return null;

        const extensionKey = explicitExtensionKey ?? protocolRegistry.componentExtension;
        return yield* apply({ _tag: "KBuiltin", name: protocolRegistry.compileLayoutTreeOp }, [
          hostedDslName,
          extensionKey,
          layoutExpr,
        ]);
      }),

    ...hostedBuiltins,
  };
}

function isMetaBuiltinsOptions(
  value: MetaBuiltinsOptions | Record<string, BuiltinFn>,
): value is MetaBuiltinsOptions {
  return "hostedBuiltins" in value || "hostedDsls" in value;
}

/** Build a construct object from alternating keyword/value arguments. */
function constructObject(args: readonly KValue[]): KValue {
  const obj = new Map<string, KValue>();
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    if (typeof key === "string") obj.set(key.startsWith(":") ? key.slice(1) : key, args[i + 1]!);
  }
  return normalizeRuntimeExprObject(obj);
}

function diagnosticKValue(severity: "error" | "warning", message: string): KValue {
  return new Map<string, KValue>([
    ["severity", severity],
    ["message", message],
  ]) as unknown as KValue;
}

function toNameSet(val: KValue): Set<string> {
  const names = new Set<string>();
  if (val instanceof Map) {
    for (const key of val.keys()) {
      if (typeof key === "string") names.add(key);
    }
  } else if (Array.isArray(val)) {
    for (const item of val) {
      if (typeof item === "string") names.add(item);
    }
  }
  return names;
}

function toStateTypeMap(val: KValue): Map<string, string> {
  const stateTypes = new Map<string, string>();
  if (val instanceof Map) {
    for (const [key, value] of val.entries()) {
      if (typeof key !== "string") continue;
      if (typeof value === "string") {
        stateTypes.set(key, value);
        continue;
      }
      if (value instanceof Map) {
        const kind = value.get("kind") ?? value.get("type");
        if (typeof kind === "string") stateTypes.set(key, kind);
        continue;
      }
    }
  } else if (Array.isArray(val)) {
    for (const item of val) {
      if (typeof item === "string") stateTypes.set(item, "any");
    }
  }
  return stateTypes;
}

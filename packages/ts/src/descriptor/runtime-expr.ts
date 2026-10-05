import type { KValue } from "../evaluator/types.js";

/**
 * Runtime expressions lower symbols to plain strings, so string literals are
 * wrapped in a marker map to stay distinguishable: `{ [key]: kind, value }`.
 */
export const RUNTIME_STRING_LITERAL_KEY = "$forma.runtimeExpr";
export const RUNTIME_STRING_LITERAL_KIND = "string-literal";

/** True when a construct value is a string literal from a runtime expression. */
export function isRuntimeStringLiteral(value: unknown): value is ReadonlyMap<string, unknown> {
  return (
    value instanceof Map &&
    value.get(RUNTIME_STRING_LITERAL_KEY) === RUNTIME_STRING_LITERAL_KIND &&
    typeof value.get("value") === "string"
  );
}

type SExprLike = {
  readonly _tag: string;
  readonly name?: string;
  readonly value?: unknown;
  readonly items?: readonly unknown[];
  readonly pairs?: readonly (readonly [unknown, unknown])[];
  readonly message?: string;
};

export function isSExprLike(value: unknown): value is SExprLike {
  return value !== null && typeof value === "object" && "_tag" in value;
}

/**
 * Lower reader nodes to canonical runtime values: lists and vectors become
 * arrays, symbols become strings, and string literals become marker maps.
 */
export function canonicalExprValue(value: unknown): KValue {
  if (isSExprLike(value)) {
    switch (value._tag) {
      case "List":
      case "Vector":
      case "Set":
        return (value.items ?? []).map(canonicalExprValue) as readonly KValue[] as KValue;
      case "Map":
        return new Map(
          (value.pairs ?? []).map(([key, item]) => {
            if (!isSExprLike(key) || key._tag !== "Sym") {
              throw new Error("canonical runtime map keys must be symbols");
            }
            return [String(key.name ?? "").replace(/^:/, ""), canonicalExprValue(item)] as const;
          }),
        ) as KValue;
      case "Sym":
        return String(value.name ?? "");
      case "Str":
        return new Map<string, KValue>([
          [RUNTIME_STRING_LITERAL_KEY, RUNTIME_STRING_LITERAL_KIND],
          ["value", String(value.value ?? "")],
        ]) as KValue;
      case "Num":
      case "Bool":
        return value.value as KValue;
      case "Error":
        return String(value.message ?? "");
      default:
        throw new Error(`unsupported runtime expression node '${value._tag}'`);
    }
  }

  if (value instanceof Map) {
    return new Map(
      [...value.entries()].map(([key, item]) => [key, canonicalExprValue(item)] as const),
    ) as KValue;
  }

  if (Array.isArray(value)) {
    return value.map(canonicalExprValue) as KValue;
  }

  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value as KValue;
  }

  return String(value);
}

export function runtimeExpr(value: KValue | undefined): KValue | null {
  if (value === undefined || value === null) return null;
  if (value instanceof Map && value.get("kind") === "raw-expr" && value.has("expr")) {
    return new Map<string, KValue>([
      ["kind", "raw-expr"],
      ["expr", canonicalExprValue(value.get("expr"))],
    ]) as KValue;
  }
  return new Map<string, KValue>([
    ["kind", "raw-expr"],
    ["expr", canonicalExprValue(value)],
  ]) as KValue;
}

export function normalizeRuntimeExprObject(obj: Map<string, KValue>): KValue {
  if (obj.get("kind") === "raw-expr" && obj.has("expr")) return runtimeExpr(obj) as KValue;
  return obj as KValue;
}

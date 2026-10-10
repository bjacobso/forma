import type { KernelObserver } from "./observation.js";
import type { Effect } from "effect";
import type { SExpr } from "../reader/index.js";
import { isFloatLiteral } from "../reader/types.js";
import type { Env } from "../Env.js";
import type { KernelError } from "../diagnostic/errors.js";

/**
 * Kernel value — the runtime type of evaluated expressions.
 */
export type KValue =
  | string
  | number
  | KFloat
  | boolean
  | null
  | readonly KValue[]
  | ReadonlyMap<string, KValue>
  | KBuiltin
  | KFn
  | KSExpr
  | KKeyword
  | KSymbol
  | KMacro
  | KMeta;

/** Float identity survives integral results, quotation, and retained values. */
export class KFloat {
  readonly _tag = "KFloat";
  constructor(readonly value: number) {}
  toString(): string { return printFloat(this.value); }
}

export function isKFloat(value: unknown): value is KFloat {
  return value instanceof KFloat;
}

export function isNumeric(value: unknown): value is number | KFloat {
  return typeof value === "number" || isKFloat(value);
}

export function printFloat(value: number): string {
  if (Object.is(value, -0)) return "-0.0";
  const text = String(value);
  return Number.isFinite(value) && !/[.eE]/.test(text) ? `${text}.0` : text;
}

export function checkedInt(value: number, context: string): number {
  if (!Number.isSafeInteger(value)) {
    throw new TypeCheckError(context, "Int in the safe integer range", String(value));
  }
  return value === 0 ? 0 : value;
}

export function asInt(value: KValue, context: string): number {
  if (typeof value !== "number") throw new TypeCheckError(context, "Int", describeType(value));
  return checkedInt(value, context);
}

export function numericDatum(expr: SExpr & { _tag: "Num" }): number | KFloat {
  return isFloatLiteral(expr)
    ? new KFloat(expr.value) : checkedInt(expr.value, "literal");
}

export function numericResult(value: number, float: boolean, context: string): number | KFloat {
  return float ? new KFloat(value) : checkedInt(value, context);
}

/** A homogeneous dictionary preserves optional lookup independently of record access. */
export class KDictionary extends Map<string, KValue> {}
export const isKDictionary = (value: KValue): value is KDictionary => value instanceof KDictionary;

export interface KKeyword { readonly _tag: "KKeyword"; readonly name: string; }
export interface KSymbol { readonly _tag: "KSymbol"; readonly name: string; }
const keywords = new Map<string,KKeyword>();
class Atom {
  constructor(readonly _tag: "KKeyword" | "KSymbol", readonly name: string) {}
  toString(): string { return this.name; }
}
export const KKeyword = (name: string): KKeyword => {
  name = name.startsWith(":") ? name : `:${name}`;
  const existing = keywords.get(name);
  if (existing) return existing;
  const value = Object.freeze(new Atom("KKeyword",name)) as KKeyword;
  keywords.set(name,value); return value;
};
export const KSymbol = (name: string): KSymbol => Object.freeze(new Atom("KSymbol",name)) as KSymbol;
export const isKKeyword = (v: KValue): v is KKeyword => v !== null && typeof v === "object" && "_tag" in v && v._tag === "KKeyword";
export const isKSymbol = (v: KValue): v is KSymbol => v !== null && typeof v === "object" && "_tag" in v && v._tag === "KSymbol";
/** Internal map labels distinguish keywords, strings and quoted symbols. */
export function mapKey(v: KValue): string | undefined {
  return isKKeyword(v) ? v.name : isKSymbol(v) ? `\0sym:${v.name}` : typeof v === "string" ? v.startsWith(":") || v.startsWith("\0") ? `\0str:${v}` : v : undefined;
}
export function mapKeyValue(k: string): KValue { return k.startsWith("\0str:") ? k.slice(5) : k.startsWith("\0sym:") ? KSymbol(k.slice(5)) : k.startsWith(":") ? KKeyword(k) : k; }
export function quotedDatum(e: SExpr): KValue {
  switch (e._tag) {
    case "Num": return numericDatum(e);
    case "Str": case "Bool": return e.value;
    case "Sym": return e.name === "nil" ? null : e.name.startsWith(":") ? KKeyword(e.name) : KSymbol(e.name);
    case "List": case "Vector": return e.items.map(quotedDatum);
    case "Map": return new Map(e.pairs.map(([k,v])=>[mapKey(quotedDatum(k)) ?? "",quotedDatum(v)]));
    default: throw new TypeError("Invalid quoted datum");
  }
}

/**
 * First-class builtin function reference.
 */
export interface KBuiltin {
  readonly _tag: "KBuiltin";
  readonly name: string;
}

/**
 * A closure captured from `(fn [params] body)`.
 */
export interface KFn {
  readonly _tag: "KFn";
  readonly params: readonly string[];
  readonly restParam?: string;
  readonly body: SExpr;
  readonly closure: Env;
  /** Optional override for dispatch wrappers — when set, applyKFn calls this instead of evaluating body */
  readonly apply?: (
    args: readonly KValue[],
    context?: unknown,
  ) => Effect.Effect<KValue, KernelError>;
}

/**
 * Quoted AST node — result of quasiquote, used by macros to represent code as data.
 */
export interface KSExpr {
  readonly _tag: "KSExpr";
  readonly expr: SExpr;
}

/**
 * A macro captured from `(__macro name [params] body)`.
 * Like KFn but receives unevaluated forms as KSExpr arguments.
 */
export interface KMacro {
  readonly _tag: "KMacro";
  readonly name: string;
  readonly params: readonly string[];
  readonly restParam?: string;
  readonly body: SExpr;
  readonly closure: Env;
}

/**
 * A declarative meta descriptor value constructed by `(meta [:slot ...] ...)`.
 *
 * Entries preserve source order and preserve slot payload items verbatim.
 */
export interface KMeta {
  readonly _tag: "KMeta";
  readonly entries: readonly (readonly [slot: string, values: readonly KValue[]])[];
}

/**
 * Builtin function signature.
 * Receives evaluated args + an `apply` callback for higher-order fns.
 */
export type BuiltinFn = (
  args: readonly KValue[],
  apply: (fn: KValue, args: readonly KValue[]) => Effect.Effect<KValue, KernelError>,
) => Effect.Effect<KValue, KernelError>;

/**
 * Options for kernel evaluation.
 */
export interface KernelOptions {
  readonly stepLimit: number;
  readonly includePrelude?: boolean;
  readonly builtins?: Record<string, BuiltinFn>;
  readonly env?: Env;
  /** Receives the value of every observed expression. */
  readonly observer?: KernelObserver;
}

/**
 * Result of kernel evaluation.
 */
export interface KernelResult {
  readonly value: KValue;
  readonly steps: number;
  readonly env: Env;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function isKFn(v: KValue): v is KFn {
  return v !== null && typeof v === "object" && "_tag" in v && v._tag === "KFn";
}

export function isKBuiltin(v: KValue): v is KBuiltin {
  return v !== null && typeof v === "object" && "_tag" in v && v._tag === "KBuiltin";
}

export function KBuiltin(name: string): KBuiltin {
  return { _tag: "KBuiltin", name };
}

export function isKSExpr(v: KValue): v is KSExpr {
  return v !== null && typeof v === "object" && "_tag" in v && v._tag === "KSExpr";
}

export function isKMacro(v: KValue): v is KMacro {
  return v !== null && typeof v === "object" && "_tag" in v && v._tag === "KMacro";
}

export function isKMeta(v: KValue): v is KMeta {
  return v !== null && typeof v === "object" && "_tag" in v && v._tag === "KMeta";
}

export function isKList(v: KValue): v is readonly KValue[] {
  return Array.isArray(v);
}

export function isKMap(v: KValue): v is ReadonlyMap<string, KValue> {
  return v instanceof Map;
}

export function asNumber(v: KValue, context: string): number {
  if (isKFloat(v)) return v.value;
  if (typeof v !== "number") {
    throw new TypeCheckError(context, "number", describeType(v));
  }
  return v;
}

export function asString(v: KValue, context: string): string {
  if (typeof v !== "string") {
    throw new TypeCheckError(context, "string", describeType(v));
  }
  return v;
}

export function asList(v: KValue, context: string): readonly KValue[] {
  if (!isKList(v)) {
    throw new TypeCheckError(context, "list", describeType(v));
  }
  return v;
}

export function asKFn(v: KValue, context: string): KFn {
  if (!isKFn(v)) {
    throw new TypeCheckError(context, "function", describeType(v));
  }
  return v;
}

export function describeType(v: KValue): string {
  if (v === null) return "nil";
  if (isKKeyword(v)) return "keyword";
  if (isKSymbol(v)) return "symbol";
  if (typeof v === "string") return "string";
  if (isKFloat(v)) return "Float";
  if (typeof v === "number") return "Int";
  if (typeof v === "boolean") return "boolean";
  if (isKBuiltin(v)) return "function";
  if (isKFn(v)) return "function";
  if (isKSExpr(v)) return "sexpr";
  if (isKMacro(v)) return "macro";
  if (isKMeta(v)) return "meta";
  if (isKMap(v)) return "map";
  if (isKList(v)) return "list";
  return "unknown";
}

/**
 * Internal throw-based helper used by asNumber/asString/asList/asKFn.
 * The evaluator catches these and converts to Effect failures.
 */
class TypeCheckError extends Error {
  readonly context: string;
  readonly expected: string;
  readonly got: string;

  constructor(context: string, expected: string, got: string) {
    super(`${context}: expected ${expected}, got ${got}`);
    this.context = context;
    this.expected = expected;
    this.got = got;
  }
}

export { TypeCheckError };

/**
 * Internal tail-call sentinel for TCO trampoline.
 * NOT a KValue — never escapes to user code.
 */
export interface KTailCall {
  readonly _tag: "KTailCall";
  readonly args: readonly KValue[];
}

export function isKTailCall(v: unknown): v is KTailCall {
  return (
    v !== null && typeof v === "object" && "_tag" in v && (v as KTailCall)._tag === "KTailCall"
  );
}

/**
 * Truthiness: null and false are falsy, everything else is truthy.
 */
export function isTruthy(v: KValue): boolean {
  return v !== null && v !== false;
}

/**
 * Structural equality for KValues.
 */
function containsNaN(value: KValue): boolean {
  if (isKFloat(value)) return Number.isNaN(value.value);
  if (Array.isArray(value)) return value.some(containsNaN);
  if (value instanceof Map) {
    for (const item of value.values()) if (containsNaN(item)) return true;
  }
  return false;
}

export function kEquals(a: KValue, b: KValue): boolean {
  if (isNumeric(a) && isNumeric(b)) return asNumber(a, "=") === asNumber(b, "=");
  if (a === b) return !containsNaN(a);
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a === "number" || typeof a === "string" || typeof a === "boolean") {
    return a === b;
  }
  if (isKKeyword(a) && isKKeyword(b) || isKSymbol(a) && isKSymbol(b)) return a.name === b.name;
  if (isKBuiltin(a) && isKBuiltin(b)) return a.name === b.name;
  if (isKBuiltin(a) || isKBuiltin(b)) return false;
  if (isKFn(a) || isKFn(b)) return false; // functions are never equal
  if (isKMeta(a) && isKMeta(b as KValue)) {
    const bMeta = b as KMeta;
    if (a.entries.length !== bMeta.entries.length) return false;
    return a.entries.every(([slot, values], index) => {
      const other = bMeta.entries[index];
      return (
        other !== undefined &&
        slot === other[0] &&
        values.length === other[1].length &&
        values.every((value, valueIndex) => kEquals(value, other[1][valueIndex]!))
      );
    });
  }
  if (isKList(a) && isKList(b as KValue)) {
    const bArr = b as readonly KValue[];
    if (a.length !== bArr.length) return false;
    return a.every((v, i) => kEquals(v, bArr[i]!));
  }
  if (isKMap(a) && isKMap(b as KValue)) {
    const bMap = b as ReadonlyMap<string, KValue>;
    if (a.size !== bMap.size) return false;
    for (const [k, v] of a) {
      if (!bMap.has(k) || !kEquals(v, bMap.get(k)!)) return false;
    }
    return true;
  }
  return false;
}

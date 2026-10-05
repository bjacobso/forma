import type { KernelObserver } from "./observation.js";
import type { Effect } from "effect";
import type { SExpr } from "../reader/index.js";
import type { Env } from "../Env.js";
import type { KernelError } from "../diagnostic/errors.js";

/**
 * Kernel value — the runtime type of evaluated expressions.
 */
export type KValue =
  | string
  | number
  | boolean
  | null
  | readonly KValue[]
  | ReadonlyMap<string, KValue>
  | KBuiltin
  | KFn
  | KSExpr
  | KMacro
  | KMeta;

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
 * A macro captured from `(define-macro name [params] body)`.
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
  if (typeof v === "string") return "string";
  if (typeof v === "number") return "number";
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
export function kEquals(a: KValue, b: KValue): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a === "number" || typeof a === "string" || typeof a === "boolean") {
    return a === b;
  }
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

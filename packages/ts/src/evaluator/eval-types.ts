import type { Effect, Ref } from "effect";
import type { KernelObserver } from "./observation.js";
import type { SExpr } from "../reader/index.js";
import type { KernelError } from "../diagnostic/errors.js";
import type { Env } from "../Env.js";
import type { KValue, KFn, BuiltinFn } from "./types.js";

// ---------------------------------------------------------------------------
// Shared evaluator types
// ---------------------------------------------------------------------------

export interface EvaluatorRuntime {
  readonly builtins: Record<string, BuiltinFn>;
  readonly counter: Ref.Ref<number>;
  readonly stepLimit: number;
  readonly observer?: KernelObserver;
}

/**
 * Common type for all form handlers — the recursive evalExpr callback.
 */
export type EvalFn = (
  expr: SExpr,
  env: Env,
  runtime: EvaluatorRuntime,
) => Effect.Effect<KValue, KernelError>;

// ---------------------------------------------------------------------------
// Dispatch wrapper types
// ---------------------------------------------------------------------------

export interface DispatchWrapperData {
  readonly methodName: string;
  readonly className: string;
  readonly dispatchArgIndex: number;
  readonly implementations: Map<string, KFn>;
}

export const EVAL_DISPATCH_WRAPPER_KEY = Symbol.for("forma/eval-dispatch-wrapper");

export interface EvalDispatchKFn extends KFn {
  readonly [EVAL_DISPATCH_WRAPPER_KEY]: DispatchWrapperData;
}

export function getDispatchWrapperData(v: unknown): DispatchWrapperData | null {
  if (v !== null && typeof v === "object" && EVAL_DISPATCH_WRAPPER_KEY in v) {
    return (v as EvalDispatchKFn)[EVAL_DISPATCH_WRAPPER_KEY];
  }
  return null;
}

export function getEvaluatorRuntime(context: unknown): EvaluatorRuntime | null {
  if (context !== null && typeof context === "object") {
    return context as EvaluatorRuntime;
  }
  return null;
}

// ---------------------------------------------------------------------------
// TCO state — module-level mutable state with getter/setter access
// ---------------------------------------------------------------------------

/**
 * Module-level TCO state. When applyKFn is evaluating a function body,
 * _tcoSelf points to that function so self-tail-calls can be detected.
 * _tcoTail indicates whether we're currently in a tail position.
 */
let _tcoSelf: KFn | null = null;
let _tcoTail: boolean = false;

export function getTcoSelf(): KFn | null {
  return _tcoSelf;
}
export function setTcoSelf(fn: KFn | null): void {
  _tcoSelf = fn;
}
export function getTcoTail(): boolean {
  return _tcoTail;
}
export function setTcoTail(tail: boolean): void {
  _tcoTail = tail;
}

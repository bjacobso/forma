import type { SExpr } from "../reader/index.js";
import type { KernelError } from "../diagnostic/errors.js";
import { KernelTypeError } from "../diagnostic/errors.js";
import { Env } from "../Env.js";
import { KBuiltin, type BuiltinFn, type KValue } from "./types.js";

// ---------------------------------------------------------------------------
// VM bridge — evaluator fallback detection and globals bridging
// ---------------------------------------------------------------------------

export const VM_EVALUATOR_FALLBACK_HEADS = new Set(["unquote", "unquote-splicing"]);

export function requiresEvaluatorRuntime(exprs: readonly SExpr[]): boolean {
  return exprs.some((expr) => hasEvaluatorOnlyRuntimeNode(expr));
}

export function hasEvaluatorOnlyRuntimeNode(expr: SExpr, inQuasiquote: boolean = false): boolean {
  switch (expr._tag) {
    case "Vector":
      return expr.items.some((item) => hasEvaluatorOnlyRuntimeNode(item, inQuasiquote));
    case "Map":
      return expr.pairs.some(
        ([k, v]) =>
          hasEvaluatorOnlyRuntimeNode(k, inQuasiquote) ||
          hasEvaluatorOnlyRuntimeNode(v, inQuasiquote),
      );
    case "List": {
      const head = expr.items[0];
      if (head?._tag === "Sym" && head.name === "quasiquote") {
        return expr.items.slice(1).some((item) => hasEvaluatorOnlyRuntimeNode(item, true));
      }
      if (head?._tag === "Sym" && VM_EVALUATOR_FALLBACK_HEADS.has(head.name)) {
        return !inQuasiquote;
      }
      return expr.items.some((item) => hasEvaluatorOnlyRuntimeNode(item, inQuasiquote));
    }
    case "Num":
    case "Str":
    case "Bool":
    case "Sym":
    case "Set":
    case "Error":
      return false;
  }
}

export function buildVMGlobals(
  globals: { count: number; nameAt: (idx: number) => string | undefined },
  env: Env,
  builtins: Readonly<Record<string, BuiltinFn>> = {},
): KValue[] {
  const values = new Array<KValue>(globals.count);
  for (let idx = 0; idx < globals.count; idx++) {
    const name = globals.nameAt(idx);
    if (name !== undefined && env.has(name)) {
      values[idx] = env.lookup(name) ?? null;
    } else if (name !== undefined && Object.hasOwn(builtins, name)) {
      // A future definition reserves the cell but has not replaced its builtin yet.
      values[idx] = KBuiltin(name);
    }
  }
  return values;
}

export function buildRuntimeEnvFromGlobals(
  baseEnv: Env,
  globals: { count: number; nameAt: (idx: number) => string | undefined },
  values: readonly KValue[],
): Env {
  let env = baseEnv;

  for (let idx = 0; idx < globals.count; idx++) {
    const name = globals.nameAt(idx);
    const value = values[idx];
    if (name === undefined || value === undefined) {
      continue;
    }
    env = env.bind(name, value);
  }

  return env;
}

/**
 * Scan a list of (expanded) expressions and return a KernelError if
 * any deprecated public syntax form is found.
 *
 * Checked forms (must match HM lowering rejections):
 *   - `(def ...)` bare binder -> use `(define ...)`
 *   - `(defn ...)` function binder -> use `(define name (fn [...] ...))`
 *   - `(def-macro ...)` -> use `(define-macro ...)`
 *   - `(def-effect ...)` -> removed legacy algebraic effect syntax
 *   - `(defclass ...)` -> use `(define-typeclass ...)`
 *   - `(deftype ...)` / `(data ...)` -> use `(define-type ...)`
 *   - `(:: ...)` type signature -> use `(: ...)`
 */
export function checkCanonicalPublicSyntax(exprs: readonly SExpr[]): KernelError | null {
  for (const expr of exprs) {
    const error = checkCanonicalPublicExpr(expr);
    if (error) return error;
  }
  return null;
}

function checkCanonicalPublicExpr(expr: SExpr): KernelError | null {
  switch (expr._tag) {
    case "List": {
      const head = expr.items[0];
      if (head?._tag !== "Sym") {
        return checkCanonicalPublicChildren(expr.items);
      }
      switch (head.name) {
        case "quote":
        case "quasiquote":
          return null;
        case "def":
          return new KernelTypeError({
            message: "Legacy public binding form 'def' is no longer supported; use 'define'",
            expected: "(define name value)",
            got: "(def ...)",
            loc: expr.loc,
          });
        case "defn":
          return new KernelTypeError({
            message:
              "Legacy public function binding form 'defn' is no longer supported; use 'define' with 'fn'",
            expected: "(define name (fn [params] body...))",
            got: "(defn ...)",
            loc: expr.loc,
          });
        case "def-macro":
          return new KernelTypeError({
            message:
              "Legacy public macro form 'def-macro' is no longer supported; use 'define-macro'",
            expected: "(define-macro name [params] body...)",
            got: "(def-macro ...)",
            loc: expr.loc,
          });
        case "def-effect":
          return new KernelTypeError({
            message:
              "Legacy public effect form 'def-effect' is no longer supported; use 'define-service' and 'define-operation'",
            expected: "(define-service ...) and (define-operation ...)",
            got: "(def-effect ...)",
            loc: expr.loc,
          });
        case "defclass":
          return new KernelTypeError({
            message:
              "Legacy public typeclass form 'defclass' is no longer supported; use 'define-typeclass'",
            expected: "(define-typeclass (Class params...) methods...)",
            got: "(defclass ...)",
            loc: expr.loc,
          });
        case "deftype":
          return new KernelTypeError({
            message: "Legacy public type form 'deftype' is no longer supported; use 'define-type'",
            expected: "(define-type Name Type) or (define-type (Name params...) constructors...)",
            got: "(deftype ...)",
            loc: expr.loc,
          });
        case "data":
          return new KernelTypeError({
            message: "Legacy public ADT form 'data' is no longer supported; use 'define-type'",
            expected: "(define-type (Name params...) constructors...)",
            got: "(data ...)",
            loc: expr.loc,
          });
        case "::":
          return new KernelTypeError({
            message: "Legacy public signature form '::' is no longer supported; use ':'",
            expected: "(: name signature)",
            got: "(:: ...)",
            loc: expr.loc,
          });
      }
      return checkCanonicalPublicChildren(expr.items);
    }
    case "Vector":
      return checkCanonicalPublicChildren(expr.items);
    case "Map":
      for (const [key, value] of expr.pairs) {
        const keyError = checkCanonicalPublicExpr(key);
        if (keyError) return keyError;
        const valueError = checkCanonicalPublicExpr(value);
        if (valueError) return valueError;
      }
      return null;
    case "Set":
      return checkCanonicalPublicChildren(expr.items);
    case "Num":
    case "Str":
    case "Bool":
    case "Sym":
    case "Error":
      return null;
  }
}

function checkCanonicalPublicChildren(exprs: readonly SExpr[]): KernelError | null {
  for (const expr of exprs) {
    const error = checkCanonicalPublicExpr(expr);
    if (error) return error;
  }
  return null;
}

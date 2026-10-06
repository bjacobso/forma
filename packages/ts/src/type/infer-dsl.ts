import { checkExpr } from "./check-expr.js";
/**
 * Inference for DSL forms and type ascription.
 */
import { Effect, Ref } from "effect";
import type { Type, Row } from "./types.js";
import { tUnknown } from "./types.js";
import { applyType, applyEnv, type TypeEnv } from "./substitution.js";
import { assignType } from "./assign.js";
import { unify } from "./unify.js";
import { InferContext } from "./context.js";
import { InferenceError } from "./errors.js";
import type { CoreExpr } from "./core-expr.js";
import type { SExpr } from "../reader/index.js";
import { originOf, typeExprToType } from "./infer-core.js";
import { getInferDslProvider, getInferRawExprs } from "./infer-state.js";
import type { InferFn } from "./infer-binding.js";

// ---------------------------------------------------------------------------
// findRawExprBySpan
// ---------------------------------------------------------------------------

/**
 * Recursively search an array of SExprs for one matching a given span.
 * DSL forms can be nested inside (define ...) or other forms, so we need
 * to search beyond just top-level expressions.
 */
export function findRawExprBySpan(
  exprs: readonly SExpr[],
  start: number,
  end: number,
): SExpr | undefined {
  for (const raw of exprs) {
    if (raw.loc.start === start && raw.loc.end === end) {
      return raw;
    }
    // Recurse into List and Vector children
    if ((raw._tag === "List" || raw._tag === "Vector") && raw.items.length > 0) {
      const found = findRawExprBySpan(raw.items, start, end);
      if (found) return found;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// findRawExprForDSLForm
// ---------------------------------------------------------------------------

/**
 * Find the raw SExpr corresponding to a DSLForm node.
 * Uses span matching to locate the original SExpr.
 */
export function findRawExprForDSLForm(
  dslForm: CoreExpr & { _tag: "DSLForm" },
  rawExprs: readonly SExpr[],
  _hintIndex: number,
): SExpr | undefined {
  // Match by span position
  for (const raw of rawExprs) {
    if (raw.loc.start === dslForm.span.start && raw.loc.end === dslForm.span.end) {
      return raw;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Ascribe (type ascription: (: expr Type))
// ---------------------------------------------------------------------------

export const inferAscribe = (
  env: TypeEnv,
  expr: CoreExpr & { _tag: "Ascribe" },
  inferExpr: InferFn,
): Effect.Effect<Type, InferenceError, InferContext> =>
  Effect.gen(function* () {
    const ctx = yield* InferContext;

    // Infer the type of the inner expression


    // Convert the type annotation to a Type
    const tvarMap = new Map<string, Type>();
    const rvarMap = new Map<string, Row>();
    const declaredT = yield* typeExprToType(expr.typeExpr, tvarMap, rvarMap);

    yield* checkExpr(env,expr.expr,declaredT);

    // Return the declared type (after substitution)
    const s = yield* Ref.get(ctx.subst);
    return applyType(s, declaredT);
  });

// ---------------------------------------------------------------------------
// DSLForm (delegated to DSLTypeProvider)
// ---------------------------------------------------------------------------

export const inferDSLForm = (
  env: TypeEnv,
  expr: CoreExpr & { _tag: "DSLForm" },
  inferExpr: InferFn,
): Effect.Effect<Type, InferenceError, InferContext> =>
  Effect.gen(function* () {
    const ctx = yield* InferContext;
    const _inferDslProvider = getInferDslProvider();
    const _inferRawExprs = getInferRawExprs();

    // Find the raw SExpr corresponding to this DSLForm (by span matching).
    // Needed for type bindings and expression-specific result types.
    // Must search recursively since DSL forms can be nested inside (define ...) etc.
    let rawExpr: SExpr | undefined;
    if (_inferDslProvider && _inferRawExprs) {
      rawExpr = findRawExprBySpan(_inferRawExprs, expr.span.start, expr.span.end);
    }

    // Inject type bindings from the DSL provider into the environment
    // used for type-checking children. This allows forms like (action ...)
    // to inject runtime env variables ($input, $entity, etc.) for use
    // inside (do ...) blocks.
    let childEnv = env;
    if (_inferDslProvider && rawExpr) {
      const bindings = _inferDslProvider.getTypeBindings(expr.name, rawExpr);
      if (bindings.size > 0) {
        const updatedEnv = new Map(env);
        for (const [name, scheme] of bindings) {
          updatedEnv.set(name, scheme);
        }
        childEnv = updatedEnv;
      }
    }

    // Type-check each child expression and unify with expected types
    for (const child of expr.children) {
      const s = yield* Ref.get(ctx.subst);
      const envN = applyEnv(s, childEnv);
      const childT = yield* inferExpr(envN, child.expr);

      // If the slot has an expected type, unify the inferred type with it
      if (child.expectedType) {
        yield* unify(
          applyType(yield* Ref.get(ctx.subst), childT),
          child.expectedType,
          originOf(expr, `dsl-slot:${child.slotName}`),
        );
      }
    }

    // Run form-level validation if the provider supports it.
    // This collects non-fatal diagnostics (e.g., CEL type errors in string literals)
    // without halting inference.
    if (_inferDslProvider?.validateForm && rawExpr) {
      const diagnostics = _inferDslProvider.validateForm(expr.name, rawExpr, childEnv);
      for (const diag of diagnostics) {
        yield* ctx.addDiagnostic(diag);
      }
    }

    // Return the form's result type, or Unknown if not declared.
    // Try expression-specific dynamic type first (e.g., datalog computes
    // List<{var1: T1, ...}> based on the query), then fall back to the
    // static per-form-name result type.
    let resultType: Type | undefined;
    if (_inferDslProvider?.getResultTypeForExpr && rawExpr) {
      resultType = _inferDslProvider.getResultTypeForExpr(expr.name, rawExpr);
    }
    if (resultType === undefined) {
      resultType = _inferDslProvider?.getResultType(expr.name) ?? tUnknown;
    }
    return resultType;
  });

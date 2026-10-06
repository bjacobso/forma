import { checkExpr } from "./check-expr.js";
/**
 * Inference for let-bindings and top-level definitions (define).
 */
import { Effect, Ref } from "effect";
import type { Type, Row } from "./types.js";
import { mono } from "./types.js";
import { applyType, applyEnv, type TypeEnv } from "./substitution.js";
import { assignType } from "./assign.js";
import { unify } from "./unify.js";
import { InferContext } from "./context.js";
import { InferenceError } from "./errors.js";
import type { CoreExpr } from "./core-expr.js";
import { inferLam, originOf, typeExprToType } from "./infer-core.js";
import { generalizeBinding } from "./scheme-ops.js";

/**
 * Common type for the recursive inferExpr callback.
 */
export type InferFn = (
  env: TypeEnv,
  expr: CoreExpr,
) => Effect.Effect<Type, InferenceError, InferContext>;

// ---------------------------------------------------------------------------
// Let (with let-polymorphism)
// ---------------------------------------------------------------------------

export const inferLet = (
  env: TypeEnv,
  expr: CoreExpr & { _tag: "Let" },
  inferExpr: InferFn,
): Effect.Effect<Type, InferenceError, InferContext> =>
  Effect.gen(function* () {
    const ctx = yield* InferContext;
    let letEnv = new Map(env);

    for (const binding of expr.bindings) {
      const pendingStart = (yield* Ref.get(ctx.pendingConstraints)).length;
      const s = yield* Ref.get(ctx.subst);
      const envN = applyEnv(s, letEnv);
      const bindT = yield* inferExpr(envN, binding.expr);
      const sAfter = yield* Ref.get(ctx.subst);
      const genEnv = applyEnv(sAfter, letEnv);
      const boundType = applyType(sAfter, bindT);
      const pending = yield* Ref.get(ctx.pendingConstraints);
      const normalizedPending = pending.map((pendingConstraint) => ({
        ...pendingConstraint,
        constraint: {
          className: pendingConstraint.constraint.className,
          args: pendingConstraint.constraint.args.map((arg) => applyType(sAfter, arg)),
        },
      }));
      yield* Ref.set(ctx.pendingConstraints, normalizedPending);
      const scheme = yield* generalizeBinding(genEnv, boundType, pendingStart);
      letEnv = new Map(applyEnv(sAfter, letEnv));
      letEnv.set(binding.name, scheme);
    }

    const s = yield* Ref.get(ctx.subst);
    const bodyEnv = applyEnv(s, letEnv);
    const bodyT = yield* inferExpr(bodyEnv, expr.body);
    const sFinal = yield* Ref.get(ctx.subst);
    return applyType(sFinal, bodyT);
  });

// ---------------------------------------------------------------------------
// Def (top-level definition with recursive binding)
// ---------------------------------------------------------------------------

export const inferDef = (
  env: TypeEnv,
  expr: CoreExpr & { _tag: "Def" },
  inferExpr: InferFn,
): Effect.Effect<Type, InferenceError, InferContext> =>
  Effect.gen(function* () {
    const ctx = yield* InferContext;
    const existingBinding = env.get(expr.name);
    const existingMonoType =
      existingBinding &&
      existingBinding.tvars.length === 0 &&
      existingBinding.rvars.length === 0 &&
      existingBinding.evars.length === 0 &&
      existingBinding.constraints.length === 0
        ? existingBinding.type
        : undefined;

    // If there's a signature, use it to constrain the type
    if (expr.signature) {
      // Convert signature to type with fresh variables
      const tvarMap = new Map<string, Type>();
      const rvarMap = new Map<string, Row>();
      const sigT = yield* typeExprToType(expr.signature, tvarMap, rvarMap);

      // Bind name to signature type for recursive reference
      const defEnv = new Map(env);
      defEnv.set(expr.name, mono(sigT));

      // Infer the expression type
      const exprT = yield* checkExpr(defEnv,expr.expr,sigT).pipe(Effect.mapError(error =>
        new InferenceError({message:error.message.replace(/ \(at offset \d+\)$/,""),origin:originOf(expr,"def-signature"),details:error.details})));

      // Unify inferred type with signature type
      yield* assignType(
        applyType(yield* Ref.get(ctx.subst), exprT),
        applyType(yield* Ref.get(ctx.subst), sigT),
        originOf(expr, "def-signature"),
      );

      const s = yield* Ref.get(ctx.subst);
      return applyType(s, sigT);
    }

    // No signature: standard recursive binding with fresh type var
    const selfT = existingMonoType ?? (yield* ctx.freshTVar);
    const defEnv = new Map(env);
    defEnv.set(expr.name, mono(selfT));

    const exprT = yield* inferExpr(defEnv, expr.expr);

    // Unify self-reference with inferred type
    yield* unify(
      applyType(yield* Ref.get(ctx.subst), selfT),
      applyType(yield* Ref.get(ctx.subst), exprT),
      originOf(expr, "def"),
    );

    const s = yield* Ref.get(ctx.subst);
    return applyType(s, exprT);
  });

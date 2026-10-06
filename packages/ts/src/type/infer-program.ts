/**
 * Top-level program inference: inferProgram and inferProgramAll.
 *
 * These functions process a sequence of CoreExprs, maintaining the type
 * environment across definitions.
 */
import { Effect, Ref } from "effect";
import type { Type, Row } from "./types.js";
import { tNil } from "./types.js";
import { applyType, applyEnv, type TypeEnv } from "./substitution.js";
import { InferContext } from "./context.js";
import { InferenceError } from "./errors.js";
import type { CoreExpr } from "./core-expr.js";
import type { DSLTypeProvider } from "./dsl-provider.js";
import type { SExpr } from "../reader/index.js";
import { resolveConstraints } from "./typeclass.js";
import { inferExpr, typeExprToType } from "./infer-core.js";
import { generalizeBinding } from "./scheme-ops.js";
import { withAmbientEffectScope } from "./effect-helpers.js";
import { findRawExprForDSLForm } from "./infer-dsl.js";
import {
  getInferDslProvider,
  setInferDslProvider,
  getInferRawExprs,
  setInferRawExprs,
  getAdtConstructorSchemes,
  getClassMethodSchemes,
  getServiceMethodSchemes,
} from "./infer-state.js";
import { Scheme, mono } from "./types.js";

// ---------------------------------------------------------------------------
// inferProgram
// ---------------------------------------------------------------------------

export interface InferProgramOptions {
  /**
   * Continue after a top-level form fails to type. The error is reported
   * here, the form's effect on the substitution is undone, and the names it
   * defines are bound to a fully polymorphic type, so later forms are still
   * typed. Without it, the first error fails the program.
   */
  readonly onFormError?: (error: InferenceError) => Effect.Effect<void>;
}

export const inferProgram = (
  exprs: readonly CoreExpr[],
  initialEnv?: TypeEnv,
  dslProvider?: DSLTypeProvider,
  rawExprs?: readonly SExpr[],
  captureEnv?: (env: TypeEnv) => void,
  options: InferProgramOptions = {},
): Effect.Effect<Type, InferenceError, InferContext> =>
  Effect.gen(function* () {
    // Set module-level provider for use by inferDSLForm
    const prevProvider = getInferDslProvider();
    const prevRawExprs = getInferRawExprs();
    setInferDslProvider(dslProvider);
    setInferRawExprs(rawExprs);

    try {
      const ctx = yield* InferContext;
      let env: TypeEnv = new Map(initialEnv ?? []);
      let lastType: Type = tNil;
      // A name whose definition does not type is anything to its users.
      const unknownScheme = Effect.map(ctx.freshTVar, (unknown) =>
        unknown._tag === "TVar" ? Scheme([unknown.id], [], unknown) : mono(unknown),
      );

      // Track which raw expression corresponds to each CoreExpr
      // (raw and core are in the same order from lowerProgram)
      let rawExprIndex = 0;

      for (let exprIndex = 0; exprIndex < exprs.length; exprIndex++) {
        const expr = exprs[exprIndex]!;
        const s = yield* Ref.get(ctx.subst);
        const envN = applyEnv(s, env);
        const firstIndex = exprIndex;
        const envBefore = env;
        const pendingBefore = yield* Ref.get(ctx.pendingConstraints);

        const inferForm = Effect.gen(function* () {
          if (expr._tag === "TypeDef") {
            // Clear any previous constructor schemes
            getAdtConstructorSchemes().clear();
            lastType = (yield* withAmbientEffectScope(inferExpr(envN, expr))).value;
            // Register constructor schemes in the environment
            const _adtConstructorSchemes = getAdtConstructorSchemes();
            if (_adtConstructorSchemes.size > 0) {
              const updatedEnv = new Map(applyEnv(yield* Ref.get(ctx.subst), env));
              for (const [name, scheme] of _adtConstructorSchemes) {
                updatedEnv.set(name, scheme);
              }
              env = updatedEnv;
              _adtConstructorSchemes.clear();
            }
          } else if (expr._tag === "DefClass") {
            getClassMethodSchemes().clear();
            lastType = (yield* withAmbientEffectScope(inferExpr(envN, expr))).value;
            // Register class method schemes in the environment
            const _classMethodSchemes = getClassMethodSchemes();
            if (_classMethodSchemes.size > 0) {
              const updatedEnv = new Map(applyEnv(yield* Ref.get(ctx.subst), env));
              for (const [name, scheme] of _classMethodSchemes) {
                updatedEnv.set(name, scheme);
              }
              env = updatedEnv;
              _classMethodSchemes.clear();
            }
          } else if (expr._tag === "Instance") {
            lastType = (yield* withAmbientEffectScope(inferExpr(envN, expr))).value;
          } else if (expr._tag === "DefService") {
            getServiceMethodSchemes().clear();
            lastType = (yield* withAmbientEffectScope(inferExpr(envN, expr))).value;
            const serviceMethodSchemes = getServiceMethodSchemes();
            if (serviceMethodSchemes.size > 0) {
              const updatedEnv = new Map(applyEnv(yield* Ref.get(ctx.subst), env));
              for (const [name, scheme] of serviceMethodSchemes) {
                updatedEnv.set(name, scheme);
              }
              env = updatedEnv;
              serviceMethodSchemes.clear();
            }
          } else if (expr._tag === "Def") {
            const defGroup: Array<CoreExpr & { _tag: "Def" }> = [expr];
            while (exprIndex + 1 < exprs.length && exprs[exprIndex + 1]!._tag === "Def") {
              defGroup.push(exprs[++exprIndex]! as CoreExpr & { _tag: "Def" });
            }

            const seedEnv = new Map(envN);
            for (const defExpr of defGroup) {
              if (defExpr.signature) {
                const tvarMap = new Map<string, Type>();
                const rvarMap = new Map<string, Row>();
                const sigT = yield* typeExprToType(defExpr.signature, tvarMap, rvarMap);
                seedEnv.set(defExpr.name, mono(sigT));
              } else if (!seedEnv.has(defExpr.name)) {
                seedEnv.set(defExpr.name, mono(yield* ctx.freshTVar));
              }
            }

            const inferredDefs: Array<{ name: string; type: Type; pendingStart: number }> = [];
            const failedNames: string[] = [];
            for (const defExpr of defGroup) {
              const pendingStart = (yield* Ref.get(ctx.pendingConstraints)).length;
              const inferDef = withAmbientEffectScope(inferExpr(seedEnv, defExpr));
              let defT: Type;
              if (options.onFormError === undefined) {
                defT = (yield* inferDef).value;
              } else {
                // One definition that does not type leaves the rest of its group typed.
                const substBefore = yield* Ref.get(ctx.subst);
                const pendingBeforeDef = yield* Ref.get(ctx.pendingConstraints);
                const attempt = yield* Effect.result(inferDef);
                if (attempt._tag === "Failure") {
                  yield* options.onFormError(attempt.failure);
                  yield* Ref.set(ctx.subst, substBefore);
                  yield* Ref.set(ctx.pendingConstraints, pendingBeforeDef);
                  failedNames.push(defExpr.name);
                  continue;
                }
                defT = attempt.success.value;
              }
              const sAfterDef = yield* Ref.get(ctx.subst);
              const boundType = applyType(sAfterDef, defT);
              inferredDefs.push({
                name: defExpr.name,
                type: boundType,
                pendingStart,
              });
              lastType = boundType;
            }

            const sAfter = yield* Ref.get(ctx.subst);
            const pending = yield* Ref.get(ctx.pendingConstraints);
            const normalizedPending = pending.map((pendingConstraint) => ({
              ...pendingConstraint,
              constraint: {
                className: pendingConstraint.constraint.className,
                args: pendingConstraint.constraint.args.map((arg) => applyType(sAfter, arg)),
              },
            }));
            yield* Ref.set(ctx.pendingConstraints, normalizedPending);

            const baseGenEnv = applyEnv(sAfter, env);
            const schemes = new Map<string, import("./types.js").Scheme>();
            for (const inferredDef of inferredDefs) {
              schemes.set(
                inferredDef.name,
                yield* generalizeBinding(baseGenEnv, inferredDef.type, inferredDef.pendingStart),
              );
            }

            const updatedEnv = new Map(baseGenEnv);
            for (const [name, scheme] of schemes) {
              updatedEnv.set(name, scheme);
            }
            for (const name of failedNames) {
              updatedEnv.set(name, yield* unknownScheme);
            }
            env = updatedEnv;
            rawExprIndex += defGroup.length - 1;
          } else if (expr._tag === "DSLForm" && dslProvider && rawExprs) {
            // Find the corresponding raw SExpr for this DSLForm
            const rawExpr = findRawExprForDSLForm(expr, rawExprs, rawExprIndex);
            lastType = (yield* withAmbientEffectScope(inferExpr(envN, expr))).value;

            // Add type bindings introduced by this form (e.g., entity types)
            if (rawExpr) {
              const bindings = dslProvider.getTypeBindings(expr.name, rawExpr);
              if (bindings.size > 0) {
                const sAfter = yield* Ref.get(ctx.subst);
                const updatedEnv = new Map(applyEnv(sAfter, env));
                for (const [name, scheme] of bindings) {
                  updatedEnv.set(name, scheme);
                }
                env = updatedEnv;
              }
            }
          } else {
            lastType = (yield* withAmbientEffectScope(inferExpr(envN, expr))).value;
          }
        });

        if (options.onFormError === undefined) {
          yield* inferForm;
        } else {
          const result = yield* Effect.result(inferForm);
          if (result._tag === "Failure") {
            yield* options.onFormError(result.failure);
            yield* Ref.set(ctx.subst, s);
            yield* Ref.set(ctx.pendingConstraints, pendingBefore);
            const recovered = new Map(envBefore);
            for (const failed of exprs.slice(firstIndex, exprIndex + 1)) {
              if (failed._tag === "Def") recovered.set(failed.name, yield* unknownScheme);
            }
            env = recovered;
            lastType = tNil;
          }
        }
        rawExprIndex++;
      }

      // Discharge pending type class constraints
      const pending = yield* Ref.get(ctx.pendingConstraints);
      if (pending.length > 0) {
        const sFinal = yield* Ref.get(ctx.subst);
        const instanceReg = yield* Ref.get(ctx.instanceRegistry);
        const resolvedPending = pending.map((pc) => ({
          constraint: {
            className: pc.constraint.className,
            args: pc.constraint.args.map((a) => applyType(sFinal, a)),
          },
          origin: pc.origin,
        }));

        for (const pc of resolvedPending) {
          // Skip constraints with remaining unresolved type variables (deferred)
          const hasUnresolved = pc.constraint.args.some((a) => a._tag === "TVar");
          if (hasUnresolved) continue;

          // Only discharge constraints for classes that have instances registered.
          // If no instances exist yet, defer — the constraint may be resolved later.
          const instances = instanceReg.get(pc.constraint.className);
          if (!instances || instances.length === 0) continue;

          yield* resolveConstraints([pc.constraint], pc.origin);
        }
      }

      const sFinal = yield* Ref.get(ctx.subst);
      captureEnv?.(applyEnv(sFinal, env));
      return applyType(sFinal, lastType);
    } finally {
      setInferDslProvider(prevProvider);
      setInferRawExprs(prevRawExprs);
    }
  });

// ---------------------------------------------------------------------------
// inferProgramAll
// ---------------------------------------------------------------------------

/**
 * Infer types for all expressions in a program.
 * Returns an array of types, one per expression.
 */
export const inferProgramAll = (
  exprs: readonly CoreExpr[],
  initialEnv?: TypeEnv,
  dslProvider?: DSLTypeProvider,
  rawExprs?: readonly SExpr[],
): Effect.Effect<readonly Type[], InferenceError, InferContext> =>
  Effect.gen(function* () {
    // Set module-level provider for use by inferDSLForm
    const prevProvider = getInferDslProvider();
    const prevRawExprs = getInferRawExprs();
    setInferDslProvider(dslProvider);
    setInferRawExprs(rawExprs);

    try {
      const ctx = yield* InferContext;
      let env: TypeEnv = new Map(initialEnv ?? []);
      const types: Type[] = [];
      let rawExprIndex = 0;

      for (const expr of exprs) {
        const s = yield* Ref.get(ctx.subst);
        const envN = applyEnv(s, env);

        if (expr._tag === "TypeDef") {
          getAdtConstructorSchemes().clear();
          const t = (yield* withAmbientEffectScope(inferExpr(envN, expr))).value;
          const _adtConstructorSchemes = getAdtConstructorSchemes();
          if (_adtConstructorSchemes.size > 0) {
            const updatedEnv = new Map(applyEnv(yield* Ref.get(ctx.subst), env));
            for (const [name, scheme] of _adtConstructorSchemes) {
              updatedEnv.set(name, scheme);
            }
            env = updatedEnv;
            _adtConstructorSchemes.clear();
          }
          const sAfter = yield* Ref.get(ctx.subst);
          types.push(applyType(sAfter, t));
        } else if (expr._tag === "DefClass") {
          getClassMethodSchemes().clear();
          const t = (yield* withAmbientEffectScope(inferExpr(envN, expr))).value;
          const _classMethodSchemes = getClassMethodSchemes();
          if (_classMethodSchemes.size > 0) {
            const updatedEnv = new Map(applyEnv(yield* Ref.get(ctx.subst), env));
            for (const [name, scheme] of _classMethodSchemes) {
              updatedEnv.set(name, scheme);
            }
            env = updatedEnv;
            _classMethodSchemes.clear();
          }
          const sAfter = yield* Ref.get(ctx.subst);
          types.push(applyType(sAfter, t));
        } else if (expr._tag === "Instance") {
          const t = (yield* withAmbientEffectScope(inferExpr(envN, expr))).value;
          const sAfter = yield* Ref.get(ctx.subst);
          types.push(applyType(sAfter, t));
        } else if (expr._tag === "DefService") {
          getServiceMethodSchemes().clear();
          const t = (yield* withAmbientEffectScope(inferExpr(envN, expr))).value;
          const serviceMethodSchemes = getServiceMethodSchemes();
          if (serviceMethodSchemes.size > 0) {
            const updatedEnv = new Map(applyEnv(yield* Ref.get(ctx.subst), env));
            for (const [name, scheme] of serviceMethodSchemes) {
              updatedEnv.set(name, scheme);
            }
            env = updatedEnv;
            serviceMethodSchemes.clear();
          }
          const sAfter = yield* Ref.get(ctx.subst);
          types.push(applyType(sAfter, t));
        } else if (expr._tag === "Def") {
          const pendingStart = (yield* Ref.get(ctx.pendingConstraints)).length;
          const defT = (yield* withAmbientEffectScope(inferExpr(envN, expr))).value;
          const sAfter = yield* Ref.get(ctx.subst);
          const genEnv = applyEnv(sAfter, env);
          const boundType = applyType(sAfter, defT);
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
          const updatedEnv = new Map(applyEnv(sAfter, env));
          updatedEnv.set(expr.name, scheme);
          env = updatedEnv;
          types.push(applyType(sAfter, defT));
        } else if (expr._tag === "DSLForm" && dslProvider && rawExprs) {
          const rawExpr = findRawExprForDSLForm(expr, rawExprs, rawExprIndex);
          const t = (yield* withAmbientEffectScope(inferExpr(envN, expr))).value;

          // Add type bindings introduced by this form
          if (rawExpr) {
            const bindings = dslProvider.getTypeBindings(expr.name, rawExpr);
            if (bindings.size > 0) {
              const sAfter = yield* Ref.get(ctx.subst);
              const updatedEnv = new Map(applyEnv(sAfter, env));
              for (const [name, scheme] of bindings) {
                updatedEnv.set(name, scheme);
              }
              env = updatedEnv;
            }
          }

          const sAfter = yield* Ref.get(ctx.subst);
          types.push(applyType(sAfter, t));
        } else {
          const t = (yield* withAmbientEffectScope(inferExpr(envN, expr))).value;
          const sAfter = yield* Ref.get(ctx.subst);
          types.push(applyType(sAfter, t));
        }
        rawExprIndex++;
      }

      return types;
    } finally {
      setInferDslProvider(prevProvider);
      setInferRawExprs(prevRawExprs);
    }
  });

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
// Binding groups
// ---------------------------------------------------------------------------

/** Collect the names in `names` that `expr` mentions as variables. Shadowing
 * is ignored, so the result can only over-approximate the dependencies. */
function referencedNames(expr: unknown, names: ReadonlySet<string>, found: Set<string>): Set<string> {
  if (Array.isArray(expr)) {
    for (const item of expr) referencedNames(item, names, found);
  } else if (expr !== null && typeof expr === "object") {
    const node = expr as { readonly _tag?: unknown; readonly name?: unknown };
    if (node._tag === "Var" && typeof node.name === "string" && names.has(node.name)) found.add(node.name);
    if (node._tag === "LQuoted") return found;
    for (const [key, value] of Object.entries(expr)) {
      if (key !== "span" && key !== "signature") referencedNames(value, names, found);
    }
  }
  return found;
}

/**
 * Order a run of top-level definitions into strongly connected components,
 * dependencies first (Tarjan). Each component is typed and generalized before
 * the next, so a generic function stays generic in every later definition.
 */
export function definitionComponents<D extends { readonly name: string; readonly expr: CoreExpr }>(
  defs: readonly D[],
): D[][] {
  const byName = new Map<string, number>();
  defs.forEach((def, index) => byName.set(def.name, index));
  const names = new Set(byName.keys());
  const edges = defs.map((def) =>
    [...referencedNames(def.expr, names, new Set())].map((name) => byName.get(name)!),
  );
  const index: number[] = Array(defs.length).fill(-1);
  const low: number[] = Array(defs.length).fill(0);
  const onStack: boolean[] = Array(defs.length).fill(false);
  const stack: number[] = [];
  const components: D[][] = [];
  let counter = 0;
  const visit = (v: number): void => {
    index[v] = low[v] = counter++;
    stack.push(v);
    onStack[v] = true;
    for (const w of edges[v]!) {
      if (index[w] === -1) {
        visit(w);
        low[v] = Math.min(low[v]!, low[w]!);
      } else if (onStack[w]) {
        low[v] = Math.min(low[v]!, index[w]!);
      }
    }
    if (low[v] === index[v]) {
      const members: number[] = [];
      let w: number;
      do {
        w = stack.pop()!;
        onStack[w] = false;
        members.push(w);
      } while (w !== v);
      components.push(members.sort((a, b) => a - b).map((m) => defs[m]!));
    }
  };
  for (let v = 0; v < defs.length; v++) if (index[v] === -1) visit(v);
  return components;
}

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

            // Split the run of definitions into binding groups so each name is
            // generalized before the definitions that use it are typed.
            const lastDefType = new Map<string, Type>();
            for (const component of definitionComponents(defGroup)) {
              const seedEnv = new Map(applyEnv(yield* Ref.get(ctx.subst), env));
              for (const defExpr of component) {
                if (defExpr.signature) {
                  const tvarMap = new Map<string, Type>();
                  const rvarMap = new Map<string, Row>();
                  const sigT = yield* typeExprToType(defExpr.signature, tvarMap, rvarMap);
                  seedEnv.set(defExpr.name, {...mono(sigT),declaration:defExpr.span,annotation:defExpr.signature.span});
                } else if (!seedEnv.has(defExpr.name)) {
                  const placeholder = yield* ctx.freshTVar;
                  seedEnv.set(defExpr.name, {...mono(defExpr.expr._tag === "Lam" && !defExpr.expr.restParam
                    ? { ...placeholder, arity: defExpr.expr.params.length } : placeholder),declaration:defExpr.span});
                }
              }

              const inferredDefs: Array<{ name: string; type: Type; pendingStart: number; annotation?: import("./core-expr.js").Span; declaration: import("./core-expr.js").Span }> = [];
              const failedNames: string[] = [];
              for (const defExpr of component) {
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
                  declaration: defExpr.span,
                  ...(defExpr.signature ? {annotation:defExpr.signature.span} : {}),
                  type: boundType,
                  pendingStart,
                });
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
                  {...yield* generalizeBinding(baseGenEnv, inferredDef.type, inferredDef.pendingStart),declaration:inferredDef.declaration,...(inferredDef.annotation ? {annotation:inferredDef.annotation} : {})},
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
              for (const inferredDef of inferredDefs) lastDefType.set(inferredDef.name, inferredDef.type);
            }
            const finalType = lastDefType.get(defGroup[defGroup.length - 1]!.name);
            if (finalType) lastType = finalType;
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
          updatedEnv.set(expr.name, {...scheme,declaration:expr.span,...(expr.signature ? {annotation:expr.signature.span} : {})});
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

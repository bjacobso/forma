/**
 * Top-level program inference: inferProgram and inferProgramAll.
 *
 * These functions process a sequence of CoreExprs, maintaining the type
 * environment across definitions.
 */
import { Effect, Ref } from "effect";
import type { Type, Row, Scheme as SchemeType } from "./types.js";
import { tNil, fnType } from "./types.js";
import { applyType, applyEnv, type TypeEnv } from "./substitution.js";
import { InferContext } from "./context.js";
import { InferenceError } from "./errors.js";
import type { CoreExpr, Span, TypeExpr } from "./core-expr.js";
import type { DSLTypeProvider } from "./dsl-provider.js";
import type { SExpr } from "../reader/index.js";
import { resolveConstraints } from "./typeclass.js";
import { inferExpr, typeExprToType } from "./infer-core.js";
import { generalizeBinding, instantiate } from "./scheme-ops.js";
import {
  checkOperationalEffectAgainst,
  containsEffectSetVariables,
  extractOperationalEffect,
  solveEffectCall,
  validateEffectSignature,
} from "./effect-sets.js";
import { solveNumeric } from "./numeric.js";
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
import { reportHoles } from "./holes.js";
import {
  buildComponentCacheKey,
  captureCachedSccEntry,
  collectComponentNodes,
  getActiveSccMemoSession,
  isClosedEnv,
  isDocumentEligibleForSccMemo,
  replayCachedSccEntry,
} from "./scc-memo.js";

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
// Effect-set signature validation, call-site specialization & rigid checking
// ---------------------------------------------------------------------------

const validateSignatureEffectSets = (
  signature: TypeExpr,
  fallbackSpan: Span,
  knownServices: ReadonlySet<string>,
  allowSetVariables = true,
): Effect.Effect<void, InferenceError, InferContext> =>
  Effect.gen(function* () {
    const ctx = yield* InferContext;
    const knownErrors = yield* Ref.get(ctx.errorTypes);
    const diagnostics = validateEffectSignature(signature, {
      knownErrors,
      knownServices,
      allowSetVariables,
    });
    const first = diagnostics[0];
    if (first) {
      const span = first.span ?? fallbackSpan;
      return yield* ctx.fail(
        { nodeId: `effect-sig:${span.start}`, span, kind: "effect-signature" },
        { code: first.code, message: first.message },
      );
    }
  });

function hasEffectPolyBinding(env: TypeEnv): boolean {
  for (const scheme of env.values()) {
    if (containsEffectSetVariables(scheme.type)) return true;
  }
  return false;
}

let effectPolySpecializationCounter = 0;

/**
 * Probe the inferred type of an argument expression without committing
 * speculative substitutions or constraints to `InferContext`.
 */
const probeArgumentType = (
  env: TypeEnv,
  arg: CoreExpr,
  paramHint: Type | undefined,
): Effect.Effect<Type | undefined, never, InferContext> =>
  Effect.gen(function* () {
    const ctx = yield* InferContext;
    const substBefore = yield* Ref.get(ctx.subst);
    const pendingBefore = yield* Ref.get(ctx.pendingConstraints);
    const holesBefore = yield* Ref.get(ctx.holes);

    const probe = Effect.gen(function* () {
      if (arg._tag === "Lam" && !arg.restParam && paramHint?._tag === "TFun") {
        const lamEnv = new Map(env);
        const paramTypes: Type[] = [];
        let cursor: Type | undefined = paramHint;
        for (const param of arg.params) {
          const pType = cursor?._tag === "TFun" ? cursor.arg : yield* ctx.freshTVar;
          cursor = cursor?._tag === "TFun" ? cursor.res : undefined;
          paramTypes.push(pType);
          lamEnv.set(param.name, mono(pType));
        }
        const bodyType = yield* inferExpr(lamEnv, arg.body);
        const s = yield* Ref.get(ctx.subst);
        return fnType(
          paramTypes.map((p) => applyType(s, p)),
          applyType(s, bodyType),
        );
      }
      const inferred = yield* inferExpr(env, arg);
      return applyType(yield* Ref.get(ctx.subst), inferred);
    });

    const result = yield* Effect.result(withAmbientEffectScope(probe));
    yield* Ref.set(ctx.subst, substBefore);
    yield* Ref.set(ctx.pendingConstraints, pendingBefore);
    yield* Ref.set(ctx.holes, holesBefore);
    return result._tag === "Success" ? result.success.value : undefined;
  });

/**
 * Specialize call sites of effect-polymorphic bindings (RFC 0023 §3) in `expr`
 * by solving their `[e]`/`[r]` set variables from argument lower bounds into
 * closed call-site schemes.
 */
const specializeEffectPolyCalls = (
  expr: CoreExpr,
  env: TypeEnv,
  defSigType?: Type,
): Effect.Effect<{ readonly expr: CoreExpr; readonly env: TypeEnv }, InferenceError, InferContext> =>
  Effect.gen(function* () {
    if (!hasEffectPolyBinding(env)) return { expr, env };

    const ctx = yield* InferContext;
    const specializations = new Map<string, SchemeType>();
    const initialPolyCallees = new Set<string>();
    for (const [name, scheme] of env) {
      if (containsEffectSetVariables(scheme.type)) initialPolyCallees.add(name);
    }

    const withoutNames = (names: ReadonlySet<string>, shadowed: readonly string[]): ReadonlySet<string> => {
      if (!shadowed.some((name) => names.has(name))) return names;
      const next = new Set(names);
      for (const name of shadowed) next.delete(name);
      return next;
    };

    const visit = (
      node: CoreExpr,
      localEnv: TypeEnv,
      polyCallees: ReadonlySet<string>,
      expectedType?: Type,
    ): Effect.Effect<CoreExpr, InferenceError, InferContext> =>
      Effect.gen(function* () {
        switch (node._tag) {
          case "Def": {
            const innerEnv = new Map(localEnv);
            if (defSigType) {
              innerEnv.set(node.name, mono(defSigType));
            }
            const nextExpr = yield* visit(
              node.expr,
              innerEnv,
              withoutNames(polyCallees, [node.name]),
              defSigType,
            );
            return nextExpr === node.expr ? node : { ...node, expr: nextExpr };
          }
          case "Lam": {
            const lamEnv = new Map(localEnv);
            let cursor = expectedType;
            const paramNames: string[] = [];
            for (const param of node.params) {
              const pType = cursor?._tag === "TFun" ? cursor.arg : yield* ctx.freshTVar;
              cursor = cursor?._tag === "TFun" ? cursor.res : undefined;
              lamEnv.set(param.name, mono(pType));
              paramNames.push(param.name);
            }
            if (node.restParam) paramNames.push(node.restParam.name);
            const nextBody = yield* visit(
              node.body,
              lamEnv,
              withoutNames(polyCallees, paramNames),
              cursor,
            );
            return nextBody === node.body ? node : { ...node, body: nextBody };
          }
          case "Let": {
            let letEnv = new Map(localEnv);
            let letPoly = polyCallees;
            const nextBindings = [];
            let changed = false;
            for (const binding of node.bindings) {
              const nextBindExpr = yield* visit(binding.expr, letEnv, letPoly);
              if (nextBindExpr !== binding.expr) changed = true;
              nextBindings.push(nextBindExpr === binding.expr ? binding : { ...binding, expr: nextBindExpr });
              const probed = yield* probeArgumentType(letEnv, nextBindExpr, undefined);
              if (probed) letEnv.set(binding.name, mono(probed));
              letPoly = withoutNames(letPoly, [binding.name]);
            }
            const nextBody = yield* visit(node.body, letEnv, letPoly, expectedType);
            if (nextBody !== node.body) changed = true;
            return changed ? { ...node, bindings: nextBindings, body: nextBody } : node;
          }
          case "EffectDo": {
            const doEnv = new Map(localEnv);
            let doPoly = polyCallees;
            const nextBindings = [];
            let changed = false;
            for (const binding of node.bindings) {
              const nextBindExpr = yield* visit(binding.expr, doEnv, doPoly);
              if (nextBindExpr !== binding.expr) changed = true;
              nextBindings.push(nextBindExpr === binding.expr ? binding : { ...binding, expr: nextBindExpr });
              const probed = yield* probeArgumentType(doEnv, nextBindExpr, undefined);
              const eff = probed ? extractOperationalEffect(probed) : undefined;
              if (eff) doEnv.set(binding.name, mono(eff.success));
              doPoly = withoutNames(doPoly, [binding.name]);
            }
            const nextBody = yield* visit(node.body, doEnv, doPoly);
            if (nextBody !== node.body) changed = true;
            return changed ? { ...node, bindings: nextBindings, body: nextBody } : node;
          }
          case "EffectFail": {
            const nextPayload = yield* visit(node.payload, localEnv, polyCallees);
            return nextPayload === node.payload ? node : { ...node, payload: nextPayload };
          }
          case "EffectCatch": {
            const nextBody = yield* visit(node.body, localEnv, polyCallees);
            const nextHandler = yield* visit(
              node.handler,
              localEnv,
              withoutNames(polyCallees, [node.binding.name]),
            );
            return nextBody === node.body && nextHandler === node.handler
              ? node
              : { ...node, body: nextBody, handler: nextHandler };
          }
          case "If": {
            const nextCond = yield* visit(node.cond, localEnv, polyCallees);
            const nextThen = yield* visit(node.then, localEnv, polyCallees, expectedType);
            const nextElse = yield* visit(node.else_, localEnv, polyCallees, expectedType);
            return nextCond === node.cond && nextThen === node.then && nextElse === node.else_
              ? node
              : { ...node, cond: nextCond, then: nextThen, else_: nextElse };
          }
          case "Record": {
            const nextFields = [];
            let changed = false;
            for (const field of node.fields) {
              const nextVal = yield* visit(field.value, localEnv, polyCallees);
              if (nextVal !== field.value) changed = true;
              nextFields.push(nextVal === field.value ? field : { ...field, value: nextVal });
            }
            return changed ? { ...node, fields: nextFields } : node;
          }
          case "Get": {
            const nextRec = yield* visit(node.record, localEnv, polyCallees);
            return nextRec === node.record ? node : { ...node, record: nextRec };
          }
          case "Match": {
            const nextScrut = yield* visit(node.scrutinee, localEnv, polyCallees);
            const nextArms = [];
            let changed = nextScrut !== node.scrutinee;
            for (const arm of node.arms) {
              const nextArmBody = yield* visit(arm.body, localEnv, polyCallees, expectedType);
              if (nextArmBody !== arm.body) changed = true;
              nextArms.push(nextArmBody === arm.body ? arm : { ...arm, body: nextArmBody });
            }
            return changed ? { ...node, scrutinee: nextScrut, arms: nextArms } : node;
          }
          case "Ascribe": {
            const nextInner = yield* visit(node.expr, localEnv, polyCallees);
            return nextInner === node.expr ? node : { ...node, expr: nextInner };
          }
          case "App": {
            const nextFn = yield* visit(node.fn, localEnv, polyCallees);
            const nextArgs: CoreExpr[] = [];
            let changed = nextFn !== node.fn;
            for (const arg of node.args) {
              const nextArg = yield* visit(arg, localEnv, polyCallees);
              if (nextArg !== arg) changed = true;
              nextArgs.push(nextArg);
            }

            if (nextFn._tag === "Var" && polyCallees.has(nextFn.name)) {
              const calleeScheme = localEnv.get(nextFn.name);
              if (calleeScheme && containsEffectSetVariables(calleeScheme.type)) {
                const instType = yield* instantiate(calleeScheme);
                const paramHints: Array<Type | undefined> = [];
                let cursor: Type | undefined = instType;
                for (let i = 0; i < nextArgs.length; i++) {
                  if (cursor?._tag === "TFun") {
                    paramHints.push(cursor.arg);
                    cursor = cursor.res;
                  } else {
                    paramHints.push(undefined);
                  }
                }
                const argTypes: Type[] = [];
                let allProbed = true;
                for (let i = 0; i < nextArgs.length; i++) {
                  const probed = yield* probeArgumentType(localEnv, nextArgs[i]!, paramHints[i]);
                  if (!probed) {
                    allProbed = false;
                    break;
                  }
                  argTypes.push(probed);
                }
                if (allProbed) {
                  const solved = solveEffectCall(calleeScheme.type, argTypes, {
                    callSpan: node.span,
                    argSpans: nextArgs.map((a) => a.span),
                  });
                  const specializedName = `__effect_poly_${nextFn.name}_${++effectPolySpecializationCounter}`;
                  specializations.set(specializedName, {
                    ...calleeScheme,
                    type: solved.calleeType,
                  });
                  return {
                    ...node,
                    fn: { ...nextFn, name: specializedName },
                    args: nextArgs,
                  };
                }
              }
            }

            return changed ? { ...node, fn: nextFn, args: nextArgs } : node;
          }
          default:
            return node;
        }
      });

    const rewritten = yield* visit(expr, env, initialPolyCallees, defSigType);
    if (specializations.size === 0) return { expr: rewritten, env };
    const extendedEnv = new Map(env);
    for (const [name, scheme] of specializations) {
      extendedEnv.set(name, scheme);
    }
    return { expr: rewritten, env: extendedEnv };
  });

/**
 * When a signed `Def` returning an operational `Effect` fails typechecking,
 * rigidly check its body's error and requirement sets against its declared
 * signature so escaped set variables or undeclared entries report
 * `mechanics/undeclared-error` / `mechanics/undeclared-requirement` naming the
 * operation and variable.
 */
const refineEffectDefFailure = (
  defExpr: CoreExpr & { _tag: "Def" },
  sigT: Type,
  env: TypeEnv,
  originalError: InferenceError,
): Effect.Effect<InferenceError, never, InferContext> =>
  Effect.gen(function* () {
    if (!defExpr.signature) return originalError;
    const ctx = yield* InferContext;
    const bodyEnv = new Map(env);
    bodyEnv.set(defExpr.name, mono(sigT));

    let declaredCursor = sigT;
    let bodyExpr = defExpr.expr;
    if (defExpr.expr._tag === "Lam" && !defExpr.expr.restParam) {
      for (const param of defExpr.expr.params) {
        if (declaredCursor._tag !== "TFun") return originalError;
        bodyEnv.set(param.name, mono(declaredCursor.arg));
        declaredCursor = declaredCursor.res;
      }
      bodyExpr = defExpr.expr.body;
    }

    const declaredEffect = extractOperationalEffect(declaredCursor, defExpr.signature.span);
    if (!declaredEffect) return originalError;

    const actualBodyType = yield* probeArgumentType(bodyEnv, bodyExpr, undefined);
    if (!actualBodyType) return originalError;

    const actualEffect = extractOperationalEffect(actualBodyType, bodyExpr.span);
    if (!actualEffect) return originalError;

    const diagnostics = checkOperationalEffectAgainst(
      actualEffect,
      declaredEffect,
      `operation ${defExpr.name}`,
      bodyExpr.span,
    );
    const first = diagnostics[0];
    if (!first) return originalError;

    const span = first.span ?? bodyExpr.span;
    const sigSpan = defExpr.signature.span;
    return new InferenceError({
      message: first.message,
      origin: { nodeId: bodyExpr.id, span, kind: "effect-signature" },
      details: { code: first.code, message: first.message },
      related: [
        {
          message: "Expected type declared here",
          span: {
            sourceId: sigSpan.sourceId ?? "",
            startOffset: sigSpan.start,
            endOffset: sigSpan.end,
          },
        },
      ],
    });
  });

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
      const knownServices = new Set<string>();
      let lastType: Type = tNil;
      // Closed successful components are reused only inside an analysis workspace,
      // for documents without holes, declarations, descriptors or macros.
      const session = getActiveSccMemoSession();
      const memo = session !== undefined &&
        isDocumentEligibleForSccMemo(exprs, rawExprs) && isClosedEnv(env) &&
        (yield* Ref.get(ctx.pendingConstraints)).length === 0
        ? session : undefined;
      if (session !== undefined && memo === undefined) session.cache.recordFallback();
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
        yield* Ref.set(ctx.globalNames, new Set(env.keys()));

        const inferForm = Effect.gen(function* () {
          if (expr._tag === "TypeDef") {
            // Clear any previous constructor schemes
            getAdtConstructorSchemes().clear();
            lastType = (yield* withAmbientEffectScope(inferExpr(envN, expr))).value;
            // Register constructor schemes in the environment
            const _adtConstructorSchemes = getAdtConstructorSchemes();
            if (_adtConstructorSchemes.size > 0) {
              const updatedEnv = applyEnv(yield* Ref.get(ctx.subst), env);
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
              const updatedEnv = applyEnv(yield* Ref.get(ctx.subst), env);
              for (const [name, scheme] of _classMethodSchemes) {
                updatedEnv.set(name, scheme);
              }
              env = updatedEnv;
              _classMethodSchemes.clear();
            }
          } else if (expr._tag === "Instance") {
            lastType = (yield* withAmbientEffectScope(inferExpr(envN, expr))).value;
          } else if (expr._tag === "DefService") {
            for (const method of expr.methods) {
              yield* validateSignatureEffectSets(method.typeExpr, expr.span, knownServices, false);
            }
            knownServices.add(expr.name);
            getServiceMethodSchemes().clear();
            lastType = (yield* withAmbientEffectScope(inferExpr(envN, expr))).value;
            const serviceMethodSchemes = getServiceMethodSchemes();
            if (serviceMethodSchemes.size > 0) {
              const updatedEnv = applyEnv(yield* Ref.get(ctx.subst), env);
              for (const [name, scheme] of serviceMethodSchemes) {
                updatedEnv.set(name, scheme);
              }
              env = updatedEnv;
              serviceMethodSchemes.clear();
            }
          } else if (expr._tag === "DefLayer") {
            const layerT = (yield* withAmbientEffectScope(inferExpr(envN, expr))).value;
            const sAfter = yield* Ref.get(ctx.subst);
            const updatedEnv = applyEnv(sAfter, env);
            updatedEnv.set(expr.name, {
              ...mono(applyType(sAfter, layerT)),
              declaration: expr.span,
              ...(expr.signature ? { annotation: expr.signature.span } : {}),
            });
            env = updatedEnv;
            lastType = applyType(sAfter, layerT);
          } else if (expr._tag === "Def") {
            const defGroup: Array<CoreExpr & { _tag: "Def" }> = [expr];
            while (exprIndex + 1 < exprs.length && exprs[exprIndex + 1]!._tag === "Def") {
              defGroup.push(exprs[++exprIndex]! as CoreExpr & { _tag: "Def" });
            }

            // Split the run of definitions into binding groups so each name is
            // generalized before the definitions that use it are typed.
            const lastDefType = new Map<string, Type>();
            let envOwned = false;
            for (const component of definitionComponents(defGroup)) {
              let memoKey: string | null = null;
              if (memo !== undefined) {
                memoKey = buildComponentCacheKey(memo.scopeKey, component, env);
                const cached = memoKey === null ? undefined : memo.cache.get(memoKey);
                if (cached !== undefined) {
                  const supply = yield* ctx.supply;
                  const replay = replayCachedSccEntry(cached, component, supply.type, supply.row, supply.effect);
                  yield* ctx.reserveSupply(cached.tvarsAllocated, cached.rvarsAllocated, cached.evarsAllocated);
                  const nodes = collectComponentNodes(component);
                  yield* Ref.update(ctx.nodeTypes, (types) => {
                    // The analysis builder is operation-owned; see makeOwnedInferContext.
                    replay.nodeTypes.forEach((type, index) => {
                      if (type !== undefined) types.set(nodes[index]!.id, type);
                    });
                    return types;
                  });
                  if (!envOwned) { env = new Map(env); envOwned = true; }
                  const mutable = env as Map<string, import("./types.js").Scheme>;
                  component.forEach((defExpr, index) => {
                    mutable.set(defExpr.name, replay.schemes[index]!);
                    lastDefType.set(defExpr.name, replay.defTypes[index]!);
                  });
                  memo.cache.recordHit();
                  continue;
                }
                if (memoKey !== null) memo.cache.recordMiss(); else memo.cache.recordFallback();
              }
              const supplyBefore = memoKey !== null ? yield* ctx.supply : undefined;
              const diagnosticsBefore = memoKey !== null ? (yield* Ref.get(ctx.diagnostics)).length : 0;
              const pendingBeforeComponent = memoKey !== null ? (yield* Ref.get(ctx.pendingConstraints)).length : 0;
              const seedEnv = applyEnv(yield* Ref.get(ctx.subst), env);
              const sigTypes = new Map<string, Type>();
              for (const defExpr of component) {
                if (defExpr.signature) {
                  yield* validateSignatureEffectSets(defExpr.signature, defExpr.span, knownServices, true);
                  const tvarMap = new Map<string, Type>();
                  const rvarMap = new Map<string, Row>();
                  const sigT = yield* typeExprToType(defExpr.signature, tvarMap, rvarMap);
                  sigTypes.set(defExpr.name, sigT);
                  seedEnv.set(defExpr.name, {...mono(sigT),declaration:defExpr.span,annotation:defExpr.signature.span});
                } else if (!seedEnv.has(defExpr.name)) {
                  const placeholder = yield* ctx.freshTVar;
                  seedEnv.set(defExpr.name, {...mono(defExpr.expr._tag === "Lam" && !defExpr.expr.restParam
                    ? { ...placeholder, arity: defExpr.expr.params.length } : placeholder),declaration:defExpr.span});
                }
              }

              const inferredDefs: Array<{ name: string; type: Type; pendingStart: number; annotation?: import("./core-expr.js").Span; declaration: import("./core-expr.js").Span }> = [];
              yield* Ref.set(ctx.globalNames, new Set(seedEnv.keys()));
              const failedNames: string[] = [];
              for (const defExpr of component) {
                const pendingStart = (yield* Ref.get(ctx.pendingConstraints)).length;
                const sigT = sigTypes.get(defExpr.name);
                const specialized = yield* specializeEffectPolyCalls(defExpr, seedEnv, sigT);
                const rawInferDef = withAmbientEffectScope(inferExpr(specialized.env, specialized.expr));
                const inferDef = sigT
                  ? rawInferDef.pipe(
                      Effect.catch((err) =>
                        Effect.flatMap(
                          refineEffectDefFailure(
                            specialized.expr as CoreExpr & { _tag: "Def" },
                            sigT,
                            specialized.env,
                            err,
                          ),
                          (refined) => Effect.fail(refined),
                        ),
                      ),
                    )
                  : rawInferDef;
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
              envOwned = true;
              for (const inferredDef of inferredDefs) lastDefType.set(inferredDef.name, inferredDef.type);

              if (memo !== undefined && memoKey !== null && supplyBefore !== undefined &&
                  failedNames.length === 0 && inferredDefs.length === component.length &&
                  (yield* Ref.get(ctx.pendingConstraints)).length === pendingBeforeComponent &&
                  (yield* Ref.get(ctx.diagnostics)).length === diagnosticsBefore) {
                const supplyAfter = yield* ctx.supply;
                const settled = yield* Ref.get(ctx.subst);
                const nodeTypes = yield* Ref.get(ctx.nodeTypes);
                const entry = captureCachedSccEntry({
                  tStart: supplyBefore.type, tEnd: supplyAfter.type,
                  rStart: supplyBefore.row, rEnd: supplyAfter.row,
                  eStart: supplyBefore.effect, eEnd: supplyAfter.effect,
                  schemes: inferredDefs.map((def) => schemes.get(def.name)!),
                  defTypes: inferredDefs.map((def) => applyType(settled, def.type)),
                  nodeTypes: collectComponentNodes(component).map((node) => {
                    const recorded = nodeTypes.get(node.id);
                    return recorded === undefined ? undefined : applyType(settled, recorded);
                  }),
                });
                if (entry === null) memo.cache.recordFallback();
                else { memo.cache.set(memoKey, entry); memo.cache.recordStore(); }
              }
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
                const updatedEnv = applyEnv(sAfter, env);
                for (const [name, scheme] of bindings) {
                  updatedEnv.set(name, scheme);
                }
                env = updatedEnv;
              }
            }
          } else {
            const specialized = yield* specializeEffectPolyCalls(expr, envN);
            lastType = (yield* withAmbientEffectScope(inferExpr(specialized.env, specialized.expr))).value;
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

      yield* solveNumeric(true);
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
      yield* reportHoles;
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
      const knownServices = new Set<string>();
      const types: Type[] = [];
      let rawExprIndex = 0;

      for (const expr of exprs) {
        yield* Ref.set(ctx.globalNames, new Set(env.keys()));
        const s = yield* Ref.get(ctx.subst);
        const envN = applyEnv(s, env);

        if (expr._tag === "TypeDef") {
          getAdtConstructorSchemes().clear();
          const t = (yield* withAmbientEffectScope(inferExpr(envN, expr))).value;
          const _adtConstructorSchemes = getAdtConstructorSchemes();
          if (_adtConstructorSchemes.size > 0) {
            const updatedEnv = applyEnv(yield* Ref.get(ctx.subst), env);
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
            const updatedEnv = applyEnv(yield* Ref.get(ctx.subst), env);
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
          for (const method of expr.methods) {
            yield* validateSignatureEffectSets(method.typeExpr, expr.span, knownServices, false);
          }
          knownServices.add(expr.name);
          getServiceMethodSchemes().clear();
          const t = (yield* withAmbientEffectScope(inferExpr(envN, expr))).value;
          const serviceMethodSchemes = getServiceMethodSchemes();
          if (serviceMethodSchemes.size > 0) {
            const updatedEnv = applyEnv(yield* Ref.get(ctx.subst), env);
            for (const [name, scheme] of serviceMethodSchemes) {
              updatedEnv.set(name, scheme);
            }
            env = updatedEnv;
            serviceMethodSchemes.clear();
          }
          const sAfter = yield* Ref.get(ctx.subst);
          types.push(applyType(sAfter, t));
        } else if (expr._tag === "DefLayer") {
          const layerT = (yield* withAmbientEffectScope(inferExpr(envN, expr))).value;
          const sAfter = yield* Ref.get(ctx.subst);
          const updatedEnv = applyEnv(sAfter, env);
          updatedEnv.set(expr.name, {
            ...mono(applyType(sAfter, layerT)),
            declaration: expr.span,
            ...(expr.signature ? { annotation: expr.signature.span } : {}),
          });
          env = updatedEnv;
          types.push(applyType(sAfter, layerT));
        } else if (expr._tag === "Def") {
          const pendingStart = (yield* Ref.get(ctx.pendingConstraints)).length;
          let sigT: Type | undefined;
          if (expr.signature) {
            yield* validateSignatureEffectSets(expr.signature, expr.span, knownServices, true);
            sigT = yield* typeExprToType(expr.signature, new Map(), new Map());
          }
          const specialized = yield* specializeEffectPolyCalls(expr, envN, sigT);
          const rawInferDef = withAmbientEffectScope(inferExpr(specialized.env, specialized.expr));
          const defT = (yield* (sigT
            ? rawInferDef.pipe(
                Effect.catch((err) =>
                  Effect.flatMap(
                    refineEffectDefFailure(
                      specialized.expr as CoreExpr & { _tag: "Def" },
                      sigT,
                      specialized.env,
                      err,
                    ),
                    (refined) => Effect.fail(refined),
                  ),
                ),
              )
            : rawInferDef)).value;
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
          const updatedEnv = applyEnv(sAfter, env);
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
              const updatedEnv = applyEnv(sAfter, env);
              for (const [name, scheme] of bindings) {
                updatedEnv.set(name, scheme);
              }
              env = updatedEnv;
            }
          }

          const sAfter = yield* Ref.get(ctx.subst);
          types.push(applyType(sAfter, t));
        } else {
          const specialized = yield* specializeEffectPolyCalls(expr, envN);
          const t = (yield* withAmbientEffectScope(inferExpr(specialized.env, specialized.expr))).value;
          const sAfter = yield* Ref.get(ctx.subst);
          types.push(applyType(sAfter, t));
        }
        rawExprIndex++;
      }

      yield* solveNumeric(true);
      yield* reportHoles;
      const finalSubst = yield* Ref.get(ctx.subst);
      return types.map(type => applyType(finalSubst, type));
    } finally {
      setInferDslProvider(prevProvider);
      setInferRawExprs(prevRawExprs);
    }
  });

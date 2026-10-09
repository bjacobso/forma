/**
 * Inference for control flow: if (with type narrowing) and match (with exhaustiveness).
 */
import { Effect, Ref } from "effect";
import type { Type, Scheme } from "./types.js";
import { TApp, TCon, TRow, RExtend, tNil, tStr, tNum, tBool, mono, showType } from "./types.js";
import { applyType, applyEnv, type TypeEnv } from "./substitution.js";
import { assignType, joinType } from "./assign.js";
import { unify } from "./unify.js";
import { InferContext } from "./context.js";
import { InferenceError } from "./errors.js";
import type { CoreExpr } from "./core-expr.js";
import { TESym } from "./core-expr.js";
import { originOf, detectTypeNarrowing, typeExprToType } from "./infer-core.js";
import { instantiate } from "./scheme-ops.js";
import type { InferFn } from "./infer-binding.js";

// ---------------------------------------------------------------------------
// If
// ---------------------------------------------------------------------------

export const inferIf = (
  env: TypeEnv,
  expr: CoreExpr & { _tag: "If" },
  inferExpr: InferFn,
): Effect.Effect<Type, InferenceError, InferContext> =>
  Effect.gen(function* () {
    const ctx = yield* InferContext;

    yield* assignType(yield* inferExpr(env,expr.cond),tBool,originOf(expr,"condition"));

    // Detect type narrowing from predicate conditions
    const narrowing = detectTypeNarrowing(expr.cond);

    const s1 = yield* Ref.get(ctx.subst);
    let thenEnv = applyEnv(s1, env);

    if (narrowing) {
      // Narrow the variable's type in the then-branch
      const narrowedEnv = new Map(thenEnv);
      narrowedEnv.set(narrowing.varName, mono(narrowing.narrowedType));
      thenEnv = narrowedEnv;
    }

    const thenT = yield* inferExpr(thenEnv, expr.then);

    const s2 = yield* Ref.get(ctx.subst);
    const elseT = yield* inferExpr(applyEnv(s2, env), expr.else_);

    // Check for LNil literals introduced by when/unless/if-without-else sugar.
    const isNilThen = expr.then._tag === "Lit" && expr.then.lit._tag === "LNil";
    const isNilElse = expr.else_._tag === "Lit" && expr.else_.lit._tag === "LNil";

    if (isNilThen) {
      const sFinal = yield* Ref.get(ctx.subst);
      return applyType(sFinal, elseT);
    }

    if (!isNilElse) {
      const subst = yield* Ref.get(ctx.subst);
      const resolvedThen = applyType(subst, thenT);
      const resolvedElse = applyType(subst, elseT);
      const thenEffect = operationalEffectParts(resolvedThen);
      const elseEffect = operationalEffectParts(resolvedElse);

      if (thenEffect || elseEffect) {
        const thenSuccess = thenEffect?.success ?? resolvedThen;
        const elseSuccess = elseEffect?.success ?? resolvedElse;
        yield* unify(thenSuccess, elseSuccess, originOf(expr, "if-branches"));
        const mergedSubst = yield* Ref.get(ctx.subst);
        return operationalEffectType(
          applyType(mergedSubst, thenSuccess),
          mergeTypeSets(thenEffect?.errors ?? [], elseEffect?.errors ?? []),
          mergeTypeSets(thenEffect?.requirements ?? [], elseEffect?.requirements ?? []),
        );
      }

      return yield* joinType(resolvedThen, resolvedElse, originOf(expr, "if-branches"));
    }

    const sFinal = yield* Ref.get(ctx.subst);
    return applyType(sFinal, thenT);
  });

interface OperationalEffectParts {
  readonly success: Type;
  readonly errors: readonly Type[];
  readonly requirements: readonly Type[];
}

function namedTypeApp(type: Type, name: string): readonly Type[] | undefined {
  if (type._tag !== "TApp" || type.con._tag !== "TCon" || type.con.name !== name) {
    return undefined;
  }
  return type.args;
}

function operationalEffectParts(type: Type): OperationalEffectParts | undefined {
  if (type._tag !== "TApp" || type.con._tag !== "TCon" || type.con.name !== "Effect") {
    return undefined;
  }
  const [success, errors, requirements] = type.args;
  if (!success || !errors || !requirements || type.args.length !== 3) {
    return undefined;
  }
  const errorItems = namedTypeApp(errors, "ErrorSet");
  const requirementItems = namedTypeApp(requirements, "RequirementSet");
  if (!errorItems || !requirementItems) {
    return undefined;
  }
  return { success, errors: errorItems, requirements: requirementItems };
}

function mergeTypeSets(left: readonly Type[], right: readonly Type[]): readonly Type[] {
  const seen = new Set<string>();
  const merged: Type[] = [];
  for (const type of [...left, ...right]) {
    const key = showType(type);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(type);
  }
  return merged;
}

function operationalEffectType(
  success: Type,
  errors: readonly Type[],
  requirements: readonly Type[],
): Type {
  return TApp(TCon("Effect"), [
    success,
    TApp(TCon("ErrorSet"), errors),
    TApp(TCon("RequirementSet"), requirements),
  ]);
}

// ---------------------------------------------------------------------------
// Operational failure and recovery
// ---------------------------------------------------------------------------

export const inferEffectFail = (
  env: TypeEnv,
  expr: CoreExpr & { _tag: "EffectFail" },
  inferExpr: InferFn,
): Effect.Effect<Type, InferenceError, InferContext> =>
  Effect.gen(function* () {
    const ctx = yield* InferContext;
    const errorTypes = yield* Ref.get(ctx.errorTypes);
    if (!errorTypes.has(expr.errorName)) {
      return yield* ctx.fail(originOf(expr, "effect-fail"), {
        code: "typecheck/unknown-type", message: `Unknown error type ${expr.errorName}. Define it with error before using fail.`,
      });
    }
    const payloadType = yield* inferExpr(env, expr.payload);
    const shapes = yield* Ref.get(ctx.nominalRecords);
    const shape = shapes.get(expr.errorName);
    const expectedPayload = shape?._tag === "TRow" && shape.row._tag === "RExtend" && shape.row.label === ":_tag"
      ? { ...shape, row: shape.row.tail }
      : yield* typeExprToType(TESym(expr.span, expr.errorName), new Map<string, Type>(), new Map());
    yield* unify(
      applyType(yield* Ref.get(ctx.subst), expectedPayload),
      applyType(yield* Ref.get(ctx.subst), payloadType),
      originOf(expr, "effect-fail-payload"),
    );
    return operationalEffectType(yield* ctx.freshTVar, [TCon(expr.errorName)], []);
  });

export const inferEffectCatch = (
  env: TypeEnv,
  expr: CoreExpr & { _tag: "EffectCatch" },
  inferExpr: InferFn,
): Effect.Effect<Type, InferenceError, InferContext> =>
  Effect.gen(function* () {
    const ctx = yield* InferContext;
    const errorTypes = yield* Ref.get(ctx.errorTypes);
    if (!errorTypes.has(expr.errorName)) {
      return yield* ctx.fail(originOf(expr, "effect-catch"), {
        code: "typecheck/unknown-type", message: `Unknown error type ${expr.errorName}. Define it with error before using catch.`,
      });
    }
    const bodyType = applyType(yield* Ref.get(ctx.subst), yield* inferExpr(env, expr.body));
    const bodyEffect = operationalEffectParts(bodyType);
    if (!bodyEffect) {
      return yield* ctx.fail(originOf(expr, "effect-catch"), {
        code: "typecheck/type-mismatch", message: `catch expects Effect, received ${showType(bodyType)}.`,
      });
    }

    const handled = bodyEffect.errors.find(
      (error) => error._tag === "TCon" && error.name === expr.errorName,
    );
    if (!handled) {
      return yield* ctx.fail(originOf(expr, "effect-catch"), {
        code: "typecheck/effect-set", message: `Impossible catch: ${expr.errorName} is not in ${showType(bodyType)}.`,
      });
    }

    const payloadType = yield* typeExprToType(
      TESym(expr.binding.span, expr.errorName),
      new Map<string, Type>(),
      new Map(),
    );
    const handlerEnv = new Map(applyEnv(yield* Ref.get(ctx.subst), env));
    handlerEnv.set(expr.binding.name, mono(payloadType));
    const handlerType = applyType(
      yield* Ref.get(ctx.subst),
      yield* inferExpr(handlerEnv, expr.handler),
    );
    const handlerEffect = operationalEffectParts(handlerType);
    const handlerSuccess = handlerEffect?.success ?? handlerType;
    yield* unify(bodyEffect.success, handlerSuccess, originOf(expr, "effect-catch-result"));

    const subst = yield* Ref.get(ctx.subst);
    return operationalEffectType(
      applyType(subst, bodyEffect.success),
      mergeTypeSets(
        bodyEffect.errors.filter(
          (error) => !(error._tag === "TCon" && error.name === expr.errorName),
        ),
        handlerEffect?.errors ?? [],
      ),
      mergeTypeSets(bodyEffect.requirements, handlerEffect?.requirements ?? []),
    );
  });

// ---------------------------------------------------------------------------
// Match (pattern matching)
// ---------------------------------------------------------------------------

/** Infer nested data patterns with the same binders used by the evaluator. */
function inferDataPattern(env: TypeEnv, syntax: import("../reader/types.js").SExpr, expected: Type, expr: CoreExpr): Effect.Effect<Map<string, Scheme>, InferenceError, InferContext> {
  return Effect.gen(function* () {
    const ctx = yield* InferContext;
    const bindings = new Map<string, Scheme>(env);
    const bound = new Map<string, Type>();
    const visit = (p: import("../reader/types.js").SExpr, t: Type): Effect.Effect<void, InferenceError, InferContext> => Effect.gen(function* () {
      const origin = originOf(expr, "match-pattern");
      if (p._tag === "Sym" && p.name === "_") return;
      if (p._tag === "Sym" && /^[a-z_$]/.test(p.name) && p.name !== "nil") {
        const previous = bound.get(p.name);
        if (previous) yield* unify(previous, t, origin);
        bound.set(p.name, t); bindings.set(p.name, mono(t)); return;
      }
      if (p._tag === "Map") {
        const as = p.pairs.find(([k])=>k._tag === "Sym" && k.name === ":as")?.[1];
        if (as) yield* visit(as,t);
        const fields = p.pairs
          .filter(([key]) => !(key._tag === "Sym" && key.name === ":as"))
          .flatMap(([key, value]) => {
            if (key._tag === "Sym" && key.name === ":keys" && value._tag === "Vector") {
              return value.items.map(binding => [binding._tag === "Sym" ? `:${binding.name}` : "", binding] as const);
            }
            const label = key._tag === "Sym" ? key.name : key._tag === "Str"
              ? key.value.startsWith(":") || key.value.startsWith("\0") ? `\0str:${key.value}` : key.value
              : "";
            return [[label, value] as const];
          });
        const target = applyType(yield* Ref.get(ctx.subst), t);
        if (target._tag === "TApp" && target.con._tag === "TCon" && target.con.name === "Map") {
          for (const [label,value] of fields) {
            yield* assignType(TCon(label.startsWith(":") ? label : JSON.stringify(label.startsWith("\0str:") ? label.slice(5) : label)), target.args[0]!, origin);
            yield* visit(value,target.args[1]!);
          }
          return;
        }
        let row = yield* ctx.freshRowVar;
        const children: [import("../reader/types.js").SExpr, Type][] = [];
        for (const [label,v] of fields) { const ft = yield* ctx.freshTVar; row = RExtend(label, ft, row); children.push([v,ft]); }
        yield* unify(t, TRow(row), origin);
        for (const [v,ft] of children) yield* visit(v,ft);
        return;
      }
      if (p._tag === "Vector") {
        const element = yield* ctx.freshTVar;
        const list = TApp(TCon("List"), [element]);
        yield* unify(t, list, origin);
        for (let i=0;i<p.items.length;i++) {
          const item = p.items[i]!;
          if (item._tag === "Sym" && item.name === "&") {
            if (i !== p.items.length - 2) return yield* ctx.fail(origin, {code: "typecheck/pattern-rest", message: "Vector rest pattern requires one final binder"});
            yield* visit(p.items[++i]!, list);
          } else yield* visit(item,element);
        } return;
      }
      const ctor = p._tag === "Sym" && /^[A-Z]/.test(p.name) ? p.name : p._tag === "List" && p.items[0]?._tag === "Sym" && /^[A-Z]/.test(p.items[0].name) ? p.items[0].name : undefined;
      if (ctor) {
        const scheme = bindings.get(ctor) ?? ctx.builtinScheme(ctor);
        if (!scheme) return yield* ctx.fail(origin,{message: `Unknown constructor: ${ctor}`, code:"typecheck/pattern-constructor"});
        let ct = yield* instantiate(scheme);
        const args = p._tag === "List" ? p.items.slice(1) : [];
        for (const a of args) {
          if (ct._tag !== "TFun") return yield* ctx.fail(origin,{code: "typecheck/pattern-arity", message: `Too many pattern arguments for ${ctor}`});
          yield* visit(a,ct.arg); ct = ct.res;
        }
        if (ct._tag === "TFun") return yield* ctx.fail(origin,{code: "typecheck/pattern-arity", message: `Missing pattern arguments for ${ctor}`});
        yield* unify(t,ct,origin); return;
      }
      const literal = p._tag === "Num" || p._tag === "Str" || p._tag === "Bool" ? TCon(JSON.stringify(p.value)) : p._tag === "Sym" && p.name.startsWith(":") ? TCon(p.name) : p._tag === "Sym" && p.name === "nil" ? tNil : undefined;
      if (!literal) return yield* ctx.fail(origin,{code: "typecheck/pattern", message: "Invalid match pattern"});
      const target = applyType(yield* Ref.get(ctx.subst), t);
      const widened = p._tag === "Num" ? TCon(Number.isInteger(p.value) ? "Int" : "Number")
        : p._tag === "Str" ? TCon("String") : p._tag === "Bool" ? TCon("Bool")
        : p._tag === "Sym" && p.name.startsWith(":") ? TCon("Keyword") : literal;
      yield* assignType(target._tag === "TVar" ? widened : literal, t, origin);
    });
    yield* visit(syntax,expected);
    return applyEnv(yield* Ref.get(ctx.subst), bindings);
  });
}
const patternConstructor = (p: import("./core-expr.js").Pattern): string | undefined => {
  if (p._tag === "PCon") return p.name;
  if (p._tag === "PData") { const e=p.syntax; const name=e._tag==="Sym" ? e.name : e._tag==="List" && e.items[0]?._tag==="Sym" ? e.items[0].name : undefined; if (name && /^[A-Z]/.test(name)) return name; }
};
function totalConstructorPattern(p: import("./core-expr.js").Pattern): boolean {
  if (p._tag==="PCon") return new Set(p.vars).size===p.vars.length;
  if (p._tag!=="PData") return false;
  const bindings=new Set<string>();
  const total=(e: import("../reader/types.js").SExpr): boolean => {
    if (e._tag==="Sym" && e.name==="_") return true;
    if (e._tag==="Sym" && /^[a-z_$]/.test(e.name) && e.name!=="nil") { if (bindings.has(e.name)) return false; bindings.add(e.name); return true; }
    if (e._tag==="Map") return e.pairs.every(([k,v])=>k._tag==="Sym" && k.name===":keys" && v._tag==="Vector" ? v.items.every(total) : total(v));
    return false;
  };
  return p.syntax._tag==="Sym" || p.syntax._tag==="List" && p.syntax.items.slice(1).every(total);
}

const catchAllPattern = (p: import("./core-expr.js").Pattern): boolean => p._tag === "PWild" || p._tag === "PData" && p.syntax._tag === "Sym" && /^[a-z_$]/.test(p.syntax.name) && p.syntax.name !== "nil";

export const inferMatch = (
  env: TypeEnv,
  expr: CoreExpr & { _tag: "Match" },
  inferExpr: InferFn,
): Effect.Effect<Type, InferenceError, InferContext> =>
  Effect.gen(function* () {
    const ctx = yield* InferContext;

    // Infer the scrutinee type
    const scrutT = yield* inferExpr(env, expr.scrutinee);

    // Infer each arm
    let resultT: Type | undefined;
    let resultHasOperationalEffect = false;
    let accumulatedErrors: readonly Type[] = [];
    let accumulatedRequirements: readonly Type[] = [];

    for (const arm of expr.arms) {
      const s = yield* Ref.get(ctx.subst);
      const envN = applyEnv(s, env);
      const scrut = applyType(s, scrutT);

      let armEnv: Map<string, Scheme>;

      if (arm.pattern._tag === "PData") {
        armEnv = yield* inferDataPattern(envN, arm.pattern.syntax, scrut, expr);
      } else if (arm.pattern._tag === "PWild") {
        armEnv = new Map(envN);
      } else if (arm.pattern.name.startsWith(":") && arm.pattern.vars.length === 0) {
        yield* unify(tStr, scrut, originOf(expr, "match-pattern"));
        armEnv = envN;
      } else {
        // Constructor pattern
        const conName = arm.pattern.name;

        // Look up constructor scheme in the environment
        const conScheme = envN.get(conName) ?? ctx.builtinScheme(conName);
        if (!conScheme) {
          return yield* ctx.fail(originOf(expr, "match"), {
            message: `Unknown constructor: ${conName}`,
            code:"typecheck/pattern-constructor",
          });
        }

        // Instantiate the constructor scheme
        const conT = yield* instantiate(conScheme);

        if (arm.pattern.vars.length === 0) {
          // Nullary constructor: conT should unify with scrutinee
          yield* unify(conT, scrut, originOf(expr, "match-pattern"));
          armEnv = envN;
        } else {
          // Constructor with fields: conT is field1 -> field2 -> ... -> ResultType
          // Extract field types by peeling off TFun layers
          const fieldTypes: Type[] = [];
          let cur = conT;
          for (let i = 0; i < arm.pattern.vars.length; i++) {
            if (cur._tag !== "TFun") {
              return yield* ctx.fail(originOf(expr, "match"), {
                code: "typecheck/pattern-arity", message: `Constructor ${conName} expects ${i} field(s) but pattern has ${arm.pattern.vars.length}`,
              });
            }
            fieldTypes.push(cur.arg);
            cur = cur.res;
          }
          // cur is now the result type — unify with scrutinee
          yield* unify(
            cur,
            applyType(yield* Ref.get(ctx.subst), scrut),
            originOf(expr, "match-pattern"),
          );

          // Bind pattern variables
          armEnv = new Map(applyEnv(yield* Ref.get(ctx.subst), envN));
          for (let i = 0; i < arm.pattern.vars.length; i++) {
            const varName = arm.pattern.vars[i]!;
            const fieldT = applyType(yield* Ref.get(ctx.subst), fieldTypes[i]!);
            armEnv.set(varName, mono(fieldT));
          }
        }
      }

      // Infer the arm body
      const bodyS = yield* Ref.get(ctx.subst);
      const bodyEnv = applyEnv(bodyS, armEnv);
      const bodyT = yield* inferExpr(bodyEnv, arm.body);
      const resolvedBodyT = applyType(yield* Ref.get(ctx.subst), bodyT);
      const bodyEffect = operationalEffectParts(resolvedBodyT);

      // Unify all arm result types
      if (resultT === undefined) {
        if (bodyEffect) {
          resultT = bodyEffect.success;
          resultHasOperationalEffect = true;
          accumulatedErrors = mergeTypeSets(accumulatedErrors, bodyEffect.errors);
          accumulatedRequirements = mergeTypeSets(accumulatedRequirements, bodyEffect.requirements);
        } else {
          resultT = resolvedBodyT;
        }
      } else {
        const currentResult = applyType(yield* Ref.get(ctx.subst), resultT);
        if (resultHasOperationalEffect || bodyEffect) {
          const bodySuccess = bodyEffect?.success ?? resolvedBodyT;
          resultT = yield* joinType(currentResult, bodySuccess, originOf(expr, "match-arms"));
          accumulatedErrors = mergeTypeSets(accumulatedErrors, bodyEffect?.errors ?? []);
          accumulatedRequirements = mergeTypeSets(
            accumulatedRequirements,
            bodyEffect?.requirements ?? [],
          );
          resultHasOperationalEffect = true;
          resultT = applyType(yield* Ref.get(ctx.subst), resultT!);
        } else {
          resultT = yield* joinType(currentResult, resolvedBodyT, originOf(expr, "match-arms"));
          resultT = applyType(yield* Ref.get(ctx.subst), resultT!);
        }
      }
    }

    // -----------------------------------------------------------------------
    // Exhaustiveness & redundancy checking
    // -----------------------------------------------------------------------
    const sFinal = yield* Ref.get(ctx.subst);
    const resolvedScrut = applyType(sFinal, scrutT);

    // Find the ADT name from the scrutinee type
    let adtName: string | undefined;
    if (resolvedScrut._tag === "TCon") {
      adtName = resolvedScrut.name;
    } else if (resolvedScrut._tag === "TApp" && resolvedScrut.con._tag === "TCon") {
      adtName = resolvedScrut.con.name;
    }

    if (adtName) {
      const registry = yield* Ref.get(ctx.adtRegistry);
      const adtInfo = registry.get(adtName);

      if (adtInfo) {
        const allConstructors = new Set(adtInfo.constructors.keys());
        const matchedConstructors = new Set<string>();
        let hasWildcard = false;
        let wildcardIndex = -1;

        for (let i = 0; i < expr.arms.length; i++) {
          const arm = expr.arms[i]!;
          if (catchAllPattern(arm.pattern)) {
            hasWildcard = true;
            wildcardIndex = i;
          } else {
            const ctor = patternConstructor(arm.pattern);
            if (ctor && totalConstructorPattern(arm.pattern)) matchedConstructors.add(ctor.split(".").at(-1)!);
          }
        }

        // Redundancy: warn on arms after a wildcard
        if (hasWildcard && wildcardIndex < expr.arms.length - 1) {
          yield* ctx.addDiagnostic({
            message: "Unreachable match arm(s) after wildcard pattern",
            span: expr.span,
            severity: "warning",
            source: "hm",
          });
        }

        // Redundancy: warn on duplicate constructor patterns
        const seen = new Set<string>();
        for (const arm of expr.arms) {
          if (arm.pattern._tag === "PCon") {
            if (seen.has(arm.pattern.name)) {
              yield* ctx.addDiagnostic({
                message: `Duplicate match arm for constructor '${arm.pattern.name}'`,
                span: expr.span,
                severity: "warning",
                source: "hm",
              });
            }
            seen.add(arm.pattern.name);
          }
        }

        // Exhaustiveness: check all constructors are covered
        if (!hasWildcard) {
          const missing: string[] = [];
          for (const con of allConstructors) {
            if (!matchedConstructors.has(con)) {
              missing.push(con);
            }
          }
          if (missing.length > 0) {
            yield* ctx.addDiagnostic({
              message: `Non-exhaustive match: missing constructor(s) ${missing.join(", ")}`,
              span: expr.span,
              severity: "warning",
              source: "hm",
            });
          }
        }
      }
    }

    const result = applyType(sFinal, resultT ?? tNil);
    if (resultHasOperationalEffect) {
      return operationalEffectType(result, accumulatedErrors, accumulatedRequirements);
    }
    return result;
  });

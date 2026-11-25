import { typeMismatch } from "./diagnostic-types.js";
import { printFloat } from "../evaluator/types.js";
import { Effect, Ref } from "effect";
import type { Type } from "./types.js";
import { flattenRow, TApp, TCon, TRow, REmpty, RExtend, type Row } from "./types.js";
import type { TypeEnv } from "./substitution.js";
import { applyType } from "./substitution.js";
import type { CoreExpr } from "./core-expr.js";
import { getInferDslProvider } from "./infer-state.js";
import { InferContext } from "./context.js";
import { InferenceError } from "./errors.js";
import { assignType, literalBase } from "./assign.js";
import { inferExpr, inferLam, originOf } from "./infer-core.js";
import { inferMatch } from "./infer-control.js";
import { EFFECT_COMBINATORS, inferEffectCombinator } from "./infer-effect.js";

/** Literals remain widened in inference and retain their exact value in checking. */
export function literalType(expr: CoreExpr): Type | undefined {
  if (expr._tag !== "Lit") return;
  const lit=expr.lit;
  return TCon(lit._tag === "LQuoted" ? "Syntax" : lit._tag === "LSymbol" ? "Symbol" : lit._tag === "LKeyword" ? lit.value : lit._tag === "LNil" ? "Unit" : lit._tag === "LFloat" ? printFloat(lit.value) : JSON.stringify(lit.value));
}
export const checkExpr = (env: TypeEnv, expr: CoreExpr, expected: Type): Effect.Effect<Type,InferenceError,InferContext> => Effect.gen(function* () {
  const ctx=yield* InferContext;
  const target=applyType(yield* Ref.get(ctx.subst),expected);
  if (expr._tag === "DSLForm") {
    const provider = getInferDslProvider();
    const actual = provider?.typeApplication ? yield* provider.typeApplication(env, expr, target) : undefined;
    if (actual) {
      yield* assignType(actual, target, originOf(expr,"descriptor-check"));
      yield* ctx.recordType(expr.id, actual);
      return target;
    }
  }
  const literal=literalType(expr);
  if (literal && target._tag !== "TVar") {
    const snapshot = yield* Ref.get(ctx.subst);
    const precise=yield* assignType(literal,target,originOf(expr,"literal-check")).pipe(Effect.result);
    if (precise._tag === "Success") return target;
    yield* Ref.set(ctx.subst, snapshot);
    if (
      precise.failure.details["code"] === "typecheck/refinement" ||
      (ctx.effectMode && precise.failure.help && target._tag === "TApp" && target.con._tag === "TCon" && target.con.name === "Brand")
    ) {
      return yield* Effect.fail(precise.failure);
    }
    const members = target._tag === "TApp" && target.con._tag === "TCon" && target.con.name === "Union" ? target.args : [];
    const base = literal._tag === "TCon" ? literalBase(literal.name) : undefined;
    if (base && members.length > 0 && members.every(member => member._tag === "TCon" && literalBase((member as Type & { _tag: "TCon" }).name) === base)) {
      return yield* ctx.fail(originOf(expr,"literal-check"),typeMismatch(target,literal));
    }
  }
  if (target._tag === "TApp" && target.con._tag === "TCon" && target.con.name === "Effect" && target.args.length === 3
    && expr._tag === "App" && expr.fn._tag === "Var" && expr.fn.name === "succeed" && !env.has("succeed") && expr.args.length === 1) {
    const successTarget = applyType(yield* Ref.get(ctx.subst), target.args[0]!);
    if (successTarget._tag !== "TVar") {
      const checked = yield* checkExpr(env, expr.args[0]!, successTarget);
      const actual = TApp(TCon("Effect"), [checked, TApp(TCon("ErrorSet"), []), TApp(TCon("RequirementSet"), [])]);
      yield* assignType(actual, target, originOf(expr, "check"));
      yield* ctx.recordType(expr.id, actual);
      return target;
    }
  }
  if (target._tag === "TApp" && target.con._tag === "TCon" && target.con.name === "Option" && target.args.length === 1
    && expr._tag === "App" && expr.fn._tag === "Var" && (expr.fn.name === "Some" || expr.fn.name === "Option.Some") && expr.args.length === 1) {
    const itemTarget = applyType(yield* Ref.get(ctx.subst), target.args[0]!);
    if (itemTarget._tag !== "TVar") {
      const inner = expr.args[0]!;
      const isSyntheticCoercion = inner.span.start === expr.span.start && inner.span.end === expr.span.end;
      if (isSyntheticCoercion) {
        const snapshot = yield* Ref.get(ctx.subst);
        const asDirect = yield* checkExpr(env, inner, target).pipe(Effect.result);
        if (asDirect._tag === "Success") {
          yield* ctx.recordType(expr.id, target);
          return target;
        }
        yield* Ref.set(ctx.subst, snapshot);
      }
      const checked = yield* checkExpr(env, inner, itemTarget);
      const actual = TApp(TCon("Option"), [checked]);
      yield* assignType(actual, target, originOf(expr, "check"));
      yield* ctx.recordType(expr.id, actual);
      return target;
    }
  }
  if (target._tag === "TApp" && target.con._tag === "TCon" && target.con.name === "Map"
    && (expr._tag === "Record" || (expr._tag === "App" && expr.fn._tag === "Var" && expr.fn.name === "__dictionary" && expr.args[0]?._tag === "Record"))) {
    const record = expr._tag === "Record" ? expr : expr.args[0] as CoreExpr & { _tag: "Record" };
    for (const field of record.fields) {
      const keyTarget = applyType(yield* Ref.get(ctx.subst), target.args[0]!);
      const key =
        keyTarget._tag === "TVar"
          ? TCon(field.label.startsWith(":") ? "Keyword" : "String")
          : TCon(field.label.startsWith(":") ? field.label : JSON.stringify(field.label.startsWith("\0str:") ? field.label.slice(5) : field.label));
      yield* assignType(key, keyTarget, originOf(expr, "map-key"));
      yield* checkExpr(env, field.value, applyType(yield* Ref.get(ctx.subst), target.args[1]!));
    }
    return applyType(yield* Ref.get(ctx.subst), target);
  }
  // Each element of a vector literal is checked against the list's item type, so
  // ["warehouse" "office"] can be a List of an enum.
  if (target._tag === "TApp" && target.con._tag === "TCon" && target.con.name === "List" && target.args.length === 1
    && expr._tag === "App" && expr.fn._tag === "Var" && expr.fn.name === "__vector") {
    if (applyType(yield* Ref.get(ctx.subst), target.args[0]!)._tag === "TVar") {
      const actual = yield* inferExpr(env, expr);
      yield* assignType(actual, target, originOf(expr,"vector-check"));
      return applyType(yield* Ref.get(ctx.subst), target);
    }
    for (const item of expr.args) yield* checkExpr(env, item, target.args[0]!);
    yield* ctx.recordType(expr.id, target);
    return target;
  }
  if (target._tag === "TApp" && target.con._tag === "TCon" && target.con.name === "Tuple"
    && expr._tag === "App" && expr.fn._tag === "Var" && expr.fn.name === "__vector"
    && expr.args.length === target.args.length) {
    for (let i = 0; i < expr.args.length; i++) {
      yield* checkExpr(env, expr.args[i]!, target.args[i]!);
    }
    yield* ctx.recordType(expr.id, target);
    return target;
  }
  if (expr._tag === "Lam") {
    const actual=yield* inferLam(env,expr,target);
    yield* assignType(actual,target,originOf(expr,"function-check"));
    yield* ctx.recordType(expr.id,actual);
    return target;
  }
  if (expr._tag === "If" && target._tag !== "TVar") {
    yield* checkExpr(env,expr.cond,TCon("Bool"));
    yield* checkExpr(env,expr.then,target);
    yield* checkExpr(env,expr.else_,target);
    return target;
  }
  if (expr._tag === "Match" && target._tag !== "TVar") {
    const matched = yield* inferMatch(env, expr, inferExpr, (armEnv, body) => checkExpr(armEnv, body, target));
    yield* assignType(matched, target, originOf(expr, "match-check"));
    yield* ctx.recordType(expr.id, matched);
    return target;
  }
  if (
    expr._tag === "App" &&
    expr.fn._tag === "Var" &&
    !env.has(expr.fn.name) &&
    EFFECT_COMBINATORS.has(expr.fn.name) &&
    target._tag !== "TVar"
  ) {
    const comb = yield* inferEffectCombinator(env, expr, expr.fn.name, inferExpr, target);
    if (comb !== undefined) {
      yield* assignType(comb, target, originOf(expr, "check"));
      yield* ctx.recordType(expr.id, comb);
      return target;
    }
  }
  if (expr._tag === "Record" && target._tag === "TApp" && target.con._tag === "TCon" && target.con.name === "Union") {
    let refinementFailure: InferenceError | undefined;
    for (const member of target.args) {
      const snapshot = yield* Ref.get(ctx.subst);
      const attempt = yield* checkExpr(env, expr, member).pipe(Effect.result);
      if (attempt._tag === "Success") {
        yield* ctx.recordType(expr.id, target);
        return target;
      }
      if (attempt.failure.details["code"] === "typecheck/refinement" && !refinementFailure) {
        refinementFailure = attempt.failure;
      }
      yield* Ref.set(ctx.subst, snapshot);
    }
    if (refinementFailure) return yield* Effect.fail(refinementFailure);
  }
  if (expr._tag === "Record" && target._tag === "TCon") {
    const adtInfo = (yield* Ref.get(ctx.adtRegistry)).get(target.name);
    if (adtInfo?.tagField && adtInfo.variantPayloads) {
      const tagField = expr.fields.find((f) => f.label === adtInfo.tagField);
      if (tagField?.value._tag === "Lit" && tagField.value.lit._tag === "LString") {
        const variantName = tagField.value.lit.value;
        if (adtInfo.constructors.has(variantName)) {
          const payload = adtInfo.variantPayloads.get(variantName);
          const restFields = expr.fields.filter((f) => f !== tagField);
          if (payload?._tag === "TRow") {
            yield* checkExpr(env, { ...expr, fields: restFields }, payload);
            yield* ctx.recordType(expr.id, target);
            return target;
          }
          if (!payload && restFields.length === 0) {
            yield* ctx.recordType(expr.id, target);
            return target;
          }
        }
      }
    }
  }
  if (expr._tag === "Record" && target._tag === "TRow") {
    const fields=flattenRow(target.row);
    const present = new Set<string>();
    let row: Row=REmpty;
    for (const f of expr.fields) {
      present.add(f.label);
      const t=fields.fields.get(f.label);
      let actual: Type;
      if (t && t._tag === "TApp" && t.con._tag === "TCon" && t.con.name === "Option" && t.args.length === 1) {
        const snapshot = yield* Ref.get(ctx.subst);
        const asOption = yield* checkExpr(env, f.value, t).pipe(Effect.result);
        if (asOption._tag === "Success") {
          actual = asOption.success;
        } else if (asOption.failure.details["code"] === "typecheck/refinement") {
          return yield* Effect.fail(asOption.failure);
        } else {
          yield* Ref.set(ctx.subst, snapshot);
          const asPlain = yield* checkExpr(env, f.value, t.args[0]!).pipe(Effect.result);
          if (asPlain._tag === "Success") {
            actual = t;
          } else {
            yield* Ref.set(ctx.subst, snapshot);
            return yield* Effect.fail(asOption.failure);
          }
        }
      } else {
        actual=t ? yield* checkExpr(env,f.value,t) : yield* inferExpr(env,f.value);
      }
      row=RExtend(f.label,actual,row);
    }
    for (const [label, t] of fields.fields) {
      if (!present.has(label) && t._tag === "TApp" && t.con._tag === "TCon" && t.con.name === "Option" && t.args.length === 1) {
        row = RExtend(label, t, row);
      }
    }
    yield* assignType(TRow(row),target,originOf(expr,"record-check"));
    return target;
  }
  const actual=yield* inferExpr(env,expr);
  // Pure expressions in an Effect-typed position lift to (Effect A [] []).
  if (
    target._tag === "TApp" &&
    target.con._tag === "TCon" &&
    target.con.name === "Effect" &&
    target.args.length === 3 &&
    !(actual._tag === "TApp" && actual.con._tag === "TCon" && actual.con.name === "Effect") &&
    actual._tag !== "TVar"
  ) {
    yield* assignType(actual, target.args[0]!, originOf(expr, "check"));
    return target;
  }
  // An unconstrained parameter gets the literal's base type, just as numeric
  // and string inference do. Otherwise a lambda's unknown record field can be
  // fixed to :done before its caller supplies a record with a Keyword field.
  const base = literal?._tag === "TCon" ? literalBase(literal.name) : undefined;
  yield* assignType(target._tag === "TVar" && base ? TCon(base) : actual,target,originOf(expr,"check"));
  return target;
});

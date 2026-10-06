import { Effect, Ref } from "effect";
import type { Type } from "./types.js";
import { flattenRow, TCon, TRow, REmpty, RExtend, type Row } from "./types.js";
import type { TypeEnv } from "./substitution.js";
import { applyType } from "./substitution.js";
import type { CoreExpr } from "./core-expr.js";
import { InferContext } from "./context.js";
import { InferenceError } from "./errors.js";
import { assignType } from "./assign.js";
import { inferExpr, inferLam, originOf } from "./infer-core.js";

/** Literals remain widened in inference and retain their exact value in checking. */
export function literalType(expr: CoreExpr): Type | undefined {
  if (expr._tag !== "Lit") return;
  const lit=expr.lit;
  return TCon(lit._tag === "LQuoted" ? "Syntax" : lit._tag === "LSymbol" ? "Symbol" : lit._tag === "LKeyword" ? lit.value : lit._tag === "LNil" ? "Unit" : JSON.stringify(lit.value));
}
export const checkExpr = (env: TypeEnv, expr: CoreExpr, expected: Type): Effect.Effect<Type,InferenceError,InferContext> => Effect.gen(function* () {
  const ctx=yield* InferContext;
  const target=applyType(yield* Ref.get(ctx.subst),expected);
  const literal=literalType(expr);
  if (literal && target._tag !== "TVar") {
    const snapshot = yield* Ref.get(ctx.subst);
    const precise=yield* assignType(literal,target,originOf(expr,"literal-check")).pipe(Effect.result);
    if (precise._tag === "Success") return target;
    yield* Ref.set(ctx.subst, snapshot);
  }
  if (target._tag === "TApp" && target.con._tag === "TCon" && target.con.name === "Map"
    && expr._tag === "App" && expr.fn._tag === "Var" && expr.fn.name === "__dictionary" && expr.args[0]?._tag === "Record") {
    for (const field of expr.args[0].fields) {
      const key = TCon(field.label.startsWith(":") ? field.label : JSON.stringify(field.label.startsWith("\0str:") ? field.label.slice(5) : field.label));
      yield* assignType(key, target.args[0]!, originOf(expr, "map-key"));
      yield* checkExpr(env, field.value, target.args[1]!);
    }
    return target;
  }
  if (expr._tag === "Lam") {
    const actual=yield* inferLam(env,expr,target);
    yield* assignType(actual,target,originOf(expr,"function-check"));
    return target;
  }
  if (expr._tag === "If" && target._tag !== "TVar") {
    yield* checkExpr(env,expr.cond,TCon("Bool"));
    yield* checkExpr(env,expr.then,target);
    yield* checkExpr(env,expr.else_,target);
    return target;
  }
  if (expr._tag === "Record" && target._tag === "TRow") {
    const fields=flattenRow(target.row);
    let row: Row=REmpty;
    for (const f of expr.fields) {
      const t=fields.fields.get(f.label);
      const actual=t ? yield* checkExpr(env,f.value,t) : yield* inferExpr(env,f.value);
      row=RExtend(f.label,actual,row);
    }
    yield* assignType(TRow(row),target,originOf(expr,"record-check"));
    return target;
  }
  const actual=yield* inferExpr(env,expr);
  yield* assignType(actual,target,originOf(expr,"check"));
  return target;
});

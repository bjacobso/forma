import { Effect, Ref } from "effect";
import type { Type } from "./types.js";
import { TCon, TApp, TRow, RExtend, REmpty, type Row, flattenRow } from "./types.js";
import { InferContext } from "./context.js";
import { applyType } from "./substitution.js";
import { typeMismatch } from "./diagnostic-types.js";
import { unify } from "./unify.js";
import { InferenceError, type Origin } from "./errors.js";

/** Assignment is directional: every Int is a Float; arbitrary Floats are not Ints. */
export const assignType = (actual: Type, expected: Type, origin: Origin): Effect.Effect<void,InferenceError,InferContext> => Effect.gen(function* () {
  const ctx = yield* InferContext, subst = yield* Ref.get(ctx.subst);
  const a = applyType(subst,actual), b = applyType(subst,expected);
  if (a.numericOperator && b._tag === "TFun" && b.res._tag === "TFun") {
    const left = b.arg, right = b.res.arg;
    yield* assignType(left, TCon("Float"), origin);
    yield* assignType(right, TCon("Float"), origin);
    const result = a.numericOperator === "/" ? TCon("Float") : yield* joinType(left, right, origin);
    yield* assignType(result, b.res.res, origin);
    return;
  }
  if (a._tag === "TVar" || b._tag === "TVar") return yield* unify(b, a, origin);
  if (a._tag === "TApp" && a.con._tag === "TCon" && a.con.name === "Union") {
    for (const member of a.args) yield* assignType(member,b,origin);
    return;
  }
  if (b._tag === "TApp" && b.con._tag === "TCon" && b.con.name === "Union") {
    for (const member of b.args) {
      const snapshot=yield* Ref.get(ctx.subst);
      const result=yield* assignType(a,member,origin).pipe(Effect.result);
      if (result._tag === "Success") return;
      yield* Ref.set(ctx.subst,snapshot);
    }
  }
  if (a._tag === "TApp" && b._tag === "TApp" && a.con._tag === "TCon" && b.con._tag === "TCon" && a.con.name === b.con.name && ["ErrorSet", "RequirementSet"].includes(a.con.name)) {
    const requirements = a.con.name === "RequirementSet";
    const covered = a.args.every(actual => actual._tag === "TCon" && b.args.some(expected => expected._tag === "TCon" && (actual.name === expected.name || requirements && actual.name.startsWith(`${expected.name}.`))));
    if (covered) return;
  }
  if (a._tag === "TCon") {
    const primitive=literalBase(a.name);
    if (primitive && b._tag === "TCon" && (primitive===b.name || primitive==="Int" && b.name==="Float")) return;
  }
  if (a._tag === "TCon" && a.name === "Int" && b._tag === "TCon" && b.name === "Float") return;
  if (a._tag === "TFun" && b._tag === "TFun") {
    yield* assignType(b.arg,a.arg,origin);
    yield* assignType(a.res,b.res,origin);
    if (a.rest || b.rest || a.effect || b.effect) yield* unify(b,{...a,arg:b.arg,res:b.res},origin);
    return;
  }
  if (a._tag === "TApp" && b._tag === "TApp" && a.args.length === b.args.length) {
    yield* unify(b.con,a.con,origin);
    for (let i=0;i<a.args.length;i++) yield* assignType(a.args[i]!,b.args[i]!,origin);
    return;
  }
  if (a._tag === "TRow" && b._tag === "TRow") {
    const af = flattenRow(a.row), bf = flattenRow(b.row);
    if ([...bf.fields.keys()].every(k => af.fields.has(k)) && bf.tail._tag !== "REmpty") {
      for (const [label, type] of bf.fields) yield* assignType(af.fields.get(label)!, type, origin);
      let remainder = af.tail;
      for (const [label, type] of [...af.fields].reverse()) if (!bf.fields.has(label)) remainder = RExtend(label, type, remainder);
      yield* unify(TRow(bf.tail), TRow(remainder), origin);
      return;
    }
    if ([...bf.fields.keys()].every(k=>af.fields.has(k)) && bf.tail._tag === "REmpty" && af.tail._tag === "REmpty" && af.fields.size === bf.fields.size) {
      for (const [label,type] of bf.fields) yield* assignType(af.fields.get(label)!,type,origin);
      return;
    }
  }
  yield* unify(b,a,origin).pipe(Effect.mapError(error => {
    const mismatch = typeof error.details["expected"] === "string" && typeof error.details["got"] === "string"
      ? error.details : typeMismatch(b,a);
    return new InferenceError({...error,
      message:mismatch === error.details ? error.message : `${error.message}: ${mismatch["message"]}`,
      details:{...error.details,...mismatch,code:"typecheck/type-mismatch"},
    });
  }));
});

/** Common numeric supertype for branches and collections, without narrowing Floats to Int. */
export const joinType = (left: Type, right: Type, origin: Origin): Effect.Effect<Type,InferenceError,InferContext> => Effect.gen(function* () {
  const ctx = yield* InferContext, subst = yield* Ref.get(ctx.subst);
  const a = applyType(subst,left), b = applyType(subst,right);
  // Joining an unknown value with a literal constrains its base type, rather
  // than requiring every later value of that variable to be that singleton.
  if (a._tag === "TVar" && b._tag === "TCon" && literalBase(b.name)) {
    const widened = TCon(literalBase(b.name)!);
    yield* unify(a,widened,origin);
    return widened;
  }
  if (b._tag === "TVar" && a._tag === "TCon" && literalBase(a.name)) {
    const widened = TCon(literalBase(a.name)!);
    yield* unify(b,widened,origin);
    return widened;
  }
  const keywordMembers=(t:Type):readonly Type[] | undefined => t._tag === "TCon" && (t.name === "Keyword" || t.name.startsWith(":")) ? [t] : t._tag === "TApp" && t.con._tag === "TCon" && t.con.name === "Union" && t.args.every(member=>keywordMembers(member)) ? t.args.flatMap(member=>keywordMembers(member)!) : undefined;
  const ak=keywordMembers(a), bk=keywordMembers(b);
  if (ak && bk) {
    if ([...ak,...bk].some(t=>t._tag === "TCon" && t.name === "Keyword")) return TCon("Keyword");
    const members=[...new Map([...ak,...bk].map(t=>[(t as {name:string}).name,t])).values()];
    return members.length === 1 ? members[0]! : TApp(TCon("Union"),members);
  }
  if (a._tag === "TRow" && b._tag === "TRow") {
    const af=flattenRow(a.row), bf=flattenRow(b.row);
    if (af.tail._tag === "REmpty" && bf.tail._tag === "REmpty" && af.fields.size === bf.fields.size && [...af.fields.keys()].every(k=>bf.fields.has(k))) {
      let row:Row=REmpty;
      for (const [key,value] of [...af.fields].reverse()) row=RExtend(key,yield* joinType(value,bf.fields.get(key)!,origin),row);
      return TRow(row);
    }
  }
  if (a._tag === 'TCon' && b._tag === 'TCon' && ['Int','Float'].includes(a.name) && ['Int','Float'].includes(b.name)) return a.name === b.name ? a : {_tag:'TCon',name:'Float'};
  if (a._tag === 'TApp' && b._tag === 'TApp' && a.con._tag === 'TCon' && b.con._tag === 'TCon' && a.con.name === b.con.name && a.args.length === b.args.length) {
    const args: Type[]=[];
    for (let i=0;i<a.args.length;i++) args.push(yield* joinType(a.args[i]!,b.args[i]!,origin));
    return {...a,args};
  }
  yield* unify(a,b,origin);
  return applyType(yield* Ref.get(ctx.subst),a);
});

/** The primitive a literal type name belongs to, if it is a literal. */
export function literalBase(name: string): string | undefined {
  if (name.startsWith(":")) return "Keyword";
  try { const value=JSON.parse(name); return typeof value==="string" ? "String" : typeof value==="boolean" ? "Bool" : typeof value==="number" ? /[.eE]/.test(name) ? "Float" : "Int" : undefined; } catch { return; }
}

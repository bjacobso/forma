import { Effect, Ref } from "effect";
import type { Type } from "./types.js";
import { TCon, TApp, TRow, RExtend, REmpty, type Row, flattenRow } from "./types.js";
import { InferContext } from "./context.js";
import { applyType } from "./substitution.js";
import { typeMismatch } from "./diagnostic-types.js";
import { unify } from "./unify.js";
import { InferenceError, type Origin } from "./errors.js";
import { requireNumeric, numericResult } from "./numeric.js";
import {
  decideDataRelation,
  isPrimitiveName,
  joinNumericPrimitives,
  literalBaseName,
  parseLiteralTypeName,
  type DataNode,
} from "./data-relation.js";

function toHmDataNode(type: Type): DataNode<Type> {
  if (type._tag === "TCon") {
    if (type.name === "Unknown") return { kind: "unknown", raw: type };
    if (type.name === "Never") return { kind: "never", raw: type };
    if (isPrimitiveName(type.name)) return { kind: "prim", name: type.name, raw: type };
    const literal = parseLiteralTypeName(type.name);
    if (literal) return { kind: "literal", literal, raw: type };
    return { kind: "other", raw: type };
  }
  if (type._tag === "TApp" && type.con._tag === "TCon") {
    if (type.con.name === "Brand" && type.args.length === 2 && type.args[0]?._tag === "TCon") {
      return { kind: "brand", name: type.args[0].name, base: type.args[1]!, raw: type };
    }
    if (type.con.name === "Option" && type.args.length === 1) {
      return { kind: "option", item: type.args[0]!, raw: type };
    }
  }
  return { kind: "other", raw: type };
}

/** Assignment is directional: every Int is a Float; arbitrary Floats are not Ints. */
export const assignType = (actual: Type, expected: Type, origin: Origin): Effect.Effect<void,InferenceError,InferContext> => Effect.gen(function* () {
  const ctx = yield* InferContext, subst = yield* Ref.get(ctx.subst);
  const a = applyType(subst,actual), b = applyType(subst,expected);
  if (a.numericOperator && b._tag === "TFun") {
    const params: Type[] = [];
    const count = a.arity ?? 2;
    let target: Type = b;
    for (let i = 0; i < count && target._tag === "TFun"; i++) {
      params.push(target.arg);
      target = target.res;
    }
    if (params.length !== count) return yield* unify(b, a, origin);
    for (const param of params) yield* requireNumeric(param, origin);
    const op = a.numericOperator;
    const result = ["<", "<=", ">", ">="].includes(op) ? TCon("Bool")
      : ["floor", "ceil", "round"].includes(op) ? TCon("Int")
      : ["/", "pow", "sqrt"].includes(op) ? TCon("Float") : yield* numericResult(params, origin);
    yield* assignType(result, target, origin);
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
  const isHktApp = (t: Type) => t._tag === "TApp" && t.con._tag !== "TCon";
  if (!isHktApp(a) && !isHktApp(b)) {
    const decision = decideDataRelation(toHmDataNode(a), toHmDataNode(b));
    if (decision.verdict === "accept") return;
    if (decision.verdict === "check") return yield* assignType(decision.actual, decision.expected, origin);
    if (decision.verdict === "reject") {
      const details: Record<string, unknown> = { ...typeMismatch(b, a), code: "typecheck/type-mismatch" };
      return yield* Effect.fail(new InferenceError({
        message: typeof details["message"] === "string" ? details["message"] : "Type error",
        origin,
        details,
        ...brandAdvice(b, a, origin),
      }));
    }
  }
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
      ...brandAdvice(b, a, error.origin ?? origin),
    });
  }));
});

/** A base value where a brand is expected: wrapping it with the brand's constructor is the repair. */
function brandAdvice(expected: Type, actual: Type, origin: Origin): Pick<InferenceError, "help" | "fix"> | undefined {
  if (!(expected._tag === "TApp" && expected.con._tag === "TCon" && expected.con.name === "Brand")) return undefined;
  const [brand, base] = expected.args;
  const actualBase = actual._tag === "TCon" ? literalBase(actual.name) ?? actual.name : undefined;
  if (brand?._tag !== "TCon" || base?._tag !== "TCon" || actualBase !== base.name) return undefined;
  const span = origin.macroOrigins?.length ? undefined : origin.span, sourceId = span?.sourceId ?? "";
  return {
    help: `Wrap the value with the brand constructor: (${brand.name} value).`,
    fix: span ? [
      {span:{sourceId,startOffset:span.start,endOffset:span.start},newText:`(${brand.name} `},
      {span:{sourceId,startOffset:span.end,endOffset:span.end},newText:")"},
    ] : undefined,
  };
}

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
  if (a._tag === "TCon" && b._tag === "TCon") {
    const joined = joinNumericPrimitives(a.name, b.name);
    if (joined) return TCon(joined);
  }
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
  return literalBaseName(name);
}

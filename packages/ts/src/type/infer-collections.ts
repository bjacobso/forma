import { Effect, Ref } from "effect";
import { InferContext } from "./context.js";
import type { CoreExpr } from "./core-expr.js";
import type { InferFn } from "./infer-binding.js";
import { originOf } from "./infer-core.js";
import { applyType, type TypeEnv } from "./substitution.js";
import { unify } from "./unify.js";
import { assignType } from "./assign.js";
import { TApp, TCon, TRow, RExtend, flattenRow, type Type, type Row } from "./types.js";

export const collectionOperations = new Set(["assoc", "dissoc", "select-keys", "merge", "keys", "vals", "values", "count", "empty?", "contains?"]);

const literalKey = (e: CoreExpr): string | undefined => e._tag === "Lit"
  ? e.lit._tag === "LKeyword" ? e.lit.value
    : e.lit._tag === "LString" ? e.lit.value.startsWith(":") || e.lit.value.startsWith("\0") ? `\0str:${e.lit.value}` : e.lit.value
    : undefined : undefined;
const keyType = (label: string) => TCon(label.startsWith(":") ? label : JSON.stringify(label.startsWith("\0str:") ? label.slice(5) : label));
const union = (types: Type[]): Type => {
  const unique=[...new Map(types.map(type=>[JSON.stringify(type),type])).values()];
  return unique.length===1 ? unique[0]! : unique.length ? TApp(TCon("Union"),unique) : TCon("Never");
};
const rowType = (fields: ReadonlyMap<string, Type>, tail: Row): Type => {
  let row = tail;
  for (const [label, type] of [...fields].reverse()) row = RExtend(label, type, row);
  return TRow(row);
};

/** Record operations preserve rows; dictionary operations preserve key and value types. */
export const inferCollectionOperation = (env: TypeEnv, expr: CoreExpr & { _tag: "App" }, op: string, infer: InferFn) => Effect.gen(function* () {
  const ctx = yield* InferContext;
  const origin = originOf(expr, op);
  const fail = (message: string) => ctx.fail(origin, { message });
  const inferred: Type[] = [];
  for (const [index,arg] of expr.args.entries()) {
    const keys = op === "select-keys" && index === 1 && arg._tag === "App" && arg.fn._tag === "Var" && arg.fn.name === "__vector";
    inferred.push(keys ? TApp(TCon("List"), [yield* ctx.freshTVar]) : yield* infer(env,arg));
  }
  const subst = yield* Ref.get(ctx.subst);
  const types = inferred.map(t => applyType(subst, t));
  let first = types[0];
  if (first?._tag === "TVar") {
    const target = ["count", "empty?", "contains?"].includes(op) ? TApp(TCon("List"), [yield* ctx.freshTVar]) : TRow(yield* ctx.freshRowVar);
    yield* unify(first,target,origin); first = target;
  }
  const dictionary = (t: Type | undefined): t is Type & { _tag: "TApp" } => t?._tag === "TApp" && t.con._tag === "TCon" && t.con.name === "Map";
  const actualKey = (i: number) => {
    const label = literalKey(expr.args[i]!);
    return label === undefined ? types[i]! : keyType(label);
  };
  if (op === "merge") {
    if (!types.length) return TRow({ _tag: "REmpty" });
    if (dictionary(first)) {
      for (const next of types.slice(1)) {
        if (!dictionary(next)) return yield* fail("merge requires dictionaries of the same type");
        yield* assignType(next, first, origin);
      }
      return first;
    }
    const fields = new Map<string, Type>();
    let tail: Row = { _tag: "REmpty" };
    for (const type of types) {
      if (type._tag !== "TRow") return yield* fail("merge requires records or dictionaries");
      const row = flattenRow(type.row);
      if (row.tail._tag !== "REmpty") {
        if (tail._tag !== "REmpty") return yield* fail("Merging two open records requires a known shared row");
        tail = row.tail;
      }
      for (const entry of row.fields) fields.set(...entry);
    }
    return rowType(fields, tail);
  }
  if (!first) return yield* fail(`${op} requires a collection`);
  if (["count", "empty?"].includes(op)) {
    if (types.length !== 1) return yield* fail(`${op} expects one argument`);
    if (first._tag !== "TRow" && !dictionary(first) && !(first._tag === "TApp" && first.con._tag === "TCon" && first.con.name === "List") && !(first._tag === "TCon" && first.name === "String")) return yield* fail(`${op} requires a collection`);
    return TCon(op === "count" ? "Int" : "Bool");
  }
  if (op === "contains?" && first._tag === "TCon" && first.name === "String") {
    if (types.length !== 2) return yield* fail("contains? expects two arguments");
    yield* assignType(types[1]!, TCon("String"), origin);
    return TCon("Bool");
  }
  if (op === "contains?" && first._tag === "TApp" && first.con._tag === "TCon" && first.con.name === "List") {
    if (types.length !== 2) return yield* fail("contains? expects two arguments");
    yield* assignType(types[1]!, first.args[0]!, origin);
    return TCon("Bool");
  }
  if (first._tag !== "TRow" && !dictionary(first)) return yield* fail(`${op} requires a record or dictionary`);
  if (["keys", "values", "vals"].includes(op)) {
    if (types.length !== 1) return yield* fail(`${op} expects one argument`);
    if (dictionary(first)) return TApp(TCon("List"), [first.args[op === "keys" ? 0 : 1]!]);
    const {fields,tail} = flattenRow(first.row);
    if (tail._tag !== "REmpty") return yield* fail(`${op} requires a closed record or a typed Map`);
    return TApp(TCon("List"), [op === "keys" ? union([...fields.keys()].map(keyType)) : union([...fields.values()])]);
  }
  if (op === "contains?") {
    if (types.length !== 2) return yield* fail("contains? expects two arguments");
    if (dictionary(first)) yield* assignType(actualKey(1), first.args[0]!, origin);
    else yield* assignType(actualKey(1), union([...flattenRow(first.row).fields.keys()].map(keyType)), origin);
    return TCon("Bool");
  }
  if (op === "assoc") {
    if (types.length < 3 || types.length % 2 !== 1) return yield* fail("assoc expects a collection and key/value pairs");
    if (dictionary(first)) {
      for (let i = 1; i < types.length; i += 2) {
        yield* assignType(actualKey(i), first.args[0]!, origin);
        yield* assignType(types[i + 1]!, first.args[1]!, origin);
      }
      return first;
    }
    const { fields, tail } = flattenRow(first.row);
    const result = new Map(fields);
    for (let i = 1; i < types.length; i += 2) {
      const label = literalKey(expr.args[i]!);
      if (label === undefined) return yield* fail("Record association requires a literal key");
      result.set(label, types[i + 1]!);
    }
    return rowType(result, tail);
  }
  if (op === "select-keys" && types.length !== 2) return yield* fail("select-keys expects a collection and keys");
  const keys = op === "select-keys" && expr.args[1]?._tag === "App" && expr.args[1].fn._tag === "Var" && expr.args[1].fn.name === "__vector" ? expr.args[1].args : op === "dissoc" ? expr.args.slice(1) : undefined;
  if (dictionary(first)) {
    if (op === "select-keys") {
      if (keys) for (const key of keys) {
        const label = literalKey(key);
        yield* assignType(label === undefined ? yield* infer(env, key) : keyType(label), first.args[0]!, origin);
      }
      else yield* assignType(types[1]!, TApp(TCon("List"), [first.args[0]!]), origin);
    } else for (let i = 1; i < types.length; i++) yield* assignType(actualKey(i), first.args[0]!, origin);
    return first;
  }
  if (!keys || keys.some(key => literalKey(key) === undefined)) return yield* fail("Record selection requires literal keys");
  const { fields, tail } = flattenRow(first.row);
  const labels = new Set(keys.map(key => literalKey(key)!));
  if (op === "select-keys") return rowType(new Map([...fields].filter(([key]) => labels.has(key))), { _tag: "REmpty" });
  return rowType(new Map([...fields].filter(([key]) => !labels.has(key))), tail);
});

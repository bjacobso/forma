import { Effect } from "effect";
import type { BuiltinFn, KValue } from "../evaluator/types.js";
import { isKSExpr } from "../evaluator/types.js";
import { ArityError } from "../diagnostic/errors.js";

let _gensymCounter = 0;

export const gensym: BuiltinFn = (args) => {
  if (args.length > 1)
    return Effect.fail(new ArityError({ name: "gensym", expected: "0-1", got: args.length }));
  const prefix = args.length === 1 && typeof args[0] === "string" ? args[0] : "g";
  const name = `${prefix}__${++_gensymCounter}`;
  const synLoc = { start: 0, end: 0, line: 1, col: 1 };
  return Effect.succeed({
    _tag: "KSExpr" as const,
    expr: { _tag: "Sym" as const, name, loc: synLoc },
  });
};

export const sexprListQ: BuiltinFn = (args) => {
  if (args.length !== 1)
    return Effect.fail(new ArityError({ name: "sexpr-list?", expected: 1, got: args.length }));
  const v = args[0]!;
  return Effect.succeed(Array.isArray(v) || isKSExpr(v) && ["List","Vector"].includes(v.expr._tag));
};

export const sexprItems: BuiltinFn = (args) => {
  if (args.length !== 1)
    return Effect.fail(new ArityError({ name: "sexpr-items", expected: 1, got: args.length }));
  const v = args[0]!;
  if (Array.isArray(v)) return Effect.succeed(v);
  if (!isKSExpr(v) || (v.expr._tag !== "List" && v.expr._tag !== "Vector")) {
    return Effect.succeed([] as readonly KValue[]);
  }
  const items: KValue[] = v.expr.items.map((item) => ({
    _tag: "KSExpr" as const,
    expr: item,
  }));
  return Effect.succeed(items as readonly KValue[]);
};

export const sexprSymName: BuiltinFn = (args) => {
  if (args.length !== 1)
    return Effect.fail(new ArityError({ name: "sexpr-sym-name", expected: 1, got: args.length }));
  const v = args[0]!;
  if (isKSExpr(v) && v.expr._tag === "Sym") {
    return Effect.succeed(v.expr.name);
  }
  return Effect.succeed(null);
};

export const macroBuiltins: Record<string, BuiltinFn> = {
  gensym,
  "sexpr-list?": sexprListQ,
  "sexpr-items": sexprItems,
  "sexpr-sym-name": sexprSymName,
};

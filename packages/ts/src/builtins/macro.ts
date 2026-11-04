import { Context, Effect } from "effect";
import type { BuiltinFn, KValue } from "../evaluator/types.js";
import { isKSExpr } from "../evaluator/types.js";
import { ArityError } from "../diagnostic/errors.js";

/** The counter behind `gensym` names. */
export interface GensymCounter {
  next: number;
}

const unscoped: GensymCounter = { next: 0 };

/**
 * The `gensym` counter for the current expansion or evaluation. Each expansion
 * pass and each top-level evaluation provides its own, so generated names
 * depend only on that work and not on what the process ran before. Code run
 * outside any scope shares one process-wide counter.
 */
export const GensymScope = Context.Reference<GensymCounter>("forma/GensymScope", {
  defaultValue: () => unscoped,
});

/** Run `effect` with a fresh `gensym` counter unless it already runs in a scope. */
export const withGensymScope = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
  Effect.flatMap(Effect.service(GensymScope), (counter) =>
    counter === unscoped ? Effect.provideService(effect, GensymScope, { next: 0 }) : effect,
  );

/** The caller's `gensym` counter, or undefined outside any scope. */
export const currentGensymCounter: Effect.Effect<GensymCounter | undefined> = Effect.map(
  Effect.service(GensymScope),
  (counter) => (counter === unscoped ? undefined : counter),
);

export const gensym: BuiltinFn = (args) => {
  if (args.length > 1)
    return Effect.fail(new ArityError({ name: "gensym", expected: "0-1", got: args.length }));
  const prefix = args.length === 1 && typeof args[0] === "string" ? args[0] : "g";
  const synLoc = { start: 0, end: 0, line: 1, col: 1 };
  return Effect.map(Effect.service(GensymScope), (counter) => ({
    _tag: "KSExpr" as const,
    expr: { _tag: "Sym" as const, name: `${prefix}__${++counter.next}`, loc: synLoc },
  }));
};

export const sexprListQ: BuiltinFn = (args) => {
  if (args.length !== 1)
    return Effect.fail(new ArityError({ name: "sexpr-list?", expected: 1, got: args.length }));
  const v = args[0]!;
  return Effect.succeed(Array.isArray(v) || isKSExpr(v) && ["List","Vector"].includes(v.expr._tag));
};

/** True for a vector literal, such as a parameter or binding vector. */
export const sexprVectorQ: BuiltinFn = (args) => {
  if (args.length !== 1)
    return Effect.fail(new ArityError({ name: "sexpr-vector?", expected: 1, got: args.length }));
  const v = args[0]!;
  return Effect.succeed(isKSExpr(v) && v.expr._tag === "Vector");
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
  "sexpr-vector?": sexprVectorQ,
  "sexpr-items": sexprItems,
  "sexpr-sym-name": sexprSymName,
};

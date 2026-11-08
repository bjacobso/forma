import { Effect } from "effect";
import type { Expr } from "../02/expr.ts";
import { type Arg, Environment, type Value } from "./environment.ts";
import { type EvalError, NotCallable, UnboundName } from "./errors.ts";

// #region evaluate
type Ref = Extract<Expr, { _tag: "Ref" }>;

const lookup = (ref: Ref) =>
  Effect.gen(function* () {
    const environment = yield* Environment;
    const value = environment.get(ref.name);
    if (value === undefined) {
      const { name: symbol, span } = ref;
      return yield* new UnboundName({ symbol, span });
    }
    return value;
  });

// The type says it all: a Value, or one of the EvalErrors, given an
// Environment.
export const evaluate = (
  e: Expr,
): Effect.Effect<Value, EvalError, Environment> =>
  Effect.gen(function* () {
    switch (e._tag) {
      case "Num":
        return e.value;
      case "Quote":
        return e.datum;
      case "Ref":
        return yield* lookup(e);
      case "Call": {
        const fn = yield* lookup(e.op);
        if (typeof fn === "number" || fn._tag !== "Primitive") {
          const { name: symbol, span } = e.op;
          return yield* new NotCallable({ symbol, span });
        }
        const args: Arg[] = [];
        for (const arg of e.args) {
          const value = yield* evaluate(arg);
          args.push({ value, span: arg.span });
        }
        return yield* fn.apply(args);
      }
    }
  });
// #endregion evaluate

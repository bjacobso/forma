import type { Expr } from "./expr.ts";
import { type Sexp, show } from "./sexp.ts";

// #region evaluate
// The evaluator no longer checks shapes; parsing already did. It
// only checks values: you still can't add a quoted symbol.
export type Value = number | Sexp;

const numbers = (op: string, args: ReadonlyArray<Value>) =>
  args.map((arg) => {
    if (typeof arg === "number") return arg;
    const got = display(arg);
    throw new TypeError(`${op} expects numbers, got ${got}`);
  });

const primitives: Record<string, (args: Value[]) => Value> = {
  "+": (args) => numbers("+", args).reduce((a, b) => a + b, 0),
  "*": (args) => numbers("*", args).reduce((a, b) => a * b, 1),
};

export const evaluate = (e: Expr): Value => {
  switch (e._tag) {
    case "Num":
      return e.value;
    case "Quote":
      return e.datum;
    case "Ref":
      throw new ReferenceError(`${e.name} is not defined`);
    case "Call": {
      const { name } = e.op;
      const fn = primitives[name];
      if (!fn) throw new ReferenceError(`${name} is not defined`);
      return fn(e.args.map(evaluate));
    }
  }
};

export const display = (v: Value) =>
  typeof v === "number" ? String(v) : show(v);
// #endregion evaluate

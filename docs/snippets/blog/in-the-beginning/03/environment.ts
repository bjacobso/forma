import { Context, Effect } from "effect";
import { type Sexp, show, type Span } from "../02/sexp.ts";
import { DivByZero, type EvalError, NotANumber } from "./errors.ts";

// #region values
// Values: numbers, quoted data, and primitive operations. A
// primitive gets each argument with its span, so it can blame one.
export interface Arg {
  readonly value: Value;
  readonly span: Span;
}
export interface Primitive {
  readonly _tag: "Primitive";
  readonly name: string;
  readonly apply: (
    args: ReadonlyArray<Arg>,
  ) => Effect.Effect<Value, EvalError>;
}
export type Value = number | Sexp | Primitive;

export const display = (v: Value): string =>
  typeof v === "number" ? String(v)
  : v._tag === "Primitive" ? `#<primitive ${v.name}>`
  : show(v);
// #endregion values

// #region environment
// The environment the evaluator needs: a map from names to values.
// It's a service, so the host decides what it contains.
export class Environment extends Context.Service<
  Environment,
  ReadonlyMap<string, Value>
>()("Environment") {}
// #endregion environment

// #region standard
const primitive = (name: string, apply: Primitive["apply"]) =>
  [name, { _tag: "Primitive", name, apply } as const] as const;

const numbers = (op: string, args: ReadonlyArray<Arg>) =>
  Effect.forEach(args, ({ value, span }) => {
    if (typeof value === "number") return Effect.succeed(value);
    const got = display(value);
    return Effect.fail(new NotANumber({ op, got, span }));
  });

const sum = (ns: number[]) => ns.reduce((a, b) => a + b, 0);
const product = (ns: number[]) => ns.reduce((a, b) => a * b, 1);

export const standard = new Map<string, Value>([
  primitive("+", (args) => Effect.map(numbers("+", args), sum)),
  primitive("*", (args) => Effect.map(numbers("*", args), product)),
  primitive("/", (args) =>
    Effect.gen(function* () {
      const [first = 1, ...divisors] = yield* numbers("/", args);
      let result = first;
      for (const [i, divisor] of divisors.entries()) {
        if (divisor === 0) {
          const { span } = args[i + 1]!;
          return yield* new DivByZero({ span });
        }
        result /= divisor;
      }
      return result;
    }),
  ),
  ["pi", Math.PI],
]);
// #endregion standard

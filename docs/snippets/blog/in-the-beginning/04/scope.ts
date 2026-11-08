import { Effect } from "effect";
import { type Sexp, show, type Span } from "../02/sexp.ts";
import { Output } from "./capabilities.ts";
import {
  DivByZero,
  type EvalError,
  NotANumber,
  WrongArity,
} from "./errors.ts";
import type { Expr } from "./expr.ts";

// #region values
// A closure is a function plus the scope it was created in.
export interface Closure {
  readonly _tag: "Closure";
  readonly params: ReadonlyArray<string>;
  readonly body: Expr;
  readonly scope: Scope;
}
export interface Arg {
  readonly value: Value;
  readonly span: Span;
}
export interface Primitive {
  readonly _tag: "Primitive";
  readonly name: string;
  readonly apply: (
    args: ReadonlyArray<Arg>,
    call: Span,
  ) => Effect.Effect<Value, EvalError, Output>;
}
export type Value = number | Sexp | Primitive | Closure;

export const display = (v: Value): string =>
  typeof v === "number" ? String(v)
  : v._tag === "Primitive" ? `#<primitive ${v.name}>`
  : v._tag === "Closure" ? `#<closure (${v.params.join(" ")})>`
  : show(v);
// #endregion values

// #region scope
// A scope is a frame of names and the scope around it. It's plain
// data: a closure can hold on to one, and a call can extend one.
export interface Scope {
  readonly names: ReadonlyMap<string, Value>;
  readonly parent: Scope | undefined;
}

export const extend = (
  parent: Scope,
  names: Iterable<readonly [string, Value]>,
): Scope => ({ names: new Map(names), parent });

export const lookup = (
  scope: Scope | undefined,
  name: string,
): Value | undefined =>
  scope === undefined ? undefined
  : scope.names.has(name) ? scope.names.get(name)
  : lookup(scope.parent, name);
// #endregion scope

const primitive = (name: string, apply: Primitive["apply"]) =>
  [name, { _tag: "Primitive", name, apply } as const] as const;

const numbers = (op: string, args: ReadonlyArray<Arg>) =>
  Effect.forEach(args, ({ value, span }) => {
    if (typeof value === "number") return Effect.succeed(value);
    const got = display(value);
    return Effect.fail(new NotANumber({ op, got, span }));
  });

const sum = (ns: number[]) => ns.reduce((a, b) => a + b, 0);
const mul = (ns: number[]) => ns.reduce((a, b) => a * b, 1);

const divide = (args: ReadonlyArray<Arg>) =>
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
  });

// #region globals
// `print` is a name like any other, bound in the global scope. What
// printing does is up to the Output service.
const print: Primitive["apply"] = (args, span) =>
  Effect.gen(function* () {
    const [arg, ...extra] = args;
    if (!arg || extra.length > 0) {
      const got = args.length;
      return yield* new WrongArity({ expected: 1, got, span });
    }
    const output = yield* Output;
    yield* output.print(display(arg.value));
    return arg.value;
  });

export const globals: Scope = {
  names: new Map<string, Value>([
    primitive("+", (args) => Effect.map(numbers("+", args), sum)),
    primitive("*", (args) => Effect.map(numbers("*", args), mul)),
    primitive("/", divide),
    primitive("print", print),
    ["pi", Math.PI],
  ]),
  parent: undefined,
};
// #endregion globals

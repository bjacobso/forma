import { Effect } from "effect";
import { type Sexp, show, type Span } from "../02/sexp.ts";
import { Output } from "../04/capabilities.ts";
import { DivByZero } from "../04/errors.ts";
import type { Core } from "./core.ts";

// #region values
// A runtime frame holds values in slots. It has no names: core
// already turned every name into a position.
export interface Env {
  readonly slots: ReadonlyArray<Value>;
  readonly parent: Env | undefined;
}
export interface Closure {
  readonly _tag: "Closure";
  readonly params: ReadonlyArray<string>;
  readonly body: Core;
  readonly env: Env | undefined;
}
export interface Arg {
  readonly value: Value;
  readonly span: Span;
}
export interface Primitive {
  readonly _tag: "Primitive";
  readonly name: string;
  readonly apply: (args: ReadonlyArray<Arg>) => Run;
}
export type Value = number | Sexp | Primitive | Closure;

// The only way a checked program can fail: dividing by zero.
type Run = Effect.Effect<Value, DivByZero, Output>;

export const display = (v: Value): string =>
  typeof v === "number" ? String(v)
  : v._tag === "Primitive" ? `#<primitive ${v.name}>`
  : v._tag === "Closure" ? `#<closure (${v.params.join(" ")})>`
  : show(v);
// #endregion values

// #region broken
// The checker proved these can't happen. If one does anyway, the
// core is wrong: that's a defect, not an error in the program.
const broken = (what: string) =>
  Effect.die(new Error(`ill-typed core: ${what}`));
// #endregion broken

// #region globals
const numbers = (args: ReadonlyArray<Arg>) =>
  Effect.forEach(args, ({ value }) =>
    typeof value === "number"
      ? Effect.succeed(value)
      : broken(`${display(value)} is not a number`),
  );

const sum = (ns: number[]) => ns.reduce((a, b) => a + b, 0);
const mul = (ns: number[]) => ns.reduce((a, b) => a * b, 1);

const divide = (args: ReadonlyArray<Arg>) =>
  Effect.gen(function* () {
    const [first = 1, ...divisors] = yield* numbers(args);
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

const print = ([arg]: ReadonlyArray<Arg>) =>
  Effect.gen(function* () {
    if (!arg) return yield* broken("print needs an argument");
    const output = yield* Output;
    yield* output.print(display(arg.value));
    return arg.value;
  });

const primitive = (name: string, apply: Primitive["apply"]) =>
  [name, { _tag: "Primitive", name, apply } as const] as const;

export const globals = new Map<string, Value>([
  primitive("+", (args) => Effect.map(numbers(args), sum)),
  primitive("*", (args) => Effect.map(numbers(args), mul)),
  primitive("/", divide),
  primitive("print", print),
  ["pi", Math.PI],
]);
// #endregion globals

// #region execute
export const execute = (c: Core, env: Env | undefined): Run =>
  Effect.gen(function* () {
    switch (c._tag) {
      case "Lit":
        return c.value;
      case "Datum":
        return c.datum;
      case "Global": {
        const value = globals.get(c.name);
        return value ?? (yield* broken(`no global ${c.name}`));
      }
      case "Local": {
        // Walk out `depth` frames, then read a slot.
        let frame = env;
        for (let i = 0; i < c.depth; i++) frame = frame?.parent;
        const value = frame?.slots[c.slot];
        return value ?? (yield* broken(`no slot for ${c.name}`));
      }
      case "Lambda": {
        const { params, body } = c;
        return { _tag: "Closure", params, body, env } as const;
      }
      case "Call": {
        const fn = yield* execute(c.fn, env);
        const args: Arg[] = [];
        for (const arg of c.args) {
          const value = yield* execute(arg, env);
          args.push({ value, span: arg.span });
        }
        if (typeof fn === "object" && fn._tag === "Primitive") {
          return yield* fn.apply(args);
        }
        if (typeof fn === "object" && fn._tag === "Closure") {
          const slots = args.map((arg) => arg.value);
          return yield* execute(fn.body, { slots, parent: fn.env });
        }
        return yield* broken(`${display(fn)} is not a function`);
      }
    }
  });
// #endregion execute

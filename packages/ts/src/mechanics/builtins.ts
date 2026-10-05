/**
 * Pure value functions that mechanics bodies can call, with their checker
 * signatures and Effect TypeScript translations.
 *
 * Signatures use inference variables `v(0)`, `v(1)`, ... that are freshly
 * instantiated at each call. Lambda arguments are checked after the other
 * arguments so their parameter types come from the instantiated signature,
 * the same order TypeScript uses for contextual typing.
 *
 * @module
 */
import type { MType } from "./types.js";
import { tBool, tInt, tNumber, tString, prim } from "./types.js";

export type ImportName = "Duration" | "Option" | "Record" | "Schedule";

/** TypeScript operator precedences used by builtin translations. */
export const Precedence = {
  Arrow: 2,
  Conditional: 3,
  Or: 4,
  And: 5,
  Equality: 9,
  Relational: 10,
  Additive: 12,
  Multiplicative: 13,
  Unary: 15,
  Postfix: 20,
} as const;

/** A translated argument and the precedence of its outermost operator. */
export interface EmitArg {
  readonly code: string;
  readonly prec: number;
}

export interface EmitContext {
  readonly use: (name: ImportName) => void;
  /** The TypeScript type of the call's result, for translations that need an explicit type argument. */
  readonly resultType: () => string;
  /** An identifier for a binder the translation introduces, distinct from every visible name. */
  readonly fresh: (preferred: string) => string;
}

export interface BuiltinOverload {
  readonly params: readonly MType[];
  readonly result: MType;
  readonly emit: (args: readonly EmitArg[], context: EmitContext) => string;
  /** Precedence of the emitted expression; calls and member access by default. */
  readonly prec?: number;
  /** Arguments the translation gives a contextual type (for example through an annotated thunk). */
  readonly contextualArgs?: readonly number[];
}

/** An argument used as a call argument or array element: no parentheses needed. */
const arg = (value: EmitArg | undefined): string => value?.code ?? "undefined";

/** An argument used as an operand of an operator with precedence `prec`. */
const operand = (value: EmitArg | undefined, prec: number): string =>
  value === undefined ? "undefined" : value.prec < prec ? `(${value.code})` : value.code;

/** An argument used as the receiver of `.member` access. */
const receiver = (value: EmitArg | undefined): string => operand(value, Precedence.Postfix);

const v = (id: number): MType => ({ kind: "var", id });
const array = (item: MType): MType => ({ kind: "array", item });
const option = (item: MType): MType => ({ kind: "option", item });
const map = (value: MType): MType => ({ kind: "map", value });
const fn = (params: readonly MType[], result: MType): MType => ({ kind: "function", params, result });

const call = (callee: string, ...args: readonly (EmitArg | undefined)[]): string =>
  `${callee}(${args.map(arg).join(", ")})`;

const optionFromUndefined = (expression: string, context: EmitContext): string => {
  context.use("Option");
  return `Option.fromUndefinedOr(${expression})`;
};

/** An arrow function body; object literals need parentheses. */
export function arrowBody(code: string): string {
  return code.startsWith("{") ? `(${code})` : code;
}

const recordCall = (name: string) => (args: readonly EmitArg[], context: EmitContext): string => {
  context.use("Record");
  return call(`Record.${name}`, ...args);
};

const binary = (operator: string, prec: number) => ([a, b]: readonly EmitArg[]): string =>
  `${operand(a, prec)} ${operator} ${operand(b, prec + 1)}`;

export const builtins: ReadonlyMap<string, readonly BuiltinOverload[]> = new Map<
  string,
  readonly BuiltinOverload[]
>([
  ["mod", [{ params: [tInt, tInt], result: tInt, emit: binary("%", Precedence.Multiplicative), prec: Precedence.Multiplicative }]],
  ["/", [{ params: [tNumber, tNumber], result: tNumber, emit: binary("/", Precedence.Multiplicative), prec: Precedence.Multiplicative }]],
  ["quot", [{ params: [tInt, tInt], result: tInt, emit: (args) => `Math.trunc(${binary("/", Precedence.Multiplicative)(args)})` }]],
  ...(["<", "<=", ">", ">="] as const).map(
    (op): [string, readonly BuiltinOverload[]] => [
      op,
      [{ params: [tNumber, tNumber], result: tBool, emit: binary(op, Precedence.Relational), prec: Precedence.Relational }],
    ],
  ),
  ["not", [{ params: [tBool], result: tBool, emit: ([a]) => `!${operand(a, Precedence.Unary)}`, prec: Precedence.Unary }]],
  [
    "count",
    [
      { params: [array(v(0))], result: tInt, emit: ([a]) => `${receiver(a)}.length` },
      { params: [tString], result: tInt, emit: ([a]) => `${receiver(a)}.length` },
    ],
  ],
  ["empty?", [{ params: [array(v(0))], result: tBool, emit: ([a]) => `${receiver(a)}.length === 0`, prec: Precedence.Equality }]],
  ["map", [{ params: [fn([v(0)], v(1)), array(v(0))], result: array(v(1)), emit: ([f, xs]) => call(`${receiver(xs)}.map`, f) }]],
  ["filter", [{ params: [fn([v(0)], tBool), array(v(0))], result: array(v(0)), emit: ([f, xs]) => call(`${receiver(xs)}.filter`, f) }]],
  [
    "reduce",
    [
      {
        params: [fn([v(1), v(0)], v(1)), v(1), array(v(0))],
        result: v(1),
        emit: ([f, init, xs], context) => call(`${receiver(xs)}.reduce<${context.resultType()}>`, f, init),
      },
    ],
  ],
  [
    "find",
    [
      {
        params: [fn([v(0)], tBool), array(v(0))],
        result: option(v(0)),
        emit: ([f, xs], context) => optionFromUndefined(call(`${receiver(xs)}.find`, f), context),
      },
    ],
  ],
  ["any?", [{ params: [fn([v(0)], tBool), array(v(0))], result: tBool, emit: ([f, xs]) => call(`${receiver(xs)}.some`, f) }]],
  ["every?", [{ params: [fn([v(0)], tBool), array(v(0))], result: tBool, emit: ([f, xs]) => call(`${receiver(xs)}.every`, f) }]],
  [
    "concat",
    [
      { params: [tString, tString], result: tString, emit: binary("+", Precedence.Additive), prec: Precedence.Additive },
      { params: [array(v(0)), array(v(0))], result: array(v(0)), emit: ([a, b]) => `[...${receiver(a)}, ...${receiver(b)}]` },
    ],
  ],
  ["conj", [{ params: [array(v(0)), v(0)], result: array(v(0)), emit: ([xs, x]) => `[...${receiver(xs)}, ${arg(x)}]` }]],
  [
    "first",
    [{ params: [array(v(0))], result: option(v(0)), emit: ([xs], context) => optionFromUndefined(`${receiver(xs)}[0]`, context) }],
  ],
  // Maps go through Effect's Record module, which only sees own keys.
  ["keys", [{ params: [map(v(0))], result: array(tString), emit: recordCall("keys") }]],
  ["vals", [{ params: [map(v(0))], result: array(v(0)), emit: recordCall("values") }]],
  ["dissoc", [{ params: [map(v(0)), tString], result: map(v(0)), emit: recordCall("remove") }]],
  ["has-key?", [{ params: [map(v(0)), tString], result: tBool, emit: recordCall("has") }]],
  ["upcase", [{ params: [tString], result: tString, emit: ([s]) => `${receiver(s)}.toUpperCase()` }]],
  ["downcase", [{ params: [tString], result: tString, emit: ([s]) => `${receiver(s)}.toLowerCase()` }]],
  ["trim", [{ params: [tString], result: tString, emit: ([s]) => `${receiver(s)}.trim()` }]],
  ["starts-with?", [{ params: [tString, tString], result: tBool, emit: ([s, p]) => call(`${receiver(s)}.startsWith`, p) }]],
  ["ends-with?", [{ params: [tString, tString], result: tBool, emit: ([s, p]) => call(`${receiver(s)}.endsWith`, p) }]],
  [
    "includes?",
    [
      { params: [tString, tString], result: tBool, emit: ([s, p]) => call(`${receiver(s)}.includes`, p) },
      { params: [array(v(0)), v(0)], result: tBool, emit: ([xs, x]) => call(`${receiver(xs)}.includes`, x) },
    ],
  ],
  ["split", [{ params: [tString, tString], result: array(tString), emit: ([s, sep]) => call(`${receiver(s)}.split`, sep) }]],
  ["join", [{ params: [array(tString), tString], result: tString, emit: ([xs, sep]) => call(`${receiver(xs)}.join`, sep) }]],
  [
    "get-or-else",
    [
      {
        params: [option(v(0)), v(0)],
        result: v(0),
        contextualArgs: [1],
        emit: ([o, d], context) => {
          context.use("Option");
          // The fallback's return type is stated so TypeScript does not widen literals.
          return `Option.getOrElse(${arg(o)}, (): ${context.resultType()} => ${arrowBody(arg(d))})`;
        },
      },
    ],
  ],
  ...(["is-some", "is-none"] as const).map(
    (name): [string, readonly BuiltinOverload[]] => [
      name,
      [
        {
          params: [option(v(0))],
          result: tBool,
          emit: ([o], context) => {
            context.use("Option");
            return call(name === "is-some" ? "Option.isSome" : "Option.isNone", o);
          },
        },
      ],
    ],
  ),
  ...(["millis", "seconds", "minutes"] as const).map(
    (unit): [string, readonly BuiltinOverload[]] => [
      unit,
      [
        {
          params: [tNumber],
          result: prim("Duration"),
          emit: ([n], context) => {
            context.use("Duration");
            return call(`Duration.${unit}`, n);
          },
        },
      ],
    ],
  ),
  ...(["spaced", "exponential", "fixed"] as const).map(
    (name): [string, readonly BuiltinOverload[]] => [
      name,
      [tNumber, prim("Duration")].map((param) => ({
        params: [param],
        result: prim("Schedule"),
        emit: ([duration]: readonly EmitArg[], context: EmitContext) => {
          context.use("Schedule");
          return call(`Schedule.${name}`, duration);
        },
      })),
    ],
  ),
  ...(["recurs", "jittered"] as const).map(
    (name): [string, readonly BuiltinOverload[]] => [
      name,
      [
        {
          params: [name === "recurs" ? tInt : prim("Schedule")],
          result: prim("Schedule"),
          emit: ([value], context) => {
            context.use("Schedule");
            return call(`Schedule.${name}`, value);
          },
        },
      ],
    ],
  ),
  ["to-string", [{ params: [v(0)], result: tString, emit: ([a]) => call("String", a) }]],
  [
    "abs",
    [
      { params: [tInt], result: tInt, emit: ([a]) => call("Math.abs", a) },
      { params: [tNumber], result: tNumber, emit: ([a]) => call("Math.abs", a) },
    ],
  ],
  ["round", [{ params: [tNumber], result: tInt, emit: ([a]) => call("Math.round", a) }]],
  ["floor", [{ params: [tNumber], result: tInt, emit: ([a]) => call("Math.floor", a) }]],
  [
    "sum",
    [tInt, tNumber].map((item) => ({
      params: [array(item)],
      result: item,
      emit: ([xs]: readonly EmitArg[], context: EmitContext) => {
        const total = context.fresh("total");
        const value = context.fresh("item");
        return `${receiver(xs)}.reduce((${total}, ${value}) => ${total} + ${value}, 0)`;
      },
    })),
  ],
]);

/** Variadic numeric operators: `Int` when every operand is `Int`. */
export const arithmeticOperators: ReadonlyMap<string, string> = new Map([
  ["+", "+"],
  ["-", "-"],
  ["*", "*"],
  ["max", "max"],
  ["min", "min"],
]);

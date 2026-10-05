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

export type ImportName = "Duration" | "Option" | "Schedule";

export interface EmitContext {
  readonly use: (name: ImportName) => void;
  /** The TypeScript type of the call's result, for translations that need an explicit type argument. */
  readonly resultType: () => string;
}

export interface BuiltinOverload {
  readonly params: readonly MType[];
  readonly result: MType;
  readonly emit: (args: readonly string[], context: EmitContext) => string;
  /** Precedence of the emitted expression; calls and member access by default. */
  readonly prec?: number;
}

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

const v = (id: number): MType => ({ kind: "var", id });
const array = (item: MType): MType => ({ kind: "array", item });
const option = (item: MType): MType => ({ kind: "option", item });
const map = (value: MType): MType => ({ kind: "map", value });
const fn = (params: readonly MType[], result: MType): MType => ({ kind: "function", params, result });

const optionFromUndefined = (expression: string, context: EmitContext): string => {
  context.use("Option");
  return `Option.fromUndefinedOr(${expression})`;
};

/** An arrow function body; object literals need parentheses. */
export function arrowBody(code: string): string {
  return code.startsWith("{") ? `(${code})` : code;
}

export const builtins: ReadonlyMap<string, readonly BuiltinOverload[]> = new Map<
  string,
  readonly BuiltinOverload[]
>([
  ["mod", [{ params: [tInt, tInt], result: tInt, emit: ([a, b]) => `${a} % ${b}`, prec: Precedence.Multiplicative }]],
  ["/", [{ params: [tNumber, tNumber], result: tNumber, emit: ([a, b]) => `${a} / ${b}`, prec: Precedence.Multiplicative }]],
  ["quot", [{ params: [tInt, tInt], result: tInt, emit: ([a, b]) => `Math.trunc(${a} / ${b})` }]],
  ...(["<", "<=", ">", ">="] as const).map(
    (op): [string, readonly BuiltinOverload[]] => [
      op,
      [{ params: [tNumber, tNumber], result: tBool, emit: ([a, b]) => `${a} ${op} ${b}`, prec: Precedence.Relational }],
    ],
  ),
  ["not", [{ params: [tBool], result: tBool, emit: ([a]) => `!${a}`, prec: Precedence.Unary }]],
  [
    "count",
    [
      { params: [array(v(0))], result: tInt, emit: ([a]) => `${a}.length` },
      { params: [tString], result: tInt, emit: ([a]) => `${a}.length` },
    ],
  ],
  ["empty?", [{ params: [array(v(0))], result: tBool, emit: ([a]) => `${a}.length === 0`, prec: Precedence.Equality }]],
  ["map", [{ params: [fn([v(0)], v(1)), array(v(0))], result: array(v(1)), emit: ([f, xs]) => `${xs}.map(${f})` }]],
  ["filter", [{ params: [fn([v(0)], tBool), array(v(0))], result: array(v(0)), emit: ([f, xs]) => `${xs}.filter(${f})` }]],
  [
    "reduce",
    [
      {
        params: [fn([v(1), v(0)], v(1)), v(1), array(v(0))],
        result: v(1),
        emit: ([f, init, xs], context) => `${xs}.reduce<${context.resultType()}>(${f}, ${init})`,
      },
    ],
  ],
  [
    "find",
    [
      {
        params: [fn([v(0)], tBool), array(v(0))],
        result: option(v(0)),
        emit: ([f, xs], context) => optionFromUndefined(`${xs}.find(${f})`, context),
      },
    ],
  ],
  ["any?", [{ params: [fn([v(0)], tBool), array(v(0))], result: tBool, emit: ([f, xs]) => `${xs}.some(${f})` }]],
  ["every?", [{ params: [fn([v(0)], tBool), array(v(0))], result: tBool, emit: ([f, xs]) => `${xs}.every(${f})` }]],
  [
    "concat",
    [
      { params: [tString, tString], result: tString, emit: ([a, b]) => `${a} + ${b}`, prec: Precedence.Additive },
      { params: [array(v(0)), array(v(0))], result: array(v(0)), emit: ([a, b]) => `[...${a}, ...${b}]` },
    ],
  ],
  ["conj", [{ params: [array(v(0)), v(0)], result: array(v(0)), emit: ([xs, x]) => `[...${xs}, ${x}]` }]],
  [
    "first",
    [{ params: [array(v(0))], result: option(v(0)), emit: ([xs], context) => optionFromUndefined(`${xs}[0]`, context) }],
  ],
  ["keys", [{ params: [map(v(0))], result: array(tString), emit: ([m]) => `Object.keys(${m})` }]],
  ["vals", [{ params: [map(v(0))], result: array(v(0)), emit: ([m]) => `Object.values(${m})` }]],
  [
    "dissoc",
    [
      {
        params: [map(v(0)), tString],
        result: map(v(0)),
        emit: ([m, k]) => `Object.fromEntries(Object.entries(${m}).filter(([key]) => key !== ${k}))`,
      },
    ],
  ],
  [
    "has-key?",
    [{ params: [map(v(0)), tString], result: tBool, emit: ([m, k]) => `Object.hasOwn(${m}, ${k})` }],
  ],
  ["upcase", [{ params: [tString], result: tString, emit: ([s]) => `${s}.toUpperCase()` }]],
  ["downcase", [{ params: [tString], result: tString, emit: ([s]) => `${s}.toLowerCase()` }]],
  ["trim", [{ params: [tString], result: tString, emit: ([s]) => `${s}.trim()` }]],
  ["starts-with?", [{ params: [tString, tString], result: tBool, emit: ([s, p]) => `${s}.startsWith(${p})` }]],
  ["ends-with?", [{ params: [tString, tString], result: tBool, emit: ([s, p]) => `${s}.endsWith(${p})` }]],
  [
    "includes?",
    [
      { params: [tString, tString], result: tBool, emit: ([s, p]) => `${s}.includes(${p})` },
      { params: [array(v(0)), v(0)], result: tBool, emit: ([xs, x]) => `${xs}.includes(${x})` },
    ],
  ],
  ["split", [{ params: [tString, tString], result: array(tString), emit: ([s, sep]) => `${s}.split(${sep})` }]],
  ["join", [{ params: [array(tString), tString], result: tString, emit: ([xs, sep]) => `${xs}.join(${sep})` }]],
  [
    "get-or-else",
    [
      {
        params: [option(v(0)), v(0)],
        result: v(0),
        emit: ([o, d], context) => {
          context.use("Option");
          return `Option.getOrElse(${o}, () => ${arrowBody(d ?? "undefined")})`;
        },
      },
    ],
  ],
  [
    "is-some",
    [
      {
        params: [option(v(0))],
        result: tBool,
        emit: ([o], context) => {
          context.use("Option");
          return `Option.isSome(${o})`;
        },
      },
    ],
  ],
  [
    "is-none",
    [
      {
        params: [option(v(0))],
        result: tBool,
        emit: ([o], context) => {
          context.use("Option");
          return `Option.isNone(${o})`;
        },
      },
    ],
  ],
  ...(["millis", "seconds", "minutes"] as const).map(
    (unit): [string, readonly BuiltinOverload[]] => [
      unit,
      [
        {
          params: [tNumber],
          result: prim("Duration"),
          emit: ([n], context) => {
            context.use("Duration");
            return `Duration.${unit}(${n})`;
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
        emit: ([duration], context) => {
          context.use("Schedule");
          return `Schedule.${name}(${duration})`;
        },
      })),
    ],
  ),
  [
    "recurs",
    [
      {
        params: [tInt],
        result: prim("Schedule"),
        emit: ([times], context) => {
          context.use("Schedule");
          return `Schedule.recurs(${times})`;
        },
      },
    ],
  ],
  [
    "jittered",
    [
      {
        params: [prim("Schedule")],
        result: prim("Schedule"),
        emit: ([schedule], context) => {
          context.use("Schedule");
          return `Schedule.jittered(${schedule})`;
        },
      },
    ],
  ],
  ["to-string", [{ params: [v(0)], result: tString, emit: ([a]) => `String(${a})` }]],
  ["abs", [{ params: [tInt], result: tInt, emit: ([a]) => `Math.abs(${a})` }, { params: [tNumber], result: tNumber, emit: ([a]) => `Math.abs(${a})` }]],
  ["round", [{ params: [tNumber], result: tInt, emit: ([a]) => `Math.round(${a})` }]],
  ["floor", [{ params: [tNumber], result: tInt, emit: ([a]) => `Math.floor(${a})` }]],
  [
    "sum",
    [
      { params: [array(tInt)], result: tInt, emit: ([xs]) => `${xs}.reduce((total, item) => total + item, 0)` },
      { params: [array(tNumber)], result: tNumber, emit: ([xs]) => `${xs}.reduce((total, item) => total + item, 0)` },
    ],
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

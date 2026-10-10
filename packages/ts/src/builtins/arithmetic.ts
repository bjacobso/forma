import { Effect } from "effect";
import type { BuiltinFn, KValue } from "../evaluator/types.js";
import { asNumber, asInt, isKFloat, numericResult, checkedInt, KFloat, TypeCheckError } from "../evaluator/types.js";
import { ArityError, KernelTypeError } from "../diagnostic/errors.js";

function numericBuiltin(name: string, minimum: number, exact: number | undefined, compute: (args: readonly KValue[]) => KValue): BuiltinFn {
  return (args) => {
    if (args.length < minimum || exact !== undefined && args.length !== exact)
      return Effect.fail(new ArityError({ name, expected: exact ?? `${minimum}+`, got: args.length }));
    try { return Effect.succeed(compute(args)); }
    catch (error) {
      if (!(error instanceof TypeCheckError)) throw error;
      return Effect.fail(new KernelTypeError({ message: error.message, expected: error.expected, got: error.got }));
    }
  };
}

function fold(args: readonly KValue[], initial: number, name: string, step: (a: number, b: number) => number): KValue {
  let result = initial, float = args.some(isKFloat);
  for (const arg of args) {
    result = step(result, asNumber(arg, name));
    if (!float) checkedInt(result, name);
  }
  return numericResult(result, float, name);
}

export const add = numericBuiltin("+", 0, undefined, args => fold(args, 0, "+", (a,b) => a+b));
export const mul = numericBuiltin("*", 0, undefined, args => fold(args, 1, "*", (a,b) => a*b));
export const sub = numericBuiltin("-", 1, undefined, args => {
  let result = asNumber(args[0]!, "-"), float = args.some(isKFloat);
  if (args.length === 1) result = -result;
  else for (const arg of args.slice(1)) {
    result -= asNumber(arg, "-");
    if (!float) checkedInt(result, "-");
  }
  return numericResult(result, float, "-");
});
export const div = numericBuiltin("/", 1, undefined, args => new KFloat(args.slice(1).reduce<number>((a,b) => a/asNumber(b,"/"), asNumber(args[0]!,"/"))));
export const mod = numericBuiltin("mod", 2, 2, args => {
  const left = asInt(args[0]!, "mod"), right = asInt(args[1]!, "mod");
  if (right === 0) throw new TypeCheckError("mod", "nonzero divisor", "0");
  return checkedInt(left % right, "mod");
});
export const abs = numericBuiltin("abs", 1, 1, args => numericResult(Math.abs(asNumber(args[0]!,"abs")), isKFloat(args[0]), "abs"));
export const min = numericBuiltin("min", 1, undefined, args => fold(args, Infinity, "min", Math.min));
export const max = numericBuiltin("max", 1, undefined, args => fold(args, -Infinity, "max", Math.max));
export const round = numericBuiltin("round", 1, 1, args => checkedInt(Math.floor(asNumber(args[0]!,"round") + 0.5), "round"));
export const ceil = numericBuiltin("ceil", 1, 1, args => checkedInt(Math.ceil(asNumber(args[0]!,"ceil")), "ceil"));
export const floor = numericBuiltin("floor", 1, 1, args => checkedInt(Math.floor(asNumber(args[0]!,"floor")), "floor"));

export const arithmeticBuiltins: Record<string, BuiltinFn> = { "+": add, "-": sub, "*": mul, "/": div, mod, abs, min, max, round, ceil, floor };

import { isNumeric } from "../evaluator/types.js";
import { Effect } from "effect";
import type { BuiltinFn } from "../evaluator/types.js";
import { isKBuiltin, isKFn, isKList, isKMap, isKKeyword, isKSymbol } from "../evaluator/types.js";
import { ArityError } from "../diagnostic/errors.js";

export const nilQ: BuiltinFn = (args) => {
  if (args.length !== 1)
    return Effect.fail(new ArityError({ name: "nil?", expected: 1, got: args.length }));
  return Effect.succeed(args[0] === null);
};

export const stringQ: BuiltinFn = (args) => {
  if (args.length !== 1)
    return Effect.fail(new ArityError({ name: "string?", expected: 1, got: args.length }));
  return Effect.succeed(typeof args[0] === "string");
};

export const numberQ: BuiltinFn = (args) => {
  if (args.length !== 1)
    return Effect.fail(new ArityError({ name: "number?", expected: 1, got: args.length }));
  return Effect.succeed(isNumeric(args[0]));
};

export const booleanQ: BuiltinFn = (args) => {
  if (args.length !== 1)
    return Effect.fail(new ArityError({ name: "boolean?", expected: 1, got: args.length }));
  return Effect.succeed(typeof args[0] === "boolean");
};

export const listQ: BuiltinFn = (args) => {
  if (args.length !== 1)
    return Effect.fail(new ArityError({ name: "list?", expected: 1, got: args.length }));
  return Effect.succeed(isKList(args[0]!));
};

export const mapQ: BuiltinFn = (args) => {
  if (args.length !== 1)
    return Effect.fail(new ArityError({ name: "map?", expected: 1, got: args.length }));
  return Effect.succeed(isKMap(args[0]!));
};

export const fnQ: BuiltinFn = (args) => {
  if (args.length !== 1)
    return Effect.fail(new ArityError({ name: "fn?", expected: 1, got: args.length }));
  return Effect.succeed(isKFn(args[0]!) || isKBuiltin(args[0]!));
};

export const typecheckBuiltins: Record<string, BuiltinFn> = {
  "keyword?": args => Effect.succeed(args.length===1 && isKKeyword(args[0]!)),
  "symbol?": args => Effect.succeed(args.length===1 && isKSymbol(args[0]!)),
  "nil?": nilQ,
  "string?": stringQ,
  "number?": numberQ,
  "boolean?": booleanQ,
  "list?": listQ,
  "map?": mapQ,
  "fn?": fnQ,
};

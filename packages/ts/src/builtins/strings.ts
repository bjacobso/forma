import { isKFloat, printFloat } from "../evaluator/types.js";
import { namespaceOf } from "../surface/domain.js";
import { Effect } from "effect";
import type { BuiltinFn, KValue } from "../evaluator/types.js";
import { asString, isKKeyword, isKSymbol, KKeyword, KSymbol } from "../evaluator/types.js";
import { ArityError } from "../diagnostic/errors.js";


function stringify(v: KValue): string {
  if (v === null) return "";
  if (isKKeyword(v) || isKSymbol(v)) return v.name;
  if (typeof v === "string") return v;
  if (isKFloat(v)) return Number.isNaN(v.value) ? "nan" : v.value === Infinity ? "inf" : v.value === -Infinity ? "-inf" : printFloat(v.value).replace(/\.0$/, ".");
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return String(v);
  return String(v);
}

export const str: BuiltinFn = (args) => {
  return Effect.succeed(args.map(stringify).join(""));
};

export const upper: BuiltinFn = (args) => {
  if (args.length !== 1)
    return Effect.fail(new ArityError({ name: "upper", expected: 1, got: args.length }));
  return Effect.succeed(asString(args[0]!, "upper").toUpperCase());
};

export const lower: BuiltinFn = (args) => {
  if (args.length !== 1)
    return Effect.fail(new ArityError({ name: "lower", expected: 1, got: args.length }));
  return Effect.succeed(asString(args[0]!, "lower").toLowerCase());
};

export const trim: BuiltinFn = (args) => {
  if (args.length !== 1)
    return Effect.fail(new ArityError({ name: "trim", expected: 1, got: args.length }));
  return Effect.succeed(asString(args[0]!, "trim").trim());
};

export const containsQ: BuiltinFn = (args) => {
  if (args.length !== 2)
    return Effect.fail(new ArityError({ name: "contains?", expected: 2, got: args.length }));
  return Effect.succeed(asString(args[0]!, "contains?").includes(asString(args[1]!, "contains?")));
};

export const startsWithQ: BuiltinFn = (args) => {
  if (args.length !== 2)
    return Effect.fail(new ArityError({ name: "starts-with?", expected: 2, got: args.length }));
  return Effect.succeed(
    asString(args[0]!, "starts-with?").startsWith(asString(args[1]!, "starts-with?")),
  );
};

export const endsWithQ: BuiltinFn = (args) => {
  if (args.length !== 2)
    return Effect.fail(new ArityError({ name: "ends-with?", expected: 2, got: args.length }));
  return Effect.succeed(
    asString(args[0]!, "ends-with?").endsWith(asString(args[1]!, "ends-with?")),
  );
};

export const format: BuiltinFn = (args) => {
  if (args.length < 1)
    return Effect.fail(new ArityError({ name: "format", expected: "1+", got: 0 }));
  const template = asString(args[0]!, "format");
  let i = 1;
  const result = template.replace(/\{\}/g, () => {
    if (i < args.length) return stringify(args[i++]!);
    return "{}";
  });
  return Effect.succeed(result);
};

export const sym: BuiltinFn = (args) => {
  if (args.length !== 1)
    return Effect.fail(new ArityError({ name: "sym", expected: 1, got: args.length }));
  const s = asString(args[0]!, "sym");
  return Effect.succeed(KSymbol(s));
};

export const keyword: BuiltinFn = args => {
  if (args.length<1 || args.length>2) return Effect.fail(new ArityError({name:"keyword",expected:"1-2",got:args.length}));
  const key=String(args.at(-1)).replace(/^:/,"");
  return Effect.succeed(KKeyword(args.length===1 || key.includes("/") ? key : `${namespaceOf(String(args[0]))}/${key}`));
};

export const split: BuiltinFn = args => {
  if (args.length !== 2) return Effect.fail(new ArityError({name:"split",expected:2,got:args.length}));
  return Effect.succeed(asString(args[0]!, "split").split(asString(args[1]!, "split")));
};

export const stringBuiltins: Record<string, BuiltinFn> = {
  split,
  str,
  upper,
  lower,
  trim,
  "contains?": containsQ,
  "starts-with?": startsWithQ,
  "ends-with?": endsWithQ,
  format,
  sym,
  keyword,
};

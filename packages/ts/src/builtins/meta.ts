import { Effect } from "effect";
import { ArityError } from "../diagnostic/errors.js";
import type { BuiltinFn, KValue } from "../evaluator/types.js";
import { isKKeyword } from "../evaluator/types.js";

/** Read metadata on a type datum, keeping type structure separate from options. */
export const meta: BuiltinFn = args => {
  if (args.length!==3) return Effect.fail(new ArityError({name:"meta",expected:3,got:args.length}));
  const t=args[0];
  const values=Array.isArray(t) ? String(t[0])==="Option" && Array.isArray(t[1]) ? t[1] : t : [];
  const at=values.findIndex((v,i)=>i>0 && isKKeyword(v) && String(v)===String(args[1]));
  return Effect.succeed(at>=0 ? values[at+1] ?? args[2] ?? null : args[2] ?? null);
};
export const typeBase: BuiltinFn = args => {
  if (args.length!==1) return Effect.fail(new ArityError({name:"type/base",expected:1,got:args.length}));
  const t=args[0]!;
  if (!Array.isArray(t)) return Effect.succeed(t);
  const h = String(t[0]);
  const minimum = ["Map", "Result"].includes(h) ? 3 : ["List", "Option", "Id", "Brand"].includes(h) ? 2 : 1;
  const metadata = new Set([":indexed", ":doc", ":default", ":pattern", ":min", ":max", ":min-length", ":max-length", ":format"]);
  const at=t.findIndex((v,i)=>i>=minimum && isKKeyword(v) && (!["Union","Tagged"].includes(h) || metadata.has(String(v))));
  const base=at<0 ? t : t.slice(0,at);
  return Effect.succeed(base.length===1 ? base[0]! : base as KValue);
};
export const keywordName: BuiltinFn = args => args.length===1 ? Effect.succeed(String(args[0]).replace(/^:/,"")) : Effect.fail(new ArityError({name:"keyword/name",expected:1,got:args.length}));

export const typeMetadata: BuiltinFn = args => {
  if (args.length !== 1) return Effect.fail(new ArityError({name:"type/metadata",expected:1,got:args.length}));
  const t=args[0];
  const values=Array.isArray(t) ? t : [];
  const minimum=["Map","Result"].includes(String(values[0])) ? 3 : ["List","Option","Id","Brand"].includes(String(values[0])) ? 2 : 1;
  const keys=new Set([":indexed",":doc",":default",":pattern",":min",":max",":min-length",":max-length",":format"]);
  const at=values.findIndex((v,i)=>i>=minimum && isKKeyword(v) && (!["Union","Tagged"].includes(String(values[0])) || keys.has(String(v))));
  return Effect.succeed(new Map(at<0 ? [] : values.slice(at).reduce<[string,KValue][]>((entries,value,index,all)=>index%2===0 ? [...entries,[String(value),all[index+1] ?? null]] : entries,[])));
};

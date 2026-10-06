import type { SExpr } from "../reader/types.js";
import { head, name } from "./effect.js";
import { splitTypeMetadata } from "./domain.js";

const legacy = new Map(Object.entries({Str:"String",Num:"Number",Nil:"Unit",Boolean:"Bool",Array:"List",Vector:"List",Optional:"Option",Float:"Number",Uint8Array:"Bytes",string:"String",integer:"Int",number:"Number",boolean:"Bool"}));
export const schemaMetadata = new Set([":doc", ":pattern", ":title", ":identifier"]);
const fieldMetadata = new Set([":indexed", ":doc", ":default"]);

/** Syntax holes keep types as syntax; checking them must not evaluate authored code. */
export function typeSyntaxErrors(expression: SExpr, allowedMetadata: ReadonlySet<string> = fieldMetadata): readonly string[] {
  const errors: string[] = [];
  let type: SExpr;
  try {
    const split = splitTypeMetadata(expression);
    type = split.type;
    for (const [key, value] of split.metadata) {
      const n = name(key)!;
      if (!allowedMetadata.has(n)) errors.push(`Unknown type metadata ${n}`);
      else if (n === ":indexed" && value._tag !== "Bool") errors.push(":indexed metadata expects Bool");
      else if ([":doc",":pattern",":title",":identifier"].includes(n) && value._tag !== "Str") errors.push(`${n} metadata expects String`);
    }
  } catch (error) { return [error instanceof Error ? error.message : String(error)]; }
  const n = name(type);
  if (n && legacy.has(n)) errors.push(`Use ${legacy.get(n)} instead of ${n}`);
  if (type._tag === "Map") {
    const seen = new Set<string>();
    for (const [key, value] of type.pairs) {
      const label = name(key);
      if (label === "&") {
        if (value._tag !== "Sym" || !/^[a-z]/.test(value.name)) errors.push("An open row requires a lowercase type variable");
      } else {
        if (!label?.startsWith(":")) errors.push("Record type fields require keyword keys");
        if (seen.has(label ?? "")) errors.push(`Duplicate record field ${label}`);
        seen.add(label ?? "");
        errors.push(...typeSyntaxErrors(value, allowedMetadata));
      }
    }
  } else if (type._tag === "List") {
    const h = head(type), args = type.items.slice(1);
    if (h && legacy.has(h)) errors.push(`Use ${legacy.get(h)} instead of ${h}`);
    if (!h || h.startsWith(":")) errors.push("Type application requires a type constructor");
    if (["List", "Option", "Id"].includes(h ?? "") && args.length !== 1) errors.push(`${h} expects one type argument`);
    if (["Map", "Result"].includes(h ?? "") && args.length !== 2) errors.push(`${h} expects two type arguments`);
    if (h === "Brand") errors.push("Brand is only allowed as a type declaration body");
    if (h === "Union" && !args.length) errors.push("Union requires at least one member");
    if (h === "->" && args.length < 1) errors.push("Function types require a return type");
    if (["Effect","Stream","Fiber","Layer"].includes(h ?? "")) {
      if (args.length < 1 || args.length > 3) errors.push("Effect expects a success type and optional error and requirement sets");
      if (h !== "Layer" && args[0]) errors.push(...typeSyntaxErrors(args[0], allowedMetadata));
      for (const set of args.slice(h === "Layer" ? 0 : 1)) if (set._tag !== "Vector" || set.items.some(e => e._tag !== "Sym" || e.name.startsWith(":"))) errors.push("Effect sets require vectors of type symbols");
    } else if (h === "Tagged") {
      const arms = name(args[0]) === ":tag" ? args.slice(2) : args;
      for (const arm of arms) {
        const ctor = arm._tag === "List" ? name(arm.items[0]) : name(arm);
        if (!ctor || !/^[A-Z]/.test(ctor)) errors.push("Tagged constructors require capitalized names");
        if (arm._tag === "List") {
          if (arm.items.length !== 2) errors.push("Tagged constructors accept one payload type");
          if (arm.items[1]) errors.push(...typeSyntaxErrors(arm.items[1], allowedMetadata));
        }
      }
    } else for (const arg of args) errors.push(...typeSyntaxErrors(arg, allowedMetadata));
  } else if (!["Sym", "Str", "Num", "Bool"].includes(type._tag)) errors.push("Expected type syntax");
  return errors;
}

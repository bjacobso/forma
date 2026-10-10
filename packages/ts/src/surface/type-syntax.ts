import type { SExpr } from "../reader/types.js";
import { head, name } from "./effect.js";
import { splitTypeMetadata } from "./domain.js";

const legacy = new Map(Object.entries({Str:"String",Nil:"Unit",Boolean:"Bool",Array:"List",Vector:"List",Optional:"Option",Uint8Array:"Bytes",string:"String",integer:"Int",number:"Number",boolean:"Bool"}));
export const schemaMetadata = new Set([":doc", ":pattern", ":title", ":identifier"]);
const fieldMetadata = new Set([":indexed", ":doc", ":default"]);

/** Find the authored field (or unknown tail) that could overwrite a tag. */
export function taggedPayloadProblem(expression: SExpr): { expression: SExpr; message: string } | undefined {
  if (head(expression) === "Tagged" && expression._tag === "List") {
    const args = expression.items.slice(1);
    const custom = name(args[0]) === ":tag";
    const discriminator = `:${(custom ? name(args[1]) ?? "_tag" : "_tag").replace(/^:/, "")}`;
    for (const arm of custom ? args.slice(2) : args) {
      const payload = arm._tag === "List" ? arm.items[1] : undefined;
      if (payload?._tag !== "Map") continue;
      for (const [key] of payload.pairs) {
        if (name(key) === discriminator) return { expression: key, message: `Tagged record payload must be disjoint from discriminator ${discriminator}` };
        if (name(key) === "&") return { expression: key, message: "Tagged record payload requires a closed record; open-row disjointness is not supported" };
      }
    }
  }
  const children = expression._tag === "Map" ? expression.pairs.map(([,value]) => value)
    : expression._tag === "List" || expression._tag === "Vector" ? expression.items : [];
  for (const child of children) {
    const problem = taggedPayloadProblem(child);
    if (problem) return problem;
  }
}

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
    } else if (h === "Pick" || h === "Omit" || h === "Merge") {
      // The type parser retains key spans when validating arity and syntax.
      for (const arg of args.slice(0, h === "Merge" ? 2 : 1)) errors.push(...typeSyntaxErrors(arg, allowedMetadata));
    } else if (h === "Tagged") {
      const arms = name(args[0]) === ":tag" ? args.slice(2) : args;
      const discriminator = `:${(name(args[0]) === ":tag" ? name(args[1]) ?? "_tag" : "_tag").replace(/^:/, "")}`;
      for (const arm of arms) {
        const ctor = arm._tag === "List" ? name(arm.items[0]) : name(arm);
        if (!ctor || !/^[A-Z]/.test(ctor)) errors.push("Tagged constructors require capitalized names");
        if (arm._tag === "List") {
          if (arm.items.length !== 2) errors.push("Tagged constructors accept one payload type");
          const payload = arm.items[1];
          if (payload) errors.push(...typeSyntaxErrors(payload, allowedMetadata));
          if (payload?._tag === "Map") {
            if (payload.pairs.some(([key]) => name(key) === discriminator)) errors.push(`Tagged record payload must be disjoint from discriminator ${discriminator}`);
            if (payload.pairs.some(([key]) => name(key) === "&")) errors.push("Tagged record payload requires a closed record; open-row disjointness is not supported");
          }
        }
      }
    } else for (const arg of args) errors.push(...typeSyntaxErrors(arg, allowedMetadata));
  } else if (!["Sym", "Str", "Num", "Bool"].includes(type._tag)) errors.push("Expected type syntax");
  return errors;
}

/** Resolve names in an authored type against its declaration environment. */
export function unknownTypeReferences(expression: SExpr, isKnown: (name: string) => boolean): readonly string[] {
  const primitives = new Set(["String", "Int", "Float", "Number", "Num", "Bool", "Unit", "Json", "Any", "Unknown", "Never", "Symbol", "Keyword", "Type", "Syntax", "RuntimeExpr", "Bytes", "DateTime", "Duration", "List", "Option", "Map", "Record", "Union", "Tagged", "Id", "Brand", "Result", "->", "Effect", "Stream", "Layer", "Fiber", "Ref", "RefCell", "Scope", "OntologyRuntime"]);
  const visit = (expr: SExpr): readonly string[] => {
    const type = splitTypeMetadata(expr).type;
    if (type._tag === "List" && ["Pick", "Omit", "Merge"].includes(head(type) ?? "")) {
      return type.items.slice(1, head(type) === "Merge" ? 3 : 2).flatMap(visit);
    }
    if (type._tag === "Sym") return type.name.startsWith(":") || /^[a-z]/.test(type.name) || primitives.has(type.name) || isKnown(type.name) ? [] : [`Unknown type ${type.name}`];
    if (type._tag === "Map") return type.pairs.flatMap(([,value]) => visit(value));
    if (type._tag === "List") {
      if (head(type) === "Tagged") return type.items.slice(name(type.items[1]) === ":tag" ? 3 : 1).flatMap(arm => arm._tag === "List" && arm.items[1] ? visit(arm.items[1]) : []);
      return type.items.flatMap(visit);
    }
    if (type._tag === "Vector") return type.items.flatMap(visit);
    return [];
  };
  return visit(expression);
}

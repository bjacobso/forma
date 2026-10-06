import type { SExpr } from "../reader/types.js";
import { head, name, list, sym, vector } from "./effect.js";

/** Keep generic alias parameters with their body in the compile-time type table. */
export function typeDefinition(expr: SExpr): readonly [string, SExpr] | undefined {
  if (expr._tag !== "List") return;
  if (["error", "class"].includes(head(expr) ?? "") && name(expr.items[1])) return [name(expr.items[1])!, expr.items[2]?._tag === "Map" ? expr.items[2] : {_tag:"Map",loc:expr.loc,pairs:[]}];
  if (head(expr) !== "type" || !expr.items[2]) return;
  const header = expr.items[1]!;
  if (header._tag === "Sym") return [header.name, expr.items[2]];
  if (header._tag !== "List" || !name(header.items[0])) return;
  return [name(header.items[0])!, list(expr, [sym(expr, "__type-function"), vector(header, header.items.slice(1)), expr.items[2]])];
}

function substitute(type: SExpr, bindings: ReadonlyMap<string, SExpr>): SExpr {
  if (type._tag === "Sym") return bindings.get(type.name) ?? type;
  if (type._tag === "Map") return {...type, pairs:type.pairs.map(([key,value]) => [key,substitute(value,bindings)] as const)};
  if (type._tag === "List" || type._tag === "Vector") return {...type,items:type.items.map(item=>substitute(item,bindings))};
  return type;
}

/** Resolve only the outer type; recursive record fields remain lazy. */
export function resolveTypeAlias(type: SExpr, types: ReadonlyMap<string,SExpr>, seen: ReadonlySet<string> = new Set()): SExpr {
  const owner=name(type) ?? head(type), definition=owner ? types.get(owner) : undefined;
  if (!owner || !definition) return type;
  if (seen.has(owner)) throw new Error(`Cyclic type alias ${owner}`);
  const next=new Set([...seen,owner]);
  if (head(definition)==="__type-function" && definition._tag==="List") {
    const params=definition.items[1], args=type._tag==="List" ? type.items.slice(1) : [];
    if (params?._tag!=="Vector" || args.length!==params.items.length) throw new Error(`Type ${owner} expects ${params?._tag==="Vector" ? params.items.length : 0} arguments`);
    const bindings=new Map(params.items.map((param,i)=>[name(param)!,args[i]!]));
    return resolveTypeAlias(substitute(definition.items[2]!,bindings),types,next);
  }
  if (type._tag==="List") return type;
  return resolveTypeAlias(definition,types,next);
}

export const optionalType = (type: SExpr, types: ReadonlyMap<string,SExpr>): boolean => head(resolveTypeAlias(type,types))==="Option";

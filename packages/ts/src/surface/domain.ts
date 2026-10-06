import type { SExpr } from "../reader/types.js";
import { head, name, list } from "./effect.js";

export function namespaceOf(n: string): string {
  return n.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

/** A type annotation and its trailing metadata use the same grammar everywhere. */
export function splitTypeMetadata(t: SExpr): { type: SExpr; metadata: readonly (readonly [SExpr,SExpr])[] } {
  if (t._tag !== "List") return {type:t,metadata:[]};
  const h = head(t);
  const metadataKeys = new Set([":indexed", ":doc", ":default", ":pattern", ":min", ":max", ":min-length", ":max-length", ":format", ":title", ":identifier"]);
  const minimum = h === "Map" || h === "Result" ? 3 : ["List", "Option", "Id", "Brand"].includes(h ?? "") ? 2 : 1;
  const at = t.items.findIndex((e, i) => i >= minimum && name(e)?.startsWith(":") && name(e) !== ":"
    && (h !== "Union" && h !== "Tagged" || metadataKeys.has(name(e)!)));
  if (at < 0) return {type:t,metadata:[]};
  const metadata: (readonly [SExpr,SExpr])[] = [];
  const names = new Set<string>();
  for (let i=at;i<t.items.length;i+=2) {
    const key = t.items[i]!, value = t.items[i+1];
    if (!name(key)?.startsWith(":") || !value) throw new Error("Type metadata expects :key value pairs");
    if (names.has(name(key)!)) throw new Error(`Duplicate type metadata ${name(key)}`);
    names.add(name(key)!); metadata.push([key,value]);
  }
  return {type:at===1 ? t.items[0]! : list(t,t.items.slice(0,at)),metadata};
}

export function stripTypeMetadata(t: SExpr): SExpr {
  const base=splitTypeMetadata(t).type;
  if (base._tag === "Map") return {...base, pairs: base.pairs.map(([k, v]) => [k, stripTypeMetadata(v)] as const)};
  return base._tag === "List" ? {...base,items:base.items.map(stripTypeMetadata)} : base;
}

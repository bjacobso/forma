import type { SExpr } from "../reader/types.js";
import { head, name, list } from "./effect.js";

export function namespaceOf(n: string): string {
  return n.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

/** A type annotation and its trailing metadata use the same grammar everywhere. */
export function splitTypeMetadata(t: SExpr): { type: SExpr; metadata: readonly (readonly [SExpr,SExpr])[] } {
  if (t._tag !== "List") return {type:t,metadata:[]};
  const h = head(t);
  const metadataKeys = new Set([":indexed", ":doc", ":default", ":pattern", ":min", ":max", ":min-length", ":max-length", ":finite", ":format", ":title", ":identifier"]);
  const minimum = ["Map", "Result", "Pick", "Omit", "Merge"].includes(h ?? "") ? 3 : ["List", "Option", "Id", "Brand"].includes(h ?? "") ? 2 : 1;
  const at = t.items.findIndex((e, i) => i >= minimum && name(e)?.startsWith(":") && name(e) !== ":"
    && (h !== "Union" && h !== "Tagged" || metadataKeys.has(name(e)!)));
  if (at < 0) return {type:t,metadata:[]};
  const metadata: (readonly [SExpr,SExpr])[] = [];
  const names = new Set<string>();
  for (let i=at;i<t.items.length;i+=2) {
    const key = t.items[i]!, value = t.items[i+1];
    if (!name(key)?.startsWith(":") || !value) throw Object.assign(new Error("Type metadata expects :key value pairs"), { loc: key.loc, details: { code: "surface/invalid-form" } });
    if (names.has(name(key)!)) throw Object.assign(new Error(`Duplicate type metadata ${name(key)}`), { loc: key.loc, details: { code: "surface/invalid-form" } });
    names.add(name(key)!); metadata.push([key,value]);
  }
  return {type:at===1 ? t.items[0]! : list(t,t.items.slice(0,at)),metadata};
}

/** Remove type metadata recursively, except keys in `keep`. */
export function stripTypeMetadata(t: SExpr, keep?: ReadonlySet<string>): SExpr {
  const split=splitTypeMetadata(t), base=split.type;
  const kept=keep ? split.metadata.filter(([key]) => keep.has(name(key)!)).flat() : [];
  const stripped: SExpr = base._tag === "Map" ? {...base, pairs: base.pairs.map(([k, v]) => [k, stripTypeMetadata(v, keep)] as const)}
    : base._tag === "List" ? {...base,items:base.items.map(item => stripTypeMetadata(item, keep))} : base;
  if (!kept.length) return stripped;
  return list(t, stripped._tag === "List" ? [...stripped.items, ...kept] : [stripped, ...kept]);
}

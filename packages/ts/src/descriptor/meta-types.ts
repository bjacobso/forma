import type { KValue } from "../evaluator/types.js";
import { isKKeyword, isKSymbol } from "../evaluator/types.js";
import { TApp, TCon, TRow, buildRow, REmpty, showType, type Type } from "../type/types.js";

export function metaText(value: KValue | undefined): string | undefined {
  return typeof value === "string" ? value.replace(/^:/, "")
    : value !== undefined && (isKKeyword(value) || isKSymbol(value)) ? String(value).replace(/^:/, "") : undefined;
}

/** Decode the shared meta type vocabulary without silently accepting bad values. */
export function metaType(value: KValue | undefined): Type | undefined {
  const normalize = (name: string) => ({ Bool: "Bool", Boolean: "Bool", Str: "String", Num: "Number", Nil: "Unit", Any: "Unknown", _: "Unknown" }[name] ?? name);
  const text = metaText(value);
  if (text) return TCon(normalize(text));
  if (!(value instanceof Map)) return;
  value = new Map([...value].map(([key,v]) => [key.replace(/^:/, "").replace(/^\0str:/, ""),v]));
  const internal = value.get("_hmType");
  if (internal && typeof internal === "object" && "_tag" in internal) return internal as unknown as Type;
  const tag = metaText(value.get("_type") ?? value.get("kind"));
  if (tag === "unknown") return TCon("Unknown");
  if (["constant", "type", "type-ref"].includes(String(tag)) || value.has("type")) {
    const name = metaText(value.get("name") ?? value.get("type"));
    return name ? TCon(normalize(name)) : undefined;
  }
  if (["list", "vector", "type-list", "type-vector"].includes(String(tag))) {
    const element = metaType(value.get("element") ?? value.get("item"));
    // The TS engine uses List for vector literals; this port preserves that policy.
    return element ? TApp(TCon("List"), [element]) : undefined;
  }
  if (tag === "row" || tag === "type-record") {
    const fields = value.get("fields");
    if (Array.isArray(fields) && fields.some(field => !(field instanceof Map))) return;
    const entries = fields instanceof Map ? [...fields] : Array.isArray(fields)
      ? fields.filter((f): f is Map<string,KValue> => f instanceof Map).map(f => [f.get("label") ?? f.get(":label"), f.get("type") ?? f.get(":type")] as const) : undefined;
    if (!entries) return;
    const types = new Map<string, Type>();
    for (const [label, raw] of entries) {
      const name = typeof label === "string" ? label : label !== undefined && isKKeyword(label) ? String(label) : metaText(label);
      const type = metaType(raw);
      if (!name || !type) return;
      types.set(name, type);
    }
    return TRow(buildRow(types, REmpty));
  }
  return;
}

export function metaTypeValue(type: Type): KValue {
  const value = describeMetaType(type) as Map<string,KValue>;
  value.set("_hmType", type as unknown as KValue);
  return value;
}

function describeMetaType(type: Type): KValue {
  if (type._tag === "TCon") return new Map([["_type", "constant"], ["kind","type"], ["name", type.name]]);
  if (type._tag === "TApp" && type.con._tag === "TCon" && type.con.name === "List")
    return new Map<string,KValue>([["_type", "list"], ["kind","type-list"], ["element", metaTypeValue(type.args[0]!)], ["item",metaTypeValue(type.args[0]!)]]);
  if (type._tag === "TRow") {
    const fields = new Map<string,KValue>();
    let row = type.row;
    while (row._tag === "RExtend") { fields.set(row.label, metaTypeValue(row.type)); row = row.tail; }
    return new Map<string,KValue>([["_type", "row"], ["fields", fields]]);
  }
  return new Map([["_type", "unknown"], ["kind","type"], ["name",showType(type)]]);
}

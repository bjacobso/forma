import { isNumeric, kEquals, numericDatum } from "../evaluator/types.js";
import { resolveTypeAlias, optionalType } from "./type-alias.js";
import { isKKeyword, isKSymbol, mapKey, mapKeyValue } from "../evaluator/types.js";
import type { SExpr } from "../reader/types.js";
import type { FormDescriptor, DescriptorExtensionValue } from "../descriptor/FormDescriptor.js";
import type { KValue } from "../evaluator/types.js";
import { head, name } from "./effect.js";

const optional = (t: SExpr) => head(t) === "Option" && t._tag === "List";
const field = (e: SExpr) => (name(e) ?? (e._tag === "Str" ? e.value : "")).replace(/^:/, "");
export function protocolType(t: SExpr, types: ReadonlyMap<string, SExpr> = new Map()): DescriptorExtensionValue {
  if (t._tag === "List" && types.has(head(t) ?? "")) t = resolveTypeAlias(t, types);
  const descend = (t: SExpr) => protocolType(t, types);
  if (t._tag === "Map") return {object: Object.fromEntries(t.pairs.map(([key, value]) => [field(key), {...(descend(value) as Record<string, DescriptorExtensionValue>), required: !optionalType(value, types)}]))};
  if (optional(t) && t._tag === "List") return descend(t.items[1]!);
  if (t._tag === "Str" || t._tag === "Num" || t._tag === "Bool") return { literal: [t.value] };
  if (name(t)?.startsWith(":")) return {literal:[name(t)!.slice(1)]};
  const n = name(t);
  if (n) return ["String","Symbol","Keyword"].includes(n) ? {type:"string"} : n === "Int" ? {type:"integer"} : ["Float","Number","Num"].includes(n) ? {type:"number"} : n === "Bool" ? {type:"boolean"} : n === "Unit" ? {type:"null"} : ["Type","Syntax","RuntimeExpr","Any","Json"].includes(n) ? {type:"unknown"} : {ref:n};
  if (t._tag === "List") {
    if (head(t) === "List") return {array:descend(t.items[1]!)};
    if (head(t) === "Map" || head(t) === "Record") return {record:descend(t.items.at(-1)!)};
    if (head(t) === "Union") return {union:t.items.slice(1).map(descend)};
    if (head(t) === "Brand") return descend(t.items.at(-1)!);
  }
  return {type:"unknown"};
}
export function typeDescriptor(n: string, t: SExpr, types: ReadonlyMap<string, SExpr> = new Map()): FormDescriptor {
  const base: FormDescriptor = {name:n,phase:"meta",identifiers:[],slots:[],bindings:{kind:"none"},validation:{kind:"none"},elaboration:{kind:"none"},resultType:{kind:"none"},produces:n};
  if (t._tag === "Map") return {...base,extensions:{"protocol/object":{name:n,fields:Object.fromEntries(t.pairs.map(([k,v])=>[field(k),{...(protocolType(v, types) as Record<string,DescriptorExtensionValue>),required:!optionalType(v,types)}]))}}};
  if (head(t) === "Union" && t._tag === "List") {
    const members = t.items.slice(1);
    const literals = members.map(member => member._tag === "Str" || member._tag === "Num" || member._tag === "Bool" ? member.value : name(member)?.startsWith(":") ? name(member)!.slice(1) : undefined);
    if (literals.every(value => value !== undefined)) return {...base, extensions:{"protocol/enum":{name:n,values:literals as (string | number | boolean)[]}}};
    const entries = members.map((member, i) => {
      const reference = name(member);
      const record = reference ? types.get(reference) : member;
      const tag = record?._tag === "Map" ? record.pairs.find(([key]) => name(key) === ":kind" || name(key) === ":_tag")?.[1] : undefined;
      const key = tag?._tag === "Str" ? tag.value : name(tag)?.replace(/^:/, "") ?? reference ?? String(i);
      return [key, protocolType(member, types)] as const;
    });
    return {...base,extensions:{"protocol/union":{name:n,members:Object.fromEntries(entries)}}};
  }
  return {...base,extensions:{"protocol/type":{name:n,type:protocolType(t, types)}}};
}

/** Validate a form's actual output against the declared IR type, including references. */
export function contractErrors(value: KValue, t: SExpr, types: ReadonlyMap<string,SExpr>, path = "payload", seen = new Set<string>()): readonly string[] {
  t=resolveTypeAlias(t,types);
  if (optional(t) && t._tag === "List") {
    if (value === null || value === undefined || value instanceof Map && value.get(":_tag") === "None") return [];
    const inner = value instanceof Map && value.get(":_tag") === "Some" ? value.get(":value") : value;
    return contractErrors(inner!, t.items[1]!, types, path, seen);
  }
  const n = name(t);
  if (n && types.has(n) && !seen.has(`${n}:${path}`)) return contractErrors(value,types.get(n)!,types,path,new Set([...seen,`${n}:${path}`]));
  if (t._tag === "Map") {
    if (!(value instanceof Map)) return [`${path} must be a record`];
    const errors: string[] = [];
    for (const [k,v] of t.pairs) {
      const key = field(k), actual = value.get(contractKey(k));
      if (actual === undefined && !optionalType(v,types)) errors.push(`${path}.${key} is required`);
      else if (actual !== undefined) errors.push(...contractErrors(actual,v,types,`${path}.${key}`,seen));
    }
    const allowed = new Set(t.pairs.map(([k]) => contractKey(k)));
    for (const key of value.keys()) if (!allowed.has(key)) errors.push(`${path}.${String(mapKeyValue(key))} is not a declared field`);
    return errors;
  }
  if (t._tag === "List") {
    const h = head(t);
    if (h === "List") return Array.isArray(value) ? value.flatMap((v,i)=>contractErrors(v,t.items[1]!,types,`${path}[${i}]`,seen)) : [`${path} must be a list`];
    if (h === "Union") return t.items.slice(1).some(a=>contractErrors(value,a,types,path,seen).length===0) ? [] : [`${path} does not match any Union member`];
    if (h === "Id") return typeof value === "string" ? [] : [`${path} must be an entity ID string`];
    if (h === "Brand") return contractErrors(value,t.items.at(-1)!,types,path,seen);
    if (h === "Map" || h === "Record") return value instanceof Map ? [...value].flatMap(([k,v])=>[
      ...(h === "Map" && t.items.length === 3 ? contractErrors(mapKeyValue(k),t.items[1]!,types,`${path}.key`,seen) : []),
      ...contractErrors(v,t.items.at(-1)!,types,`${path}.${k}`,seen)]) : [`${path} must be a map`];
  }
  if (t._tag === "Str" || t._tag === "Num" || t._tag === "Bool") return kEquals(value, t._tag === "Num" ? numericDatum(t) : t.value) ? [] : [`${path} must equal ${JSON.stringify(t.value)}`];
  if (n?.startsWith(":")) return isKKeyword(value) && value.name === n ? [] : [`${path} must equal ${n}`];
  const valid = n === "String" ? typeof value === "string" : n === "Symbol" ? isKSymbol(value) : n === "Keyword" ? isKKeyword(value) : n === "Int" ? typeof value === "number" && Number.isSafeInteger(value) : ["Float", "Number", "Num"].includes(n ?? "") ? isNumeric(value) : n === "Bool" ? typeof value === "boolean" : n === "Unit" ? value === null : ["Any", "Type", "Syntax", "RuntimeExpr", "Json"].includes(n ?? "");
  return valid ? [] : [`${path} must be ${n}`];
}

/** Optional fields are omitted from IR objects when the form leaves them absent. */
export function normalizeContractValue(value: KValue, t: SExpr, types: ReadonlyMap<string,SExpr>, seen = new Set<string>()): KValue {
  t=resolveTypeAlias(t,types);
  const n = name(t);
  if (optional(t) && t._tag === "List") {
    if (value === null || value instanceof Map && value.get(":_tag") === "None") return null;
    const inner = value instanceof Map && value.get(":_tag") === "Some" ? value.get(":value") : value;
    return normalizeContractValue(inner!, t.items[1]!, types, seen);
  }
  if (t._tag === "Map" && value instanceof Map) {
    const result = new Map(value);
    for (const [k,type] of t.pairs) {
      const key = contractKey(k);
      const item = value.get(key);
      if (item !== undefined) {
        const normalized = normalizeContractValue(item, type, types, seen);
        if (optionalType(type,types) && (item === null || item instanceof Map && item.get(":_tag") === "None")) result.delete(key);
        else result.set(key, normalized);
      }
    }
    return result;
  }
  if (head(t) === "Union" && t._tag === "List") {
    const member = t.items.slice(1).find(member => contractErrors(value, member, types).length === 0);
    if (member) return normalizeContractValue(value, member, types, seen);
  }
  if (head(t) === "List" && t._tag === "List" && Array.isArray(value)) return value.map(v=>normalizeContractValue(v,t.items[1]!,types,seen));
  return value;
}

/** Convert typed atoms to their wire spelling only at the artifact boundary. */
export function projectContractValue(value: KValue, t: SExpr, types: ReadonlyMap<string,SExpr>): KValue {
  t=resolveTypeAlias(t,types);
  const n = name(t);
  if (n === "RuntimeExpr" && value!==null) return new Map([[":kind","raw-expr"],[":expr",projectRuntimeExpression(value)]]);
  if (n === "Keyword" || n?.startsWith(":")) return isKKeyword(value) ? value.name.slice(1) : value;
  if (optional(t) && t._tag === "List") return value === null ? value : projectContractValue(value,t.items[1]!,types);
  if (t._tag === "Map" && value instanceof Map) {
    return new Map([...value].map(([key,item])=>{
      const type=t.pairs.find(([k])=>contractKey(k) === key)?.[1];
      return [key,type ? projectContractValue(item,type,types) : item];
    }));
  }
  if (t._tag === "List") {
    if (head(t) === "List" && Array.isArray(value)) return value.map(v=>projectContractValue(v,t.items[1]!,types));
    if ((head(t) === "Map" || head(t) === "Record") && value instanceof Map) return new Map([...value].map(([k,v])=>[k,projectContractValue(v,t.items.at(-1)!,types)]));
    if (head(t) === "Brand") return projectContractValue(value,t.items.at(-1)!,types);
    if (head(t) === "Union") { const member=t.items.slice(1).find(a=>contractErrors(value,a,types).length===0); if (member) return projectContractValue(value,member,types); }
  }
  return value;
}

function projectRuntimeExpression(value: KValue): KValue {
  if (typeof value === "string") return new Map([["$forma.runtimeExpr","string-literal"],["value",value]]);
  if (isKSymbol(value) || isKKeyword(value)) return value.name;
  if (Array.isArray(value)) return value.map(projectRuntimeExpression);
  if (value instanceof Map) return new Map([...value].map(([k,v])=>[k,projectRuntimeExpression(v)]));
  return value;
}

function contractKey(key: SExpr): string {
  if (key._tag === "Str") return mapKey(key.value)!;
  if (key._tag === "Sym" && key.name.startsWith(":")) return key.name;
  throw new Error("Record type labels must be keywords or strings");
}

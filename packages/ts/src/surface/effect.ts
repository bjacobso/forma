import { lowerMembers, moduleBindings, patternBindings } from "./members.js";
/** The unified authoring surface lowers to the portable mechanics IR grammar.
 * Child nodes retain their author locations; quoted data is never rewritten.
 */
import { normalizeCoreProgram } from "./core.js";
import type { SExpr } from "../reader/types.js";

export const head = (e: SExpr | undefined): string | undefined => e?._tag === "List" ? name(e.items[0]) : undefined;
export const name = (e: SExpr | undefined): string | undefined => e?._tag === "Sym" ? e.name : undefined;
export const sym = (e: SExpr, n: string): SExpr => ({ _tag: "Sym", name: n, loc: e.loc });
export const list = (e: SExpr, items: readonly SExpr[]): SExpr => ({ _tag: "List", items, loc: e.loc });
export const vector = (e: SExpr, items: readonly SExpr[]): SExpr => ({ _tag: "Vector", items, loc: e.loc });
const call = (e: SExpr, n: string, ...args: SExpr[]): SExpr => list(e, [sym(e, n), ...args]);
const literal = (e: SExpr): boolean => e._tag === "Str" || e._tag === "Num" || e._tag === "Bool" || name(e)?.startsWith(":") === true;
const effectResult = (e: SExpr | undefined): SExpr | undefined => head(e) === "Effect" ? e : e?._tag === "List" && head(e) === "->" && head(e.items.at(-1)) === "Effect" ? e.items.at(-1) : undefined;

/** Whether this declaration represents an effect value rather than a thunk. */
export const serviceValues = new WeakSet<SExpr>();

export function normalizeEffectTypes(e: SExpr, schema = false, brandName?: SExpr): SExpr {
  if (e._tag === "Map") {
    return call(e, "Struct", ...e.pairs.map(([k, t]) => call(t, "field", k, normalizeEffectTypes(t, true))));
  }
  if (literal(e)) return call(e, "Literal", name(e)?.startsWith(":") ? { _tag: "Str", value: name(e)!.slice(1), loc: e.loc } : e);
  if (e._tag !== "List") return e;
  const h = head(e);
  if (h === "Literal" || h === "Enum") return e;
  let args = e.items.slice(1);
  if (h === "Brand" && args.length === 1 && brandName) args = [brandName, ...args];
  if (h === "Tagged") {
    let tag = sym(e, "_tag");
    if (name(args[0]) === ":tag" && args[1]) {
      tag = args[1];
      args = args.slice(2);
    }
    return call(e, "TaggedUnion", tag, ...args.map(arm => {
      const ctor = arm._tag === "List" ? arm.items[0]! : arm;
      const payload = arm._tag === "List" ? arm.items[1] : undefined;
      const body = payload ? (payload._tag === "Map" ? normalizeEffectTypes(payload, true) : call(payload, "Struct", call(payload, "field", sym(payload, "value"), normalizeEffectTypes(payload, true)))) : call(arm, "Struct");
      return vector(arm, [ctor, body]);
    }));
  }
  if (h === "Union" && args.every(literal)) return call(e, "Literal", ...args.map(a => name(a)?.startsWith(":") ? { _tag: "Str" as const, value: name(a)!.slice(1), loc: a.loc } : a));
  if (h === "Map" && args.length === 2 && !name(args[1])?.startsWith(":")) {
    // Preserve the key schema in the portable projection (validated there).
    return call(e, "Map", normalizeEffectTypes(args[1]!, schema), sym(args[0]!, ":key"), normalizeEffectTypes(args[0]!, true));
  }
  if (h === "Effect" || h === "Stream" || h === "Fiber" || h === "Layer") {
    const required = h === "Fiber" ? 2 : 3;
    const result = args.map((a, i) => i === 0 && h !== "Layer" ? normalizeEffectTypes(a) : a);
    while (result.length > 0 && result.length < required) result.push(vector(e, []));
    return call(e, h, ...result);
  }
  if (h === "->") return call(e, h, ...args.map(a => normalizeEffectTypes(a)));
  if (h === "Struct" || h === ":fields") return call(e, h, ...args.map(f => {
    if (f._tag === "List" && head(f) === "field") return list(f, [...f.items.slice(0, 2), ...f.items.slice(2).map(t => normalizeEffectTypes(t, true))]);
    if (f._tag === "Vector") return vector(f, [f.items[0]!, ...f.items.slice(1).map(t => normalizeEffectTypes(t, true))]);
    return f;
  }));
  const normalizedHead = h === "List" ? "Array" : schema && h === "Option" ? "Optional" : h;
  if (!normalizedHead) return e;
  // Metadata values are data, not types.
  const metadataAt = args.findIndex(a => name(a)?.startsWith(":") === true);
  const types = metadataAt < 0 ? args : args.slice(0, metadataAt);
  const metadata = metadataAt < 0 ? [] : args.slice(metadataAt);
  const normalized = types.map((a, i) => h === "Brand" && i === 0 ? a : normalizeEffectTypes(a, schema));
  return call(e, normalizedHead, ...normalized, ...metadata);
}

function body(e: SExpr, protectedNames: ReadonlySet<string> = new Set()): SExpr {
  if (e._tag === "Sym") {
    const n = e.name;
    const aliases: Record<string, string> = { Some: "some", None: "none", Ok: "success", Err: "failure", "Option.Some": "some", "Option.None": "none", "Result.Ok": "success", "Result.Err": "failure" };
    if (aliases[n] && !protectedNames.has(n)) return sym(e, aliases[n]!);
    return e;
  }
  if (e._tag === "Map") return { ...e, pairs: e.pairs.map(([k, v]) => [k, body(v,protectedNames)] as const) };
  if (e._tag === "Vector") return { ...e, items: e.items.map(v=>body(v,protectedNames)) };
  if (e._tag !== "List" || head(e) === "quote" || head(e) === "quasiquote") return e;
  if (head(e) === ":" && e.items.length === 3) return call(e, ":", body(e.items[1]!,protectedNames), normalizeEffectTypes(e.items[2]!));
  if (head(e) === "match") return list(e,e.items.map((a,i)=>i>=2 && i%2===0 ? a : body(a,protectedNames)));
  if (head(e) === "catch") return list(e, e.items.map((a, i) => i >= 2 && i % 2 === 0 && a._tag === "Sym" && /^[a-z_]/.test(a.name) ? call(a, "_", a) : body(a,protectedNames)));
  return { ...e, items: e.items.map(v=>body(v,protectedNames)) };
}

interface Constructor { readonly tag: SExpr; readonly payload?: SExpr; }
function lowerConstructors(e: SExpr, constructors: ReadonlyMap<string, Constructor>): SExpr {
  if (head(e) === "quote" || head(e) === "quasiquote" || head(e) === ":") return e;
  const constructor = constructors.get(e._tag === "Sym" ? e.name : head(e) ?? "");
  if (constructor && (e._tag === "Sym" && !constructor.payload || e._tag === "List")) {
    const arg = e._tag === "List" ? e.items[1] : undefined;
    const tagName = name(constructor.tag) ?? "_tag";
    const tag: SExpr = { _tag: "Str", value: e._tag === "Sym" ? e.name : head(e)!, loc: e.loc };
    const fields = arg?._tag === "Map" ? arg.pairs.map(([k,v]) => [k,lowerConstructors(v,constructors)] as const) : arg ? [[sym(arg,":value"),lowerConstructors(arg,constructors)] as const] : [];
    return { _tag: "Map", pairs: [[sym(e,`:${tagName.replace(/^:/, "")}`),tag], ...fields], loc: e.loc };
  }
  if (e._tag === "List" && head(e) === "match") {
    const items: SExpr[] = [e.items[0]!, lowerConstructors(e.items[1]!, constructors)];
    for (let i=2;i<e.items.length;i+=2) {
      const p = e.items[i]!;
      let result = lowerConstructors(e.items[i+1]!,constructors);
      const ctor = constructors.get(p._tag === "Sym" ? p.name : head(p) ?? "");
      if (ctor && p._tag === "List" && p.items[1]?._tag === "Map") {
        const temp = sym(p,`__pattern_${p.loc.start}`);
        const bindings = p.items[1].pairs.flatMap(([k,v]) => [v,call(v,"get",temp,k)]);
        result = call(result,"let",vector(p,bindings),result);
        items.push(list(p,[p.items[0]!,temp]),result);
      } else if (ctor && p._tag === "Sym") items.push(p,result);
      else if (p._tag === "Sym" && /^[a-z_]/.test(p.name) && p.name !== "_" && !["none","some","success","failure"].includes(p.name)) items.push(call(p,"_",p),result);
      else items.push(p,result);
    }
    return list(e,items);
  }
  if (e._tag === "List") return list(e,e.items.map(a=>lowerConstructors(a,constructors)));
  if (e._tag === "Vector") return vector(e,e.items.map(a=>lowerConstructors(a,constructors)));
  if (e._tag === "Map") return {...e,pairs:e.pairs.map(([k,v])=>[k,lowerConstructors(v,constructors)] as const)};
  return e;
}

export function normalizeEffectProgram(exprs: readonly SExpr[], validate = true): readonly SExpr[] {
  if (validate) normalizeCoreProgram(exprs);
  const signatures = new Map<string, SExpr>();
  for (const e of exprs) if (head(e) === ":" && e._tag === "List" && name(e.items[1])) signatures.set(name(e.items[1])!, e.items[2]!);
  const constructors = new Map<string, Constructor>();
  for (const e of exprs) if (head(e) === "type" && e._tag === "List" && head(e.items[2]) === "Tagged" && e.items[2]?._tag === "List") {
    const t = e.items[2];
    const custom = name(t.items[1]) === ":tag";
    const tag = custom ? t.items[2]! : sym(t,"_tag");
    for (const arm of t.items.slice(custom ? 3 : 1)) {
      const n = arm._tag === "List" ? name(arm.items[0]) : name(arm);
      if (n) constructors.set(n, {tag,...(arm._tag === "List" && arm.items[1] ? {payload:arm.items[1]} : {})});
    }
  }
  const protectedNames = new Set(constructors.keys());
  for (const e of exprs) if (head(e)==="__schema" && e._tag === "List" && head(e.items[2])==="TaggedUnion" && e.items[2]?._tag === "List") for (const a of e.items[2].items.slice(2)) if (a._tag === "Vector" && name(a.items[0])) protectedNames.add(name(a.items[0])!);
  const normalizeBody = (e: SExpr) => body(lowerConstructors(lowerMembers(e,moduleBindings(exprs)),constructors),protectedNames);
  return exprs.map(e => {
    if (e._tag !== "List") return e;
    const [h, n, ...args] = e.items;
    switch (name(h)) {
      case "type": case "__schema":
        return n && args[0] ? call(e, "__schema", n, normalizeEffectTypes(args[0], true, n)) : e;
      case "error": case "class": case "__error": case "__class": {
        if (!n) return e;
        const hasRecord=args[0]?._tag === "Map" || head(args[0]) === "Struct" || head(args[0]) === ":fields";
        const record = hasRecord ? normalizeEffectTypes(args[0]!, true) : call(e, "Struct");
        const fields = record._tag === "List" && head(record) === "Struct" ? list(record, [sym(record, ":fields"), ...record.items.slice(1)]) : record;
        return call(e, name(h) === "error" || name(h) === "__error" ? "__error" : "__class", n, fields,...args.slice(hasRecord ? 1 : 0));
      }
      case "service": {
        if (!n) return e;
        const methods = args.map(m => {
          if (m._tag !== "List" || head(m) !== ":" || m.items.length !== 3) return m;
          const t = normalizeEffectTypes(m.items[2]!);
          const params: SExpr[] = [];
          const isFunction = head(t) === "->" && t._tag === "List";
          if (isFunction) for (const [i, p] of t.items.slice(1, -1).entries()) params.push(sym(p, `arg${i}`), p);
          const method = list(m, [m.items[1]!, vector(m, params), isFunction ? t.items.at(-1)! : t]);
          if (!isFunction) serviceValues.add(method);
          return method;
        });
        return call(e, "__service", n, call(e, ":methods", ...methods));
      }
      case "__service":
        return call(e, "__service", n!, ...args.map(a => a._tag === "List" ? list(a, a.items.map((m, i) => i === 0 || m._tag !== "List" ? m : normalizeMethod(m))) : a));
      case "layer": {
        if (!n) return e;
        if (args.length === 1) return call(e, "__layer", n, normalizeBody(args[0]!));
        const sections: SExpr[] = [];
        const definitions = args.filter(a=>head(a)==="define" && a._tag === "List") as Extract<SExpr,{_tag:"List"}>[];
        const providesAt = args.findIndex(a=>name(a)===":provides");
        const serviceName = name(args[providesAt+1]);
        const service = exprs.find(a=>head(a)==="service" && a._tag === "List" && name(a.items[1])===serviceName);
        const exported = service?._tag === "List" ? new Set(service.items.slice(2).map(a=>a._tag === "List" ? name(a.items[1]) : undefined)) : undefined;
        const helpers = definitions.filter(a=>exported && !exported.has(name(a.items[1])));
        const helperBindings = helpers.flatMap(a=>[a.items[1]!, a.items[2]?._tag === "Vector" ? call(a,"fn",a.items[2],...a.items.slice(3)) : a.items[2]!]);
        const methods = definitions.filter(a=>!helpers.includes(a)).map(a=>{
          const params = a.items[2]?._tag === "Vector" ? a.items[2] : vector(a,[]);
          const expressions = a.items.slice(params === a.items[2] ? 3 : 2);
          const wrapped = helperBindings.length ? [call(a,"let",vector(a,helperBindings),call(a,"do",...expressions))] : expressions;
          const scope = new Set([...moduleBindings(exprs),...patternBindings(params),...helpers.flatMap(a=>name(a.items[1]) ? [name(a.items[1])!] : [])]);
          return list(a,[a.items[1]!,params,...wrapped.map(v=>body(lowerConstructors(lowerMembers(v,scope),constructors),protectedNames))]);
        });
        for (let i=0;i<args.length;i++) {
          const a = args[i]!;
          if (name(a)?.startsWith(":") && args[i+1]) sections.push(list(a,[a,normalizeBody(args[++i]!)]));
          else if (head(a)!=="define") sections.push(normalizeBody(a));
        }
        sections.push(call(e,":methods",...methods));
        return call(e,"__layer",n,...sections);
      }
      case ":":
        return n && args[0] ? call(e, ":", n, normalizeEffectTypes(args[0])) : e;
      case "define": {
        if (!n || !args[0]) return e;
        const sig = signatures.get(name(n) ?? "");
        if (effectResult(sig)) {
          const params = args[0]._tag === "Vector" && args.length > 1 ? args[0] : vector(e, []);
          const fn = head(args[0]) === "fn" && args[0]._tag === "List" ? args[0] : undefined;
          const result = call(e, "__operation", n, fn ? fn.items[1]! : params, ...((fn ? fn.items.slice(2) : params === args[0] ? args.slice(1) : args).map(a => body(lowerConstructors(lowerMembers(a,new Set([...moduleBindings(exprs),...patternBindings(fn ? fn.items[1] : params)])),constructors),protectedNames))));
          return result;
        }
        return args[0]._tag === "Vector" && args.length > 1 ? call(e, "define", n, call(e, "fn", args[0], ...args.slice(1).map(a=>body(lowerConstructors(lowerMembers(a,new Set([...moduleBindings(exprs),...patternBindings(args[0])])),constructors),protectedNames)))) : call(e, "define", n, ...args.map(normalizeBody));
      }
      default: return normalizeBody(e);
    }
  });
}

function normalizeMethod(m: Extract<SExpr, { _tag: "List" }>): SExpr {
  const result = list(m, [m.items[0]!, m.items[1]!, normalizeEffectTypes(m.items[2]!)]);
  if (serviceValues.has(m)) serviceValues.add(result);
  return result;
}

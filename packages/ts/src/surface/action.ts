import type { SExpr } from "../reader/types.js";
import { patternBindings } from "./members.js";
import { head, name, sym, list, vector } from "./effect.js";

interface ActionSignature { readonly inputs: readonly SExpr[]; readonly result: SExpr }

/** Signatures identify ontology operations; definitions retain authored syntax in IR. */
export function lowerActionProgram(expressions: readonly SExpr[], knownActions: ReadonlySet<string> = new Set()): readonly SExpr[] {
  const signatures = new Map<string, ActionSignature>();
  const entityFields = new Map<string, Extract<SExpr, {_tag: "Map"}>>();
  for (const e of expressions) {
    if (e._tag !== "List") continue;
    if (head(e) === "entity" && name(e.items[1]) && e.items[2]?._tag === "Map") entityFields.set(name(e.items[1])!, e.items[2]);
    if (head(e) !== ":" || !name(e.items[1])) continue;
    const signature = e.items[2];
    const parts = head(signature) === "->" && signature?._tag === "List" ? signature.items.slice(1) : signature ? [signature] : [];
    const result = parts.at(-1);
    if (head(result) === "Action" && result?._tag === "List" && result.items.length === 2) {
      const n = name(e.items[1])!;
      if (signatures.has(n)) throw new Error(`Duplicate Action signature ${n}`);
      signatures.set(n, {inputs: parts.slice(0, -1), result: result.items[1]!});
    }
  }
  for (const n of signatures.keys()) {
    const definitions = expressions.filter(e => head(e) === "define" && e._tag === "List" && name(e.items[1]) === n);
    if (definitions.length !== 1) throw new Error(`Action ${n} requires exactly one definition`);
  }
  return expressions.map(e => {
    if (e._tag !== "List") return e;
    if (head(e) === ":" && signatures.has(name(e.items[1]) ?? "")) return list(e, [sym(e, "do")]);
    if (head(e) !== "define") return e;
    const signature = signatures.get(name(e.items[1]) ?? "");
    if (!signature) return e;
    const fn = e.items[2];
    const params = fn?._tag === "Vector" ? fn.items : head(fn) === "fn" && fn?._tag === "List" && fn.items[1]?._tag === "Vector" ? fn.items[1].items : [];
    const bodies = fn?._tag === "Vector" ? e.items.slice(3) : head(fn) === "fn" && fn?._tag === "List" ? fn.items.slice(2) : e.items.slice(2);
    if (params.length !== signature.inputs.length || params.some(p => p._tag !== "Sym" || !/^[a-z]/.test(p.name)) || new Set(params.map(name)).size !== params.length) throw new Error(`Action ${name(e.items[1])} parameters must match its signature`);
    if (!bodies.length) throw new Error(`Action ${name(e.items[1])} requires a body`);
    const body = bodies.length === 1 ? bodies[0]! : list(e, [sym(e, "do"), ...bodies]);
    const entities = new Map<string, SExpr>(), relations = new Map<string, SExpr>(), documents = new Map<string, SExpr>(), calls = new Map<string, SExpr>();
    const ownerOf = (t: SExpr | undefined): string | undefined => head(t) === "Id" && t?._tag === "List" ? name(t.items[1]) : undefined;
    const valueType = (v: SExpr, locals: ReadonlyMap<string, SExpr>): SExpr | undefined => {
      if (v._tag === "Sym") {
        const direct = locals.get(v.name);
        if (direct) return direct;
        const dot = v.name.lastIndexOf(".");
        if (dot > 0) {
          const base = locals.get(v.name.slice(0, dot)), field = v.name.slice(dot + 1), entity = base ? name(base) : undefined;
          if (entity && entityFields.has(entity)) return field === "id" ? list(v, [sym(v, "Id"), base!]) : entityFields.get(entity)!.pairs.find(([k]) => name(k) === `:${field}`)?.[1];
          if (base?._tag === "Map") return base.pairs.find(([k]) => name(k) === `:${field}`)?.[1];
        }
      }
      if (v._tag === "List") {
        if (head(v) === "create!" && v.items[1]) return list(v, [sym(v, "Id"), v.items[1]]);
        if (head(v) === ":") return v.items[2];
        const result = signatures.get(head(v) ?? "")?.result;
        if (result) return result;
        if (head(v) === "get" && v.items[1] && v.items[2]) {
          const t = valueType(v.items[1], locals), field = name(v.items[2])?.replace(/^:/, ""), entity = t ? name(t) : undefined;
          if (entity && entityFields.has(entity) && field === "id") return list(v, [sym(v, "Id"), t!]);
        }
      }
      return undefined;
    };
    const check = (value: SExpr, locals: ReadonlyMap<string, SExpr>, project: boolean): SExpr => {
      const recur = (v: SExpr) => check(v, locals, project);
      if (value._tag === "Map") return {...value, pairs: value.pairs.map(([k, v]) => [k, recur(v)] as const)};
      if (value._tag === "Vector") return vector(value, value.items.map(recur));
      if (value._tag !== "List" || ["quote", "quasiquote"].includes(head(value) ?? "")) return value;
      const operation = head(value);
      if (operation && (signatures.has(operation) || knownActions.has(operation))) calls.set(operation, value.items[0]!);
      if (["do!", "let"].includes(operation ?? "")) {
        const bindings = value.items[1];
        if (bindings?._tag !== "Vector" || bindings.items.length % 2) throw new Error(`${operation} requires binding/value pairs`);
        const scope = new Map(locals);
        const sequence = (items: readonly SExpr[]): SExpr[] => {
          const out: SExpr[] = [];
          for (let i = 0; i < items.length; i += 2) {
            const binding = items[i]!, expression = items[i + 1]!;
            if (operation === "do!" && name(binding) === ":let") {
              if (expression._tag !== "Vector" || expression.items.length % 2) throw new Error(":let requires binding/value pairs");
              out.push(binding, vector(expression, sequence(expression.items)));
            } else {
              const t = valueType(expression, scope);
              out.push(binding, check(expression, scope, project));
              for (const n of patternBindings(binding)) scope.delete(n);
              const n = name(binding);
              if (n && t) scope.set(n, t);
            }
          }
          return out;
        };
        return list(value, [value.items[0]!, vector(bindings, sequence(bindings.items)), ...value.items.slice(2).map(v => check(v, scope, project))]);
      }
      if (operation === "match" && value.items[1]) {
        const bindings = (p: SExpr): string[] => p._tag === "Sym" ? /^[a-z]/.test(p.name) ? [p.name] : [] : p._tag === "Map" ? p.pairs.flatMap(([, v]) => bindings(v)) : p._tag === "List" || p._tag === "Vector" ? p.items.flatMap(bindings) : [];
        const arms: SExpr[] = [];
        for (let i = 2; i < value.items.length; i += 2) {
          const pattern = value.items[i]!, body = value.items[i + 1];
          if (!body) throw new Error("match requires pattern/body pairs");
          const scope = new Map(locals);
          for (const n of bindings(pattern)) scope.delete(n);
          arms.push(pattern, check(body, scope, project));
        }
        return list(value, [value.items[0]!, recur(value.items[1]), ...arms]);
      }
      if (operation === "fn" && value.items[1]?._tag === "Vector") {
        const scope = new Map(locals);
        for (const n of patternBindings(value.items[1])) scope.delete(n);
        return list(value, [value.items[0]!, value.items[1], ...value.items.slice(2).map(v => check(v, scope, project))]);
      }
      if (operation === "link!") {
        const relation = value.items[1];
        if (relation?._tag !== "Sym" || value.items.length !== 5) throw new Error("link! requires a relation, source id, target id and field record");
        relations.set(relation.name, relation);
        return project ? list(value, [sym(value, `__action.link/${relation.name}`), ...value.items.slice(2).map(recur)]) : list(value, [value.items[0]!, relation, ...value.items.slice(2).map(recur)]);
      }
      if (operation === "instantiate!") {
        const document = value.items[1], entity = value.items[2];
        if (document?._tag !== "Sym" || entity?._tag !== "Sym" || value.items.length !== 4) throw new Error("instantiate! requires a document, entity and id");
        documents.set(document.name, document); entities.set(entity.name, entity);
        return project ? list(value, [sym(value, `__action.instantiate/${entity.name}`), list(document, [sym(document, "quote"), document]), recur(value.items[3]!)]) : list(value, [value.items[0]!, document, entity, recur(value.items[3]!)]);
      }
      if (operation === "task!") {
        const entity = value.items[1];
        if (entity?._tag !== "Sym" || value.items.length !== 3) throw new Error("task! requires an entity and a task record");
        entities.set(entity.name, entity);
        return list(value, [project ? sym(value, `__action.task/${entity.name}`) : value.items[0]!, ...(project ? [] : [entity]), recur(value.items[2]!)]);
      }
      if (["create!", "update!", "retract!"].includes(operation ?? "")) {
        let entity = value.items[1], args = value.items.slice(2);
        const implicit = operation === "update!" && value.items.length === 3 || operation === "retract!" && value.items.length === 2;
        if (implicit && entity) {
          const owner = ownerOf(valueType(entity, locals));
          if (!owner) throw new Error(`${operation} requires an Id with a known entity type`);
          args = value.items.slice(1); entity = sym(entity, owner);
        }
        if (entity?._tag !== "Sym" || entity.name.startsWith(":")) throw new Error(`${operation} requires an entity symbol`);
        if (args.length !== (operation === "update!" ? 2 : 1)) throw new Error(`${operation} has invalid arguments`);
        entities.set(entity.name, entity);
        return list(value, [project ? sym(value, `__action.${operation!.slice(0, -1)}/${entity.name}`) : value.items[0]!, ...(project ? [] : [entity]), ...args.map(recur)]);
      }
      return list(value, value.items.map(recur));
    };
    const locals = new Map(params.map((p, i) => [name(p)!, signature.inputs[i]!]));
    const normalized = check(body, locals, false);
    const checked = list(body, [sym(body, "do!"), vector(body, []), check(normalized, locals, true)]);
    const effect = list(e, [sym(e, "Effect"), signature.result, vector(e, []), vector(e, [sym(e, "OntologyRuntime")])]);
    const fields: SExpr = {_tag: "Map", loc: e.loc, pairs: params.map((p, i) => [sym(p, `:${name(p)}`), signature.inputs[i]!] as const)};
    return list(e, [sym(e, "__action"), e.items[1]!, fields, signature.result, effect, normalized, checked, vector(e, [...entities.values()]), vector(e, [...relations.values()]), vector(e, [...documents.values()]), vector(e, [...calls.values()])]);
  });
}

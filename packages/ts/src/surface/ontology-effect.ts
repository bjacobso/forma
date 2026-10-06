import { stripTypeMetadata } from "./domain.js";
import type { SExpr } from "../reader/types.js";
import { head, name, list, sym, vector } from "./effect.js";
import { lowerActionProgram } from "./action.js";

const call = (e: SExpr, op: string, ...args: SExpr[]): SExpr => list(e, [sym(e, op), ...args]);
const record = (e: SExpr, pairs: readonly (readonly [SExpr, SExpr])[]): SExpr => ({ _tag: "Map", loc: e.loc, pairs });
const text = (e: SExpr, value: string): SExpr => ({ _tag: "Str", loc: e.loc, value });

/** Project ontology operations onto the same service-call IR as every other Effect.
 * The service interface is derived from entity and relation declarations, so its
 * write methods retain their field types and ids retain their nominal identity.
 */
export function lowerOntologyOperations(expressions: readonly SExpr[]): readonly SExpr[] {
  const actions = lowerActionProgram(expressions);
  if (!actions.some(e => head(e) === "__action")) return expressions;
  const normalizedBodies = new Map(actions.flatMap(e => head(e) === "__action" && e._tag === "List" ? [[name(e.items[1])!, e.items[5]!] as const] : []));
  const entities = new Map<string, Extract<SExpr, { _tag: "Map" }>>();
  const relations = new Map<string, { source: SExpr; target: SExpr; fields: Extract<SExpr, { _tag: "Map" }> }>();
  const occupied = new Set(expressions.flatMap(e => e._tag === "List" && name(e.items[1]) ? [name(e.items[1])!] : []));
  const generated: SExpr[] = [];
  const methods = new Map<string, SExpr>();
  const anchor = actions.find(e => head(e) === "__action")!;
  if (occupied.has("OntologyRuntime")) throw new Error("OntologyRuntime is the service derived from ontology operations and cannot be redeclared");
  const claim = (n: string) => {
    if (occupied.has(n)) throw new Error(`Ontology operation type ${n} conflicts with an existing declaration`);
    occupied.add(n);
  };
  const idName = (n: string) => `${n}.Id`;
  const type = (e: SExpr): SExpr => {
    if (head(e) === "Id" && e._tag === "List") {
      const n = name(e.items[1]);
      if (!n || e.items.length !== 2 || !entities.has(n)) throw new Error("Id requires a declared entity");
      return sym(e, idName(n));
    }
    if (["quote", "quasiquote"].includes(head(e) ?? "")) return e;
    if (e._tag === "Map") return record(e, e.pairs.map(([k, v]) => [k, type(v)] as const));
    if (e._tag === "Vector") return vector(e, e.items.map(type));
    if (e._tag === "List") return list(e, e.items.map(type));
    return e;
  };
  for (const e of expressions) {
    if (e._tag !== "List") continue;
    if (head(e) === "entity") {
      const n = name(e.items[1]), fields = e.items[2];
      if (!n || fields?._tag !== "Map") throw new Error("entity requires a name and a field type record");
      if (entities.has(n)) throw new Error(`Duplicate entity ${n}`);
      entities.set(n, fields);
    } else if (head(e) === "relation") {
      const n = name(e.items[1]), source = e.items[2], target = e.items[3], fields = e.items[4];
      if (!n || !source || !target || fields?._tag !== "Map") throw new Error("relation requires a name, source entity, target entity and field type record");
      relations.set(n, { source, target, fields });
    }
  }
  // Metadata does not change the value type.
  const base = stripTypeMetadata;
  const row = (fields: Extract<SExpr, { _tag: "Map" }>, optional = false): SExpr => record(fields, fields.pairs.map(([k, t]) => {
    const b = base(t);
    return [k, type(optional && head(b) !== "Option" ? call(t, "Option", b) : b)] as const;
  }));
  for (const [n, fields] of entities) {
    claim(idName(n));
    generated.push(call(fields, "type", sym(fields, idName(n)), call(fields, "Brand", sym(fields, "String"))));
    if (fields.pairs.some(([k]) => name(k) === ":id")) throw new Error(`Entity ${n} reserves the id field`);
    generated.push(call(fields, "type", sym(fields, n), record(fields, [[sym(fields, ":id"), sym(fields, idName(n))], ...(row(fields) as Extract<SExpr, { _tag: "Map" }>).pairs])));
  }
  const effect = (e: SExpr, result: SExpr, requirement = false) => call(e, "Effect", result, vector(e, []), vector(e, requirement ? [sym(e, "OntologyRuntime")] : []));
  const method = (e: SExpr, n: string, params: readonly SExpr[], result: SExpr) => {
    if (!methods.has(n)) methods.set(n, call(e, ":", sym(e, n), call(e, "->", ...params, effect(e, result))));
    return `OntologyRuntime.${n}`;
  };
  const body = (e: SExpr): SExpr => {
    if (e._tag === "Map") return record(e, e.pairs.map(([k, v]) => [k, body(v)] as const));
    if (e._tag === "Vector") return vector(e, e.items.map(body));
    if (e._tag !== "List" || ["quote", "quasiquote"].includes(head(e) ?? "")) return e;
    const op = head(e);
    if (["create!", "update!", "retract!", "task!", "instantiate!"].includes(op ?? "")) {
      const owner = name(e.items[op === "instantiate!" ? 2 : 1]), fields = entities.get(owner ?? "");
      if (!owner || !fields) throw new Error(`${op} requires a declared entity`);
      const id = sym(e, idName(owner));
      let params: readonly SExpr[], result: SExpr;
      switch (op) {
        case "create!": params = [row(fields)]; result = id; break;
        case "update!": params = [id, row(fields, true)]; result = sym(e, "Unit"); break;
        case "retract!": params = [id]; result = sym(e, "Unit"); break;
        case "instantiate!": params = [sym(e, "String"), id]; result = sym(e, "String"); break;
        default: params = [record(e, [
          [sym(e, ":title"), sym(e, "String")], [sym(e, ":type"), sym(e, "String")],
          [sym(e, ":priority"), sym(e, "String")], [sym(e, ":entity-id"), id],
          ...["entity-type", "document-ref", "document-instance-ref", "assignee-role"].map(k => [sym(e, `:${k}`), sym(e, "String")] as const),
          [sym(e, ":section-refs"), call(e, "List", sym(e, "String"))],
        ])]; result = sym(e, "String");
      }
      const callee = method(e, `${op!.slice(0, -1)}/${owner}`, params, result);
      const args = op === "instantiate!" ? [text(e.items[1]!, name(e.items[1])!), body(e.items[3]!)] : e.items.slice(2).map(body);
      return call(e, callee, ...args);
    }
    if (op === "link!") {
      const n = name(e.items[1]), relation = relations.get(n ?? "");
      if (!n || !relation) throw new Error("link! requires a declared relation");
      const params = [type(call(e, "Id", relation.source)), type(call(e, "Id", relation.target)), row(relation.fields)];
      return call(e, method(e, `link/${n}`, params, sym(e, "Unit")), ...e.items.slice(2).map(body));
    }
    if (op === "emit!") return call(e, method(e, "emit", [sym(e, "String")], sym(e, "Unit")), ...e.items.slice(1).map(body));
    return list(e, e.items.map(body));
  };
  const projected = expressions.flatMap((e): SExpr[] => {
    if (["entity", "relation"].includes(head(e) ?? "")) return [];
    if (e._tag !== "List") return [e];
    const signature = head(e) === ":" ? e.items[2] : undefined;
    const result = head(signature) === "->" && signature?._tag === "List" ? signature.items.at(-1) : signature;
    if (head(result) === "Action" && result?._tag === "List") {
      const returns = effect(result, type(result.items[1]!), true);
      const t = head(signature) === "->" && signature?._tag === "List" ? call(signature, "->", ...signature.items.slice(1, -1).map(type), returns) : returns;
      return [call(e, ":", e.items[1]!, t)];
    }
    if (head(e) === "define" && normalizedBodies.has(name(e.items[1]) ?? "")) {
      const fn = e.items[2], b = normalizedBodies.get(name(e.items[1])!)!;
      const params = fn?._tag === "Vector" ? fn : fn?._tag === "List" && head(fn) === "fn" ? fn.items[1] : undefined;
      return [body(call(e, "define", e.items[1]!, params ?? vector(e, []), b))];
    }
    return [head(e) === "define" ? body(e) : type(e)];
  });
  generated.push(call(anchor, "service", sym(anchor, "OntologyRuntime"), ...methods.values()));
  return [...generated, ...projected];
}

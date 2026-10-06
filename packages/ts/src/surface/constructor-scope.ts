import type { SExpr } from "../reader/types.js";
import { copySourceTrace } from "../evaluator/source-trace.js";
import { head, name, sym } from "./effect.js";

type Bindings = ReadonlyMap<string, SExpr | undefined>;

/** Resolve a constructor before inference and execution so both see the same choice. */
export function resolveConstructors(program: readonly SExpr[]): readonly SExpr[] {
  const owners = new Map<string, Set<string>>();
  const payloads = new Map<string, readonly SExpr[]>();
  const aliases = new Map<string, SExpr>();
  const signatures = new Map<string, SExpr>();
  const globals = new Map<string, SExpr | undefined>();
  for (const expr of program) {
    if (expr._tag !== "List") continue;
    if (head(expr) === "__sum-type" && expr.items[1]?._tag === "List") {
      const owner = name(expr.items[1].items[0])!;
      for (const arm of expr.items.slice(2)) {
        const constructor = head(arm);
        if (!constructor || constructor.startsWith(":")) continue;
        const candidates = owners.get(constructor) ?? new Set<string>();
        candidates.add(owner);
        owners.set(constructor, candidates);
        if (arm._tag === "List") payloads.set(`${owner}.${constructor}`, arm.items.slice(1));
      }
    }
    if (head(expr) === "__sum-type" && expr.items[1]?._tag === "Sym" && expr.items[2]) aliases.set(expr.items[1].name, expr.items[2]);
    if (head(expr) === ":" && name(expr.items[1]) && expr.items[2]) signatures.set(name(expr.items[1])!, expr.items[2]);
    if (head(expr) === "define" && name(expr.items[1])) globals.set(name(expr.items[1])!, undefined);
  }
  for (const [n, type] of signatures) globals.set(n, type);
  const standard = new Map([["Some", "Option"], ["None", "Option"], ["Ok", "Result"], ["Err", "Result"]]);
  const ownerOfType = (type?: SExpr): string | undefined => type?._tag === "List"
    ? head(type) === "Effect" ? ownerOfType(type.items[1]) : head(type) : name(type);
  const resultOfType = (type?: SExpr): SExpr | undefined => type?._tag === "List" && head(type) === "->" ? type.items.at(-1) : type;
  const typeOf = (expr: SExpr, bindings: Bindings): SExpr | undefined => {
    const n = name(expr), callee = head(expr);
    if (n && bindings.has(n)) return bindings.get(n);
    if (n && n.includes(".")) return sym(expr, n.slice(0, n.lastIndexOf(".")));
    if (callee && payloads.has(callee)) return sym(expr, callee.slice(0, callee.lastIndexOf(".")));
    if (callee && bindings.has(callee)) return resultOfType(bindings.get(callee));
    const constructor = n ?? callee;
    const candidates = constructor ? owners.get(constructor) : undefined;
    const owner = candidates?.size === 1 ? [...candidates][0] : constructor ? standard.get(constructor) : undefined;
    return owner ? sym(expr, owner) : undefined;
  };
  const qualify = (expr: SExpr, expected?: SExpr, bindings: Bindings = globals): SExpr => {
    const n = name(expr);
    if (!n || n.includes(".") || bindings.has(n)) return expr;
    const candidates = owners.get(n);
    const expectedOwner = ownerOfType(expected);
    let owner = expectedOwner && (candidates?.has(expectedOwner) || standard.get(n) === expectedOwner) ? expectedOwner : undefined;
    if (!owner && candidates?.size === 1) owner = [...candidates][0];
    if (!owner && candidates && candidates.size > 1) throw Object.assign(new Error(`Ambiguous constructor ${n}; use Type.${n} or provide an expected type`), {loc:expr.loc});
    return owner ? copySourceTrace(expr, sym(expr, `${owner}.${n}`)) : expr;
  };
  const rebuild = (expr: SExpr, items: readonly SExpr[]): SExpr => expr._tag === "List" && items.every((item, i) => item === expr.items[i]) ? expr : copySourceTrace(expr, {...expr, _tag: "List", items} as SExpr);
  const pattern = (expr: SExpr, expected?: SExpr): SExpr => {
    if (expr._tag === "Sym") return qualify(expr, expected, new Map());
    if (expr._tag === "List") {
      const constructor = qualify(expr.items[0]!, expected, new Map());
      const fields = payloads.get(name(constructor) ?? "") ?? [];
      return rebuild(expr, [constructor, ...expr.items.slice(1).map((item, i) => pattern(item, fields[i]))]);
    }
    return expr;
  };
  const fieldName = (e: SExpr): string | undefined => e._tag === "Str" ? JSON.stringify(e.value) : name(e);
  const resolveAlias = (type?: SExpr, seen = new Set<string>()): SExpr | undefined => {
    const n = name(type);
    return n && aliases.has(n) && !seen.has(n) ? resolveAlias(aliases.get(n), new Set([...seen, n])) : type;
  };
  const visit = (expr: SExpr, expected: SExpr | undefined, bindings: Bindings): SExpr => {
    if (expr._tag === "Sym") return qualify(expr, expected, bindings);
    if (expr._tag === "Map") {
      const type = resolveAlias(expected);
      const pairs = expr.pairs.map(([key, value]) => [key, visit(value, type?._tag === "Map" ? type.pairs.find(([k]) => fieldName(k) === fieldName(key))?.[1] : undefined, bindings)] as const);
      return pairs.every(([,v], i) => v === expr.pairs[i]![1]) ? expr : copySourceTrace(expr, {...expr, pairs});
    }
    if (expr._tag === "Vector") {
      const type = resolveAlias(expected);
      const itemType = type?._tag === "List" && head(type) === "List" ? type.items[1] : undefined;
      const items = expr.items.map(item => visit(item, itemType, bindings));
      return items.every((v,i) => v === expr.items[i]) ? expr : copySourceTrace(expr, {...expr, items});
    }
    if (expr._tag !== "List" || ["quote", "quasiquote", "__sum-type", "__schema"].includes(head(expr) ?? "")) return expr;
    const h = head(expr);
    if (h === ":" && expr.items.length === 3) return rebuild(expr, [expr.items[0]!, name(expr.items[1]) && bindings.has(name(expr.items[1])!) ? expr.items[1]! : visit(expr.items[1]!, expr.items[2], bindings), expr.items[2]!]);
    if (h === "define" && name(expr.items[1]) && expr.items[2]) return rebuild(expr, [expr.items[0]!, expr.items[1]!, visit(expr.items[2], signatures.get(name(expr.items[1])!), bindings)]);
    if (h === "fn" && expr.items[1]?._tag === "Vector") {
      const local = new Map(bindings), type = resolveAlias(expected);
      const parameters = type?._tag === "List" && head(type) === "->" ? type.items.slice(1,-1) : [];
      for (const [i, p] of expr.items[1].items.entries()) if (name(p)) local.set(name(p)!, parameters[i]);
      return rebuild(expr, [expr.items[0]!, expr.items[1], ...expr.items.slice(2).map((body, i, bodies) => visit(body, i === bodies.length-1 ? resultOfType(type) : undefined, local))]);
    }
    if (h === "let" && expr.items[1]?._tag === "Vector") {
      const local = new Map(bindings), items: SExpr[] = [];
      for (let i = 0; i < expr.items[1].items.length; i += 2) {
        const binder = expr.items[1].items[i]!, value = visit(expr.items[1].items[i+1]!, undefined, local);
        items.push(binder, value);
        if (name(binder)) local.set(name(binder)!, typeOf(value, local));
      }
      return rebuild(expr, [expr.items[0]!, copySourceTrace(expr.items[1], {...expr.items[1], items}), ...expr.items.slice(2).map((body, i, bodies) => visit(body, i === bodies.length-1 ? expected : undefined, local))]);
    }
    if (h === "match" && expr.items[1]) {
      const value = visit(expr.items[1], undefined, bindings), type = typeOf(value, bindings), items = [expr.items[0]!, value];
      for (let i = 2; i < expr.items.length; i += 2) items.push(pattern(expr.items[i]!, type), visit(expr.items[i+1]!, expected, bindings));
      return rebuild(expr, items);
    }
    if (h === "if" || h === "do") return rebuild(expr, expr.items.map((item,i) => i === 0 ? item : visit(item, h === "if" && i > 1 || h === "do" && i === expr.items.length-1 ? expected : undefined, bindings)));
    const constructor = qualify(expr.items[0]!, expected, bindings);
    const signature = bindings.get(h ?? "");
    const parameters = payloads.get(name(constructor) ?? "") ?? (signature?._tag === "List" && head(signature) === "->" ? signature.items.slice(1,-1) : []);
    return rebuild(expr, [constructor, ...expr.items.slice(1).map((arg, i) => visit(arg, parameters[i], bindings))]);
  };
  return program.map(expr => visit(expr, undefined, globals));
}

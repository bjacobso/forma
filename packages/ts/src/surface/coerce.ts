import { resolveTypeAlias } from "./type-alias.js";
import { copySourceTrace } from "../evaluator/source-trace.js";
import type { SExpr } from "../reader/types.js";
import { head, name, list, sym } from "./effect.js";

type TypeBindings = ReadonlyMap<string, SExpr>;

/** Insert the Option constructors required by a record's contextual type. */
export function coerceProgram(exprs: readonly SExpr[], externalTypes: ReadonlyMap<string,SExpr> = new Map()): readonly SExpr[] {
  const aliases = new Map<string, SExpr>();
  const signatures = new Map<string, SExpr>(externalTypes);
  const constructors = new Map<string, readonly SExpr[]>();
  for (const expr of exprs) {
    if (expr._tag !== "List") continue;
    if (head(expr) === "__record-type" && expr.items[1]?._tag === "Sym" && expr.items[2]) constructors.set(expr.items[1].name, [expr.items[2]]);
    if (head(expr) === "__sum-type" && expr.items[1]?._tag === "Sym" && expr.items[2]) {
      aliases.set(expr.items[1].name, expr.items[2]);
    }
    if (head(expr)==="__type-alias" && expr.items[1]?._tag==="List" && expr.items[2]) {
      const header=expr.items[1];
      aliases.set(name(header.items[0])!,list(expr,[sym(expr,"__type-function"),{...header,_tag:"Vector",items:header.items.slice(1)},expr.items[2]]));
    }
    if (head(expr) === "__sum-type" && expr.items[1]?._tag === "List") {
      for (const arm of expr.items.slice(2)) {
        if (arm._tag !== "List" || !name(arm.items[0])) continue;
        constructors.set(name(arm.items[0])!, arm.items.slice(1));
        constructors.set(`${name(expr.items[1].items[0])}.${name(arm.items[0])}`, arm.items.slice(1));
      }
    }
    if (head(expr) === ":" && name(expr.items[1]) && expr.items[2]) {
      signatures.set(name(expr.items[1])!, expr.items[2]);
    }
  }
  const resolve = (type: SExpr): SExpr => resolveTypeAlias(type,aliases);
  const fieldName = (expr: SExpr): string | undefined => expr._tag === "Str" ? JSON.stringify(expr.value) : name(expr);
  const call = (expr: SExpr, h: string, ...args: SExpr[]) => list(expr, [sym(expr, h), ...args]);
  const functionResult = (type?: SExpr) => type?._tag === "List" && head(type) === "->" ? type.items.at(-1) : undefined;
  const expressionType = (expr: SExpr, bindings: TypeBindings): SExpr | undefined => {
    const n = name(expr);
    if (n) {
      const declared=bindings.get(n) ?? signatures.get(n);
      if (declared) return declared;
      const [owner,...fields]=n.split(".");
      let type=bindings.get(owner!) ?? signatures.get(owner!);
      for (const field of fields) {
        const record=type ? resolve(type) : undefined;
        type=record?._tag === "Map" ? record.pairs.find(([key])=>fieldName(key)===`:${field}`)?.[1] : undefined;
      }
      return type;
    }
    if (head(expr) === ":" && expr._tag === "List") return expr.items[2];
    if (head(expr) === "get" && expr._tag === "List" && expr.items[1] && expr.items[2]) {
      const owner=expressionType(expr.items[1],bindings), record=owner ? resolve(owner) : undefined;
      return record?._tag === "Map" ? record.pairs.find(([key])=>fieldName(key)===fieldName(expr.items[2]!))?.[1] : undefined;
    }
    if (expr._tag === "List") return functionResult(bindings.get(head(expr) ?? "") ?? signatures.get(head(expr) ?? ""));
    return undefined;
  };
  const isOption = (expr: SExpr, bindings: TypeBindings) => {
    const h = head(expr) ?? name(expr);
    if (["Option.Some", "Option.None", "Some", "None"].includes(h ?? "")) return true;
    const type = expressionType(expr, bindings);
    return type !== undefined && head(resolve(type)) === "Option";
  };
  const transform = (expr: SExpr, expected: SExpr | undefined, bindings: TypeBindings): SExpr => {
    const target = expected ? resolve(expected) : undefined;
    if (target && head(target) === "Map" && expr._tag !== "Map" && head(expr) !== "__dictionary" && !["if", "let", "do", "match", ":"].includes(head(expr) ?? "")) {
      return call(expr, "__dictionary", visit(expr, undefined, bindings));
    }
    const recurse = (value: SExpr, type?: SExpr) => visit(value, type, bindings);
    if (expr._tag === "Map") {
      const declared = target?._tag === "Map" ? target.pairs : [];
      const pairs = expr.pairs.map(([key, value]) => {
        const field = declared.find(([label]) => fieldName(label) === fieldName(key))?.[1];
        const fieldType = field ? resolve(field) : undefined;
        if (fieldType?._tag === "List" && head(fieldType) === "Option") {
          return [key, isOption(value, bindings) ? recurse(value, fieldType) : call(value, "Option.Some", recurse(value, fieldType.items[1]))] as const;
        }
        return [key, recurse(value, field)] as const;
      });
      for (const [key, field] of declared) {
        if (head(resolve(field)) === "Option" && !pairs.some(([label]) => fieldName(label) === fieldName(key))) {
          pairs.push([key, sym(expr, "Option.None")]);
        }
      }
      const record: SExpr = { ...expr, pairs };
      return target && head(target) === "Map" ? call(expr, "__dictionary", record) : record;
    }
    if (expr._tag === "Vector") {
      const item = target?._tag === "List" && head(target) === "List" ? target.items[1] : undefined;
      return { ...expr, items: expr.items.map(value => recurse(value, item)) };
    }
    if (expr._tag !== "List" || ["quote", "quasiquote", "__sum-type", "__type-alias", "__record-type", "__schema"].includes(head(expr) ?? "")) return expr;
    const h = head(expr);
    if (h === ":" && name(expr.items[1]) && signatures.has(name(expr.items[1])!)) return expr;
    if (h === ":" && expr.items.length === 3) return { ...expr, items: [expr.items[0]!, recurse(expr.items[1]!, expr.items[2]), expr.items[2]!] };
    if (h === "define" && name(expr.items[1]) && expr.items[2]) {
      return { ...expr, items: [expr.items[0]!, expr.items[1]!, recurse(expr.items[2], signatures.get(name(expr.items[1])!))] };
    }
    if (h === "fn" && target?._tag === "List" && head(target) === "->") {
      const locals = new Map(bindings);
      const params = expr.items[1];
      if (params?._tag === "Vector") params.items.forEach((param, i) => {
        if (name(param) && target.items[i + 1]) locals.set(name(param)!, target.items[i + 1]!);
      });
      return { ...expr, items: [...expr.items.slice(0, 2), ...expr.items.slice(2).map((value, i, bodies) => visit(value, i === bodies.length - 1 ? target.items.at(-1) : undefined, locals))] };
    }
    if (h === "let" && expr.items[1]?._tag === "Vector") {
      const locals = new Map(bindings);
      const values = expr.items[1].items;
      const items: SExpr[] = [];
      for (let i = 0; i < values.length; i += 2) {
        const pattern = values[i]!, value = values[i + 1];
        if (!value) return expr;
        const type = expressionType(value, locals);
        items.push(pattern, visit(value, undefined, locals));
        if (name(pattern) && type) locals.set(name(pattern)!, type);
      }
      return { ...expr, items: [expr.items[0]!, copySourceTrace(expr.items[1], { ...expr.items[1], items }), ...expr.items.slice(2).map((value, i, bodies) => visit(value, i === bodies.length - 1 ? target : undefined, locals))] };
    }
    if (h === "if") return { ...expr, items: expr.items.map((value, i) => i > 1 ? recurse(value, target) : i === 1 ? recurse(value) : value) };
    if (h === "do") return { ...expr, items: expr.items.map((value, i) => i === expr.items.length - 1 ? recurse(value, target) : i > 0 ? recurse(value) : value) };
    if (h === "match") return { ...expr, items: expr.items.map((value, i) => i === 1 ? recurse(value) : i >= 3 && i % 2 === 1 ? recurse(value, target) : value) };
    const parameters = constructors.get(h ?? "") ?? ((bindings.get(h ?? "") ?? signatures.get(h ?? ""))?._tag === "List"
      ? ((bindings.get(h ?? "") ?? signatures.get(h ?? "")) as Extract<SExpr, { _tag: "List" }>).items.slice(1, -1) : []);
    return { ...expr, items: [expr.items[0]!, ...expr.items.slice(1).map((value, i) => recurse(value, parameters[i]))] };
  };
  const visit = (expr: SExpr, expected?: SExpr, bindings: TypeBindings = signatures): SExpr => {
    const result = transform(expr, expected, bindings);
    if (result === expr) return expr;
    if ((expr._tag === "List" || expr._tag === "Vector") && result._tag === expr._tag
      && result.items.length === expr.items.length && result.items.every((item, i) => item === expr.items[i])) return expr;
    if (expr._tag === "Map" && result._tag === "Map" && result.pairs.length === expr.pairs.length
      && result.pairs.every(([key, value], i) => key === expr.pairs[i]![0] && value === expr.pairs[i]![1])) return expr;
    return copySourceTrace(expr, result);
  };
  return exprs.map(expr => visit(expr));
}

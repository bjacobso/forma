import type { SExpr } from "../reader/types.js";
import { head, name } from "./effect.js";

const bindingNames = (pattern: SExpr): readonly string[] => {
  if (pattern._tag === "Sym") return /^[a-z_$]/.test(pattern.name) && !["_", "&", "nil"].includes(pattern.name) ? [pattern.name] : [];
  if (pattern._tag === "Map") return pattern.pairs.flatMap(([,value]) => bindingNames(value));
  if (pattern._tag === "Vector") return pattern.items.flatMap(bindingNames);
  if (pattern._tag === "List") return pattern.items.slice(1).flatMap(bindingNames);
  return [];
};
const definitionName = (expression: SExpr): string | undefined => expression._tag === "List" ? head(expression) === "macro" && expression.items[1]?._tag === "List" ? name(expression.items[1].items[0]) : name(expression.items[1]) : undefined;

/** Find free references; local patterns and bindings never pull in unrelated helpers. */
export function reachableHelpers(roots: readonly SExpr[], helpers: readonly SExpr[], rootBindings: ReadonlySet<string> = new Set()): readonly SExpr[] {
  const definitions = new Map(helpers.flatMap(expression => definitionName(expression) ? [[definitionName(expression)!, expression] as const] : []));
  const reachable = new Set<string>();
  const extend = (bound: ReadonlySet<string>, patterns: readonly SExpr[]): ReadonlySet<string> => new Set([...bound, ...patterns.flatMap(bindingNames)]);
  const visit = (expression: SExpr, bound: ReadonlySet<string> = new Set()): void => {
    if (expression._tag === "Sym") {
      if (!bound.has(expression.name) && definitions.has(expression.name) && !reachable.has(expression.name)) {
        reachable.add(expression.name);
        visit(definitions.get(expression.name)!);
      }
    } else if (expression._tag === "Map") expression.pairs.forEach(([,value]) => visit(value, bound));
    else if (expression._tag === "Vector") expression.items.forEach(value => visit(value, bound));
    else if (expression._tag === "List") {
      const h = head(expression), items = expression.items;
      if (h === "quote") return;
      if (h === "quasiquote") {
        const unquotes = (value: SExpr): void => {
          if (["unquote", "unquote-splicing"].includes(head(value) ?? "") && value._tag === "List") value.items.slice(1).forEach(value => visit(value, bound));
          else if (value._tag === "List" || value._tag === "Vector") value.items.forEach(unquotes);
          else if (value._tag === "Map") value.pairs.forEach(([key,value]) => {unquotes(key); unquotes(value);});
        };
        items.slice(1).forEach(unquotes);
      } else if ((h === "fn" || h === "lambda") && items[1]?._tag === "Vector") {
        const locals = extend(bound, items[1].items);
        items.slice(2).forEach(value => visit(value, locals));
      } else if (h === "define" && items[2]?._tag === "Vector" && items.length > 3) {
        const locals = extend(bound, items[2].items);
        items.slice(3).forEach(value => visit(value, locals));
      } else if (h === "macro" && items[1]?._tag === "List") {
        const locals = extend(bound, items[1].items.slice(1));
        items.slice(2).forEach(value => visit(value, locals));
      } else if (h === "define") items.slice(2).forEach(value => visit(value, bound));
      else if ((h === "let" || h === "do!") && items[1]?._tag === "Vector") {
        let locals = bound;
        for (let i = 0; i < items[1].items.length; i += 2) {
          const pattern=items[1].items[i]!, value=items[1].items[i+1]!;
          if (name(pattern)===":let" && value._tag === "Vector") {
            for (let j=0;j<value.items.length;j+=2) {visit(value.items[j+1]!,locals);locals=extend(locals,[value.items[j]!]);}
          } else {visit(value,locals);locals = extend(locals, [pattern]);}
        }
        items.slice(2).forEach(value => visit(value, locals));
      } else if (h === "match" || h === "catch") {
        if (items[1]) visit(items[1], bound);
        for (let i = 2; i + 1 < items.length; i += 2) visit(items[i + 1]!, extend(bound, [items[i]!]));
      } else items.forEach(value => visit(value, bound));
    }
  };
  roots.forEach(root => visit(root,rootBindings));
  return [...definitions].filter(([name]) => reachable.has(name)).map(([,definition]) => definition);
}

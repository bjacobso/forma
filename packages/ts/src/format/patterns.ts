import { parse } from "../reader/parser.js";
import { toSExprMany } from "../reader/to-sexpr.js";
import type { SExpr } from "../reader/types.js";
import { preludeSources } from "../preludes/sources.generated.js";
import type { FormatOptions } from "./layout.js";

const defaults = [preludeSources["compiler.lisp"], preludeSources["kernel.lisp"]].flatMap(source => toSExprMany(parse(source).redTree));
export function declarations(expressions: readonly SExpr[], kind: "form" | "macro"): Map<string, readonly SExpr[]> {
  const patterns = new Map<string, readonly SExpr[]>();
  for (const expr of expressions) {
    if (expr._tag !== "List" || expr.items[0]?._tag !== "Sym" || expr.items[0].name !== kind) continue;
    const signature = expr.items[1];
    if (signature?._tag === "List" && signature.items[0]?._tag === "Sym") patterns.set(signature.items[0].name, signature.items.slice(1));
  }
  return patterns;
}
function positional(pattern: readonly SExpr[]): number {
  let count = 0;
  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i]?._tag === "Map" || pattern[i + 1]?._tag === "Sym" && (pattern[i + 1] as Extract<SExpr, { _tag: "Sym" }>).name === "...") break;
    count++;
  }
  return count;
}
// Known exception to descriptor-owned vocabulary: these are compiler forms.
const core = new Map<string, number>([["define", 1], ["fn", 1], ["let", 1], ["if", 1], ["match", 1], ["do", 0], ["module", 1], ["import", 1], [":", 1]]);
export function headerLayouts(expressions: readonly SExpr[], options: FormatOptions): ReadonlyMap<string, number> {
  const result = new Map(core);
  for (const [name, pattern] of [...declarations(defaults, "macro"), ...(options.macroSignatures ?? []), ...declarations(expressions, "macro")]) result.set(name, positional(pattern));
  for (const [name, pattern] of [...declarations(defaults, "form"), ...(options.descriptors ?? []).flatMap(d => d.surface ? [[d.name, d.surface.pattern] as const] : []), ...declarations(expressions, "form")]) result.set(name, positional(pattern));
  return result;
}

import type { GreenElement, GreenNode, GreenToken } from "../reader/green-tree.js";
import type { FormDescriptor } from "../descriptor/FormDescriptor.js";
import type { SExpr } from "../reader/types.js";
import { concat, group, indent, line, softline, hardline, text, lineSuffix, type Doc } from "./doc.js";
import { before, tokensOf, type TokenTrivia } from "./trivia.js";

export interface FormatOptions {
  readonly descriptors?: readonly FormDescriptor[];
  readonly softWrap?: number;
  readonly indentSize?: number;
}

export function layout(root: GreenNode, trivia: ReadonlyMap<GreenToken, TokenTrivia>, options: FormatOptions, expressions: readonly SExpr[] = []): Doc {
  const first = (node: GreenElement) => tokensOf(node)[0]!;
  const last = (node: GreenElement) => tokensOf(node).at(-1)!;
  const patterns = new Map<string, readonly SExpr[]>((options.descriptors ?? []).flatMap(d => d.surface ? [[d.name, d.surface.pattern] as const] : []));
  for (const e of expressions) if (e._tag === "List" && e.items[0]?._tag === "Sym" && e.items[0].name === "form" && e.items[1]?._tag === "List" && e.items[1].items[0]?._tag === "Sym") patterns.set(e.items[1].items[0].name, e.items[1].items.slice(1));
  const tokenDoc = (token: GreenToken): Doc => {
    const trailing = trivia.get(token)?.trailing;
    return trailing ? concat(text(token.text), lineSuffix(text(" " + trailing))) : text(token.text);
  };
  const boundary = (prev: GreenElement, next: GreenElement, sep: Doc) => before(first(next), trivia, trivia.get(last(prev))?.trailing ? hardline : sep);
  const render = (node: GreenElement): Doc => {
    if (node.kind === "token") return tokenDoc(node);
    if (node.kind === "Root") {
      const parts: Doc[] = [];
      node.children.forEach((child, i) => {
        const token = first(child);
        if (token.tokenType === "eof" && !trivia.get(token)!.leading.length) return;
        parts.push(i ? boundary(node.children[i - 1]!, child, hardline) : before(token, trivia, text(""), true), render(child));
      });
      return concat(...parts);
    }
    if (node.kind === "ReaderMacro") {
      const [marker, child] = node.children;
      return group(concat(render(marker!), boundary(marker!, child!, text("")), render(child!)));
    }
    if (!["List", "Vector", "Map", "Set"].includes(node.kind)) return concat(...node.children.map(render));
    const open = node.children[0]!, close = node.children.at(-1)!, items = node.children.slice(1, -1);
    if (!items.length) return group(concat(render(open), boundary(open, close, softline), render(close)));
    const head = first(items[0]!).text;
    const pattern = node.kind === "List" ? patterns.get(head) : undefined;
    let header = node.kind === "List" ? 1 : 0;
    if (pattern) {
      for (let i = 0; i < pattern.length; i++) {
        if (pattern[i]?._tag === "Map" || pattern[i + 1]?._tag === "Sym" && (pattern[i + 1] as Extract<SExpr, { _tag: "Sym" }>).name === "...") break;
        header++;
      }
    }
    const parts: Doc[] = [render(open)];
    const body: Doc[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i]!;
      const prev = i ? items[i - 1]! : open;
      let sep: Doc = i === 0 ? (header ? text("") : softline) : line;
      if (i > 0 && i < header) sep = text(" ");
      let value = render(item);
      if ((node.kind === "Map" || pattern && first(item).tokenType === "keyword") && items[i + 1]) {
        const next = items[++i]!;
        value = group(concat(value, indent(concat(boundary(item, next, line), render(next)))));
      }
      const rendered = concat(boundary(prev, item, sep), value);
      if (i < header) parts.push(rendered); else body.push(rendered);
    }
    parts.push(indent(concat(...body)), boundary(items.at(-1)!, close, text("")), render(close));
    return group(concat(...parts));
  };
  return render(root);
}

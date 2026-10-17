import { headerLayouts } from "./patterns.js";
import type { GreenElement, GreenNode, GreenToken } from "../reader/green-tree.js";
import type { FormDescriptor } from "../descriptor/FormDescriptor.js";
import type { Span } from "../reader/types.js";
import type { SExpr } from "../reader/types.js";
import { concat, group, indent, line, softline, hardline, text, lineSuffix, type Doc } from "./doc.js";
import { before, tokensOf, type TokenTrivia } from "./trivia.js";

export interface FormatOptions {
  /** Declarations from the same logical source (e.g. other Markdown fences). */
  /** Range formatting can also target Markdown fence bodies. */
  readonly language?: "lisp" | "forma" | "markdown";
  readonly range?: Span;
  readonly declarations?: readonly SExpr[];
  readonly macroSignatures?: ReadonlyMap<string, readonly SExpr[]>;
  readonly descriptors?: readonly FormDescriptor[];
  readonly softWrap?: number;
  readonly indentSize?: number;
}

export function layout(root: GreenNode, trivia: ReadonlyMap<GreenToken, TokenTrivia>, options: FormatOptions, expressions: readonly SExpr[] = [], source = "", ignored: readonly Span[] = []): Doc {
  const first = (node: GreenElement) => tokensOf(node)[0]!;
  const last = (node: GreenElement) => tokensOf(node).at(-1)!;
  const headers = headerLayouts([...(options.declarations ?? []), ...expressions], options);
  const tokens = tokensOf(root);
  const nextTokens = new Map(tokens.map((token, index) => [token, tokens[index + 1]]));
  const protectedGap = (start: number, end: number) => ignored.some(r => start < r.end && end > r.start);
  const tokenDoc = (token: GreenToken): Doc => {
    const next = nextTokens.get(token);
    const trailing = next && protectedGap(token.loc.end, next.loc.start) ? undefined : trivia.get(token)?.trailing;
    return trailing ? concat(text(token.text), lineSuffix(text(" " + trailing))) : text(token.text);
  };
  const boundary = (prev: GreenElement, next: GreenElement, sep: Doc) => {
    const start = last(prev).loc.end, end = first(next).loc.start;
    return protectedGap(start, end) ? text(source.slice(start, end)) : before(first(next), trivia, trivia.get(last(prev))?.trailing ? hardline : sep);
  };
  const render = (node: GreenElement): Doc => {
    if (node.kind !== "Root" && ignored.some(r => first(node).loc.start >= r.start && last(node).loc.end <= r.end)) return text(source.slice(first(node).loc.start, last(node).loc.end));
    if (node.kind === "token") return tokenDoc(node);
    if (node.kind === "Root") {
      const parts: Doc[] = [];
      node.children.forEach((child, i) => {
        const token = first(child);
        if (token.tokenType === "eof" && !trivia.get(token)!.leading.length && !protectedGap(i ? last(node.children[i - 1]!).loc.end : 0, source.length)) return;
        parts.push(i ? boundary(node.children[i - 1]!, child, hardline) : (protectedGap(0, token.loc.start) ? text(source.slice(0, token.loc.start)) : before(token, trivia, text(""), true)), render(child));
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
    const known = node.kind === "List" ? headers.get(head) : undefined;
    let header = node.kind === "List" ? Math.min(items.length, known === undefined ? 2 : known + 1) : 0;
    // Keywords begin body options even in calls without descriptors.
    for (let i = 1; i < header; i++) if (first(items[i]!).tokenType === "keyword") { header = i; break; }
    let headerDoc = render(open);
    const body: Doc[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i]!, prev = i ? items[i - 1]! : open;
      const inHeader = i < header;
      const sep = i === 0 ? (header ? text("") : softline) : line;
      let value = render(item);
      if ((node.kind === "Map" || !inHeader && first(item).tokenType === "keyword") && items[i + 1]) {
        const next = items[++i]!;
        value = group(concat(value, indent(concat(boundary(item, next, line), render(next)))));
      }
      if (inHeader) headerDoc = group(concat(headerDoc, indent(concat(boundary(prev, item, sep), value))));
      else body.push(boundary(prev, item, sep), value);
    }
    const parts: Doc[] = [headerDoc, indent(concat(...body)), boundary(items.at(-1)!, close, text("")), render(close)];
    return group(concat(...parts));
  };
  return render(root);
}

import type { GreenElement, GreenToken } from "../reader/green-tree.js";
import { concat, hardline, text, type Doc } from "./doc.js";

export interface TokenTrivia {
  readonly leading: readonly { text: string; blank: boolean }[];
  readonly blank: boolean;
  trailing?: string;
}
export function tokensOf(element: GreenElement): GreenToken[] {
  return element.kind === "token" ? [element] : element.children.flatMap(tokensOf);
}
export function collectTrivia(root: GreenElement): ReadonlyMap<GreenToken, TokenTrivia> {
  const result = new Map<GreenToken, TokenTrivia>();
  let previous: GreenToken | undefined;
  for (const token of tokensOf(root)) {
    const leading: { text: string; blank: boolean }[] = [];
    let whitespace = "", hasOwn = false;
    for (const trivia of token.leadingTrivia) {
      if (trivia.kind === "whitespace") { whitespace += trivia.text; continue; }
      const comment = trivia.text.replace(/\r$/, "");
      if (previous && !hasOwn && !whitespace.includes("\n")) result.get(previous)!.trailing = comment;
      else { leading.push({ text: comment, blank: (whitespace.match(/\n/g)?.length ?? 0) >= 2 }); hasOwn = true; }
      whitespace = "";
    }
    result.set(token, { leading, blank: (whitespace.match(/\n/g)?.length ?? 0) >= 2 });
    previous = token;
  }
  return result;
}

/** Trivia before a token, including the separator chosen by its parent layout. */
export function before(token: GreenToken, trivia: ReadonlyMap<GreenToken, TokenTrivia>, separator: Doc, first = false): Doc {
  const info = trivia.get(token)!;
  const parts: Doc[] = [];
  if (!first) parts.push(info.leading.length || info.blank ? hardline : separator);
  for (const comment of info.leading) {
    if (comment.blank && !first) parts.push(hardline);
    parts.push(text(comment.text), hardline);
    first = false;
  }
  if (info.blank && !first) parts.push(hardline);
  return concat(...parts);
}

import type { GreenNode } from "../reader/green-tree.js";
import type { Span } from "../reader/types.js";
import { tokensOf } from "./trivia.js";

/** Directives are recognized only in reader trivia, never inside strings. */
export function ignoredRanges(root: GreenNode, source: string): readonly Span[] {
  const ranges: Span[] = [];
  let off: number | undefined;
  for (const token of tokensOf(root)) for (const comment of token.leadingTrivia) {
    if (comment.kind !== "line-comment") continue;
    if (/^; forma-fmt: off\s*$/.test(comment.text) && off === undefined) {
      off = source.lastIndexOf("\n", comment.loc.start - 1) + 1;
    } else if (/^; forma-fmt: on\s*$/.test(comment.text) && off !== undefined) {
      const newline = source.indexOf("\n", comment.loc.end);
      ranges.push({ start: off, end: newline < 0 ? source.length : newline + 1 });
      off = undefined;
    }
  }
  if (off !== undefined) ranges.push({ start: off, end: source.length });
  return ranges;
}

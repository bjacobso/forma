import type { Span } from "../reader/types.js";
export interface FormatEdit extends Span { readonly text: string }

/** Formatting preserves the non-whitespace character stream. Match it in
 * linear time and emit only the whitespace gaps that changed. This also works
 * for Markdown, where prose and delimiters remain stable anchors. */
export function formattingEdits(before: string, after: string): readonly FormatEdit[] {
  const edits: FormatEdit[] = [];
  let a = 0, b = 0;
  while (a < before.length || b < after.length) {
    const start = a, target = b;
    while (a < before.length && /\s/.test(before[a]!)) a++;
    while (b < after.length && /\s/.test(after[b]!)) b++;
    if (before.slice(start, a) !== after.slice(target, b)) edits.push({ start, end: a, text: after.slice(target, b) });
    if (before[a] !== after[b]) throw new Error("Formatting changed non-whitespace text");
    if (a >= before.length && b >= after.length) break;
    a++; b++;
  }
  return edits;
}

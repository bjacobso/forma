/** Lossless source formatting. */
import { toSExprMany } from "./reader/to-sexpr.js";
import { parse } from "./reader/parser.js";
import type { Span } from "./reader/types.js";
import { collectTrivia, tokensOf } from "./format/trivia.js";
import { layout, type FormatOptions } from "./format/layout.js";
import { printDoc } from "./format/printer.js";
export type { FormatOptions } from "./format/layout.js";
export interface FormatDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly start: number;
  readonly end: number;
}
export interface FormatResult {
  readonly text: string;
  readonly changed: boolean;
  readonly diagnostics: readonly FormatDiagnostic[];
}
export function formatLisp(source: string, options: FormatOptions = {}): FormatResult {
  const parsed = parse(source);
  const diagnostics = parsed.errors.map(e => ({ code: "format/parse", message: e.message, start: e.loc?.start ?? 0, end: e.loc?.end ?? 0 }));
  if (diagnostics.length) return { text: source, changed: false, diagnostics };
  const printed = printDoc(layout(parsed.greenTree, collectTrivia(parsed.greenTree), options, toSExprMany(parsed.redTree)), options.softWrap ?? 80, options.indentSize ?? 2);
  const text = printed.replace(/\n[ \t]*$/, "").replace(/\n+$/, "") + "\n";
  return { text, changed: text !== source, diagnostics };
}
/** Format intersecting top-level forms, leaving the rest byte-for-byte intact. */
export function formatRange(source: string, range: Span, options: FormatOptions = {}): FormatResult {
  const parsed = parse(source);
  if (parsed.errors.length) return formatLisp(source, options);
  let text = source;
  for (const node of [...parsed.greenTree.children].reverse()) {
    const tokens = tokensOf(node), start = tokens[0]!.loc.start, end = tokens.at(-1)!.loc.end;
    if (tokens[0]!.tokenType === "eof" || end <= range.start || start > range.end || (start === range.end && range.start !== range.end)) continue;
    const formatted = formatLisp(source.slice(start, end), options).text.replace(/\n$/, "");
    text = text.slice(0, start) + formatted + text.slice(end);
  }
  return { text, changed: text !== source, diagnostics: [] };
}

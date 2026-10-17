/** Lossless source formatting. */
import { ignoredRanges } from "./format/ignore.js";
import { formattingEdits } from "./format/edits.js";
import { formatMarkdown } from "./format/markdown.js";
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
  const ignored = ignoredRanges(parsed.greenTree, source);
  const printed = printDoc(layout(parsed.greenTree, collectTrivia(parsed.greenTree), options, toSExprMany(parsed.redTree), source, ignored), options.softWrap ?? 80, options.indentSize ?? 2);
  const text = ignored.some(r => r.end === source.length) ? printed : printed.replace(/\n[ \t]*$/, "").replace(/\n+$/, "") + "\n";
  return { text, changed: text !== source, diagnostics };
}
/** Format intersecting top-level forms, leaving the rest byte-for-byte intact. */
export function formatRange(source: string, range: Span, options: FormatOptions = {}): FormatResult {
  if (options.language === "markdown") return formatMarkdown(source, { ...options, range });
  const parsed = parse(source), formatted = formatLisp(source, options);
  if (formatted.diagnostics.length) return formatted;
  const selected = parsed.greenTree.children.flatMap(node => {
    const tokens = tokensOf(node), start = tokens[0]!.loc.start, end = tokens.at(-1)!.loc.end;
    return tokens[0]!.tokenType === "eof" || end <= range.start || start > range.end || (start === range.end && range.start !== range.end) ? [] : [{ start, end }];
  });
  let text = source;
  for (const edit of [...formattingEdits(source, formatted.text)].reverse()) {
    if (selected.some(span => edit.start >= span.start && edit.end <= span.end || edit.end === span.start || edit.start === span.end && edit.end === source.length)) {
      text = text.slice(0, edit.start) + edit.text + text.slice(edit.end);
    }
  }
  return { text, changed: text !== source, diagnostics: [] };
}

export { formatMarkdown, formattingEdits };
export type { FormatEdit } from "./format/edits.js";

export { moduleFormatOptions } from "./format/module.js";

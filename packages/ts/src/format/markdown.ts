import { extractMarkdownFences, isFormaFence, type MarkdownFence } from "../source/markdown.js";
import { parse } from "../reader/parser.js";
import { toSExprMany } from "../reader/to-sexpr.js";
import { formatLisp, formatRange, type FormatResult, type FormatDiagnostic } from "../Format.js";
import type { FormatOptions } from "./layout.js";
import { formattingEdits } from "./edits.js";

/** Map a dedented code offset back into the author's Markdown. At line
 * boundaries prefer the following line, past the stripped fence indentation. */
function authoredOffset(source: string, block: MarkdownFence, offset: number): number {
  let code = 0, raw = block.bodyStart;
  for (const line of source.slice(block.bodyStart, block.bodyEnd).match(/[^\n]*(?:\n|$)/g) ?? []) {
    const removed = Math.min(block.indent.length, /^ */.exec(line)![0].length);
    const length = line.length - removed;
    if (offset < code + length) return raw + removed + offset - code;
    code += length; raw += line.length;
  }
  return block.bodyEnd;
}
function codeOffset(source: string, block: MarkdownFence, offset: number): number {
  return source.slice(block.bodyStart, Math.max(block.bodyStart, Math.min(offset, block.bodyEnd)))
    .replace(new RegExp(`^ {0,${block.indent.length}}`, "gm"), "").length;
}

export function formatMarkdown(source: string, options: FormatOptions = {}): FormatResult {
  const blocks = extractMarkdownFences(source, "<markdown>", { reportUnsupported: true }).filter(isFormaFence);
  const combined = parse(blocks.filter(b => !b.unsupported).map(b => b.text).join("\n"));
  const declarations = combined.errors.length ? [] : toSExprMany(combined.redTree);
  const diagnostics: FormatDiagnostic[] = [];
  const edits: { start: number; end: number; text: string }[] = [];
  const { range, ...rest } = options;
  const lispOptions: FormatOptions = { ...rest, language: "lisp", declarations: [...(options.declarations ?? []), ...declarations] };
  for (const block of blocks) {
    if (block.ignored || range && (block.bodyEnd <= range.start || block.bodyStart > range.end || block.bodyStart === range.end && range.start !== range.end)) continue;
    if (block.unsupported) {
      diagnostics.push({ code: "format/markdown-unsupported", message: "Skipped a fence in an unsupported Markdown container.", start: block.start, end: block.end });
      continue;
    }
    // Validate the entire fence even when formatting just part of it.
    const checked = formatLisp(block.text, lispOptions);
    if (checked.diagnostics.length) {
      diagnostics.push(...checked.diagnostics.map(d => ({ code: "format/markdown-fragment", message: `Skipped fence ${block.origin.blockIndex + 1}: ${d.message}`,
        start: authoredOffset(source, block, d.start), end: authoredOffset(source, block, d.end) })));
      continue;
    }
    const formatted = range ? formatRange(block.text, { start: codeOffset(source, block, range.start), end: codeOffset(source, block, range.end) }, lispOptions) : checked;
    // Apply code whitespace edits to the original body. This preserves fence
    // indentation and ignored bytes instead of rebuilding the Markdown block.
    for (const edit of formattingEdits(block.text, formatted.text)) {
      let replacement = edit.text.replace(/\n(?=.)/g, "\n" + block.indent);
      if (edit.text.endsWith("\n") && edit.end < block.text.length) replacement += block.indent;
      edits.push({ start: authoredOffset(source, block, edit.start), end: authoredOffset(source, block, edit.end), text: replacement });
    }
  }
  let text = source;
  for (const edit of edits.sort((a, b) => b.start - a.start)) text = text.slice(0, edit.start) + edit.text + text.slice(edit.end);
  return { text, changed: text !== source, diagnostics };
}

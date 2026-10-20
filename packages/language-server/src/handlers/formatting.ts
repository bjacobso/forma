import type { Range, TextEdit } from "vscode-languageserver";
import type { TextDocument } from "vscode-languageserver-textdocument";
import { fileURLToPath } from "node:url";
import { fileFormatOptions } from "@formalang/ts/node";
import { formatMarkdown, formatRange, formattingEdits } from "@formalang/ts/format";
import { isMarkdownDocument, type FormaWorkspace } from "../workspace.js";

/** Whitespace edits keep unchanged tokens, selections and cursors anchored. */
export function formatDocument(workspace: FormaWorkspace, document: TextDocument, range?: Range): TextEdit[] {
  const source = document.getText();
  const open = new Map([...workspace.documents].flatMap(([uri, doc]) => uri.startsWith("file:") ? [[fileURLToPath(uri), doc.getText()] as const] : []));
  const context = document.uri.startsWith("file:") ? fileFormatOptions(fileURLToPath(document.uri), source, open) : { options: {}, diagnostics: [] };
  const selected = range && { start: document.offsetAt(range.start), end: document.offsetAt(range.end) };
  const result = isMarkdownDocument(document)
    ? selected ? formatRange(source, selected, { ...context.options, language: "markdown" }) : formatMarkdown(source, context.options)
    : workspace.analysis.formatResult(document.uri, context.options, selected);
  workspace.reportFormattingDiagnostics(document.uri, [...context.diagnostics, ...(result?.diagnostics ?? [])]);
  if (!result?.changed) return [];
  return formattingEdits(source, result.text).map(e => ({ range: { start: document.positionAt(e.start), end: document.positionAt(e.end) }, newText: e.text }));
}

import { CodeActionKind, type CodeAction, type CodeActionParams, type TextEdit } from "vscode-languageserver";
import type { TextDocument } from "vscode-languageserver-textdocument";
import type { Diagnostic as FormaDiagnostic } from "@formalang/ts/analysis";

import { spanToRange } from "../document.js";
import type { FormaWorkspace } from "../workspace.js";

/** Each diagnostic's edits are one atomic quick fix against unchanged source. */
export function getCodeActions(
  workspace: FormaWorkspace,
  document: TextDocument,
  params: CodeActionParams,
): CodeAction[] {
  if (params.context.only && !params.context.only.some(
    (kind) => kind === "" || kind === CodeActionKind.QuickFix,
  )) return [];

  const actions: CodeAction[] = [];
  for (const diagnostic of params.context.diagnostics) {
    const data: unknown = diagnostic.data;
    if (diagnostic.code === "typecheck/hole" && data && typeof data === "object" && "details" in data) {
      const details = data.details;
      if (details && typeof details === "object" && "candidates" in details && Array.isArray(details.candidates) &&
        "name" in details && typeof details.name === "string" && document.getText(diagnostic.range) === details.name) {
        for (const candidate of details.candidates) {
          if (typeof candidate !== "string" || !candidate || /[\s()[\]{}"';`]/.test(candidate)) continue;
          actions.push({ title: `Replace hole with ${candidate}`, kind: CodeActionKind.QuickFix,
            diagnostics: [diagnostic], edit: {changes: {[document.uri]: [{range: diagnostic.range, newText: candidate}]}} });
        }
      }
      continue;
    }
    if (!data || typeof data !== "object" || !("fix" in data) || !isFix(data.fix)) continue;
    const changes: Record<string, TextEdit[]> = {};
    let valid = true;
    for (const edit of data.fix) {
      const target = workspace.document(edit.span.sourceId) ?? document;
      if (edit.span.endOffset > target.getText().length) {
        valid = false;
        break;
      }
      (changes[target.uri] ??= []).push({
        range: spanToRange(target, edit.span),
        newText: edit.newText,
      });
    }
    if (!valid || Object.keys(changes).length === 0) continue;
    actions.push({
      title: `Fix: ${diagnostic.message.split("\n")[0]}`,
      kind: CodeActionKind.QuickFix,
      diagnostics: [diagnostic],
      edit: { changes },
    });
  }
  if (actions.length === 1) actions[0]!.isPreferred = true;
  return actions;
}

/** Diagnostic data makes a round trip through the client, so validate it. */
function isFix(value: unknown): value is NonNullable<FormaDiagnostic["fix"]> {
  return Array.isArray(value) && value.length > 0 && value.every((edit: unknown) => {
    if (!edit || typeof edit !== "object" || !("newText" in edit) || typeof edit.newText !== "string" || !("span" in edit)) return false;
    const span = edit.span;
    return !!span && typeof span === "object" &&
      "sourceId" in span && typeof span.sourceId === "string" &&
      "startOffset" in span && typeof span.startOffset === "number" && Number.isInteger(span.startOffset) && span.startOffset >= 0 &&
      "endOffset" in span && typeof span.endOffset === "number" && Number.isInteger(span.endOffset) && span.endOffset >= span.startOffset;
  });
}

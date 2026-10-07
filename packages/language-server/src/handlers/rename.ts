import {
  ErrorCodes,
  ResponseError,
  type PrepareRenameParams,
  type Range,
  type RenameParams,
  type TextEdit,
  type WorkspaceEdit,
} from "vscode-languageserver";
import type { TextDocument } from "vscode-languageserver-textdocument";

import { positionToOffset, spanToRange } from "../document.js";
import type { FormaWorkspace } from "../workspace.js";

export function prepareRename(
  workspace: FormaWorkspace,
  document: TextDocument,
  params: PrepareRenameParams,
): Range | null {
  const span = workspace.analysis.prepareRename(
    document.uri,
    positionToOffset(document, params.position),
  );
  return span ? spanToRange(document, span) : null;
}

/** Rename a definition and every reference to it, in every source that mentions it. */
export function rename(
  workspace: FormaWorkspace,
  document: TextDocument,
  params: RenameParams,
): WorkspaceEdit | ResponseError {
  const result = workspace.analysis.rename(
    document.uri,
    positionToOffset(document, params.position),
    params.newName,
  );
  if (!result.ok) return new ResponseError(ErrorCodes.InvalidRequest, result.message);
  const changes: Record<string, TextEdit[]> = {};
  for (const edit of result.edits) {
    const target = workspace.document(edit.span.sourceId);
    if (!target) continue;
    (changes[target.uri] ??= []).push({ range: spanToRange(target, edit.span), newText: edit.newText });
  }
  return { changes };
}

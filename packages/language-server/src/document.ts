import type { Location, Position, Range } from "vscode-languageserver";
import type { TextDocument } from "vscode-languageserver-textdocument";
import type { Span } from "@formalang/ts/analysis";

import type { FormaWorkspace } from "./workspace.js";

export function spanToRange(document: TextDocument, span: Pick<Span, "startOffset" | "endOffset">): Range {
  return {
    start: document.positionAt(clampOffset(document, span.startOffset)),
    end: document.positionAt(clampOffset(document, Math.max(span.startOffset, span.endOffset))),
  };
}

export function positionToOffset(document: TextDocument, position: Position): number {
  return clampOffset(document, document.offsetAt(position));
}

/** The location of a span in any source of the workspace. */
export function spanToLocation(workspace: FormaWorkspace, span: Span): Location | undefined {
  const document = workspace.document(span.sourceId);
  return document ? { uri: document.uri, range: spanToRange(document, span) } : undefined;
}

function clampOffset(document: TextDocument, offset: number): number {
  return Math.max(0, Math.min(document.getText().length, offset));
}

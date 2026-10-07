import { MarkupKind, type Hover, type HoverParams } from "vscode-languageserver";
import type { TextDocument } from "vscode-languageserver-textdocument";

import { positionToOffset, spanToRange } from "../document.js";
import type { FormaWorkspace } from "../workspace.js";

export function getHover(
  workspace: FormaWorkspace,
  document: TextDocument,
  params: HoverParams,
): Hover | null {
  const hover = workspace.analysis.hover(document.uri, positionToOffset(document, params.position));
  if (!hover) return null;
  return {
    contents: { kind: MarkupKind.Markdown, value: hover.markdown },
    range: spanToRange(document, hover.span),
  };
}

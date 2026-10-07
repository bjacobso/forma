import type { DefinitionParams, Location } from "vscode-languageserver";
import type { TextDocument } from "vscode-languageserver-textdocument";

import { positionToOffset, spanToLocation } from "../document.js";
import type { FormaWorkspace } from "../workspace.js";

export function getDefinition(
  workspace: FormaWorkspace,
  document: TextDocument,
  params: DefinitionParams,
): Location | null {
  const definition = workspace.analysis.definition(
    document.uri,
    positionToOffset(document, params.position),
  );
  if (!definition) return null;
  return (
    spanToLocation(workspace, {
      sourceId: definition.sourceId,
      startOffset: definition.span.start,
      endOffset: definition.span.end,
    }) ?? null
  );
}

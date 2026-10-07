import type { Location, ReferenceParams } from "vscode-languageserver";
import type { TextDocument } from "vscode-languageserver-textdocument";

import { positionToOffset, spanToLocation } from "../document.js";
import type { FormaWorkspace } from "../workspace.js";

/** Every reference to the symbol at a position, across open documents and preludes. */
export function getReferences(
  workspace: FormaWorkspace,
  document: TextDocument,
  params: ReferenceParams,
): Location[] {
  return workspace.analysis
    .references(document.uri, positionToOffset(document, params.position), {
      includeDeclaration: params.context.includeDeclaration,
    })
    .flatMap((span) => spanToLocation(workspace, span) ?? []);
}

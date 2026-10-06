import { type Definition, type DefinitionParams, type Location } from "vscode-languageserver";
import type { TextDocument } from "vscode-languageserver-textdocument";

import { positionToOffset, spanToRange } from "../document.js";
import { isRecord, type CstSpan } from "../protocol.js";
import type { OcamlWorkspaceSession } from "../session.js";
import { editorValue, sourceIdForUri } from "../session.js";
import { findIndexedDefinition } from "./references.js";

export async function getDefinition(
  session: OcamlWorkspaceSession,
  document: TextDocument,
  params: DefinitionParams,
): Promise<Definition | null> {
  const offset = positionToOffset(document, params.position);
  const indexed = await findIndexedDefinition(session, document, offset);
  if (indexed) return indexed;
  const response = await session.editorDefinition(document, offset);
  const definition = editorValue(response)["definition"];
  if (!isRecord(definition) || !isSpan(definition["span"])) {
    return null;
  }

  const location: Location = {
    uri:
      definition["uri"] === sourceIdForUri(document.uri) || definition["uri"] === "request"
        ? document.uri
        : typeof definition["uri"] === "string"
          ? definition["uri"]
          : document.uri,
    range: spanToRange(document, definition["span"]),
  };
  return location;
}

function isSpan(value: unknown): value is CstSpan {
  return (
    isRecord(value) &&
    typeof value["sourceId"] === "string" &&
    typeof value["startOffset"] === "number" &&
    typeof value["endOffset"] === "number"
  );
}

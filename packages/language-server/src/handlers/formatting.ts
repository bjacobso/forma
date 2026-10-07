import type { TextEdit } from "vscode-languageserver";
import type { TextDocument } from "vscode-languageserver-textdocument";

import type { FormaWorkspace } from "../workspace.js";

/** One full-document edit, or none when the document is formatted or does not parse. */
export function formatDocument(workspace: FormaWorkspace, document: TextDocument): TextEdit[] {
  const formatted = workspace.analysis.format(document.uri);
  if (formatted === undefined || formatted === document.getText()) return [];
  return [
    {
      range: {
        start: document.positionAt(0),
        end: document.positionAt(document.getText().length),
      },
      newText: formatted,
    },
  ];
}

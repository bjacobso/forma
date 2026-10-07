import type { SemanticTokens, SemanticTokensLegend } from "vscode-languageserver";
import type { TextDocument } from "vscode-languageserver-textdocument";
import { TOKEN_MODIFIERS, TOKEN_TYPES } from "@formalang/ts/analysis";

import type { FormaWorkspace } from "../workspace.js";

export const semanticTokensLegend: SemanticTokensLegend = {
  tokenTypes: [...TOKEN_TYPES],
  tokenModifiers: [...TOKEN_MODIFIERS],
};

export function getSemanticTokens(workspace: FormaWorkspace, document: TextDocument): SemanticTokens {
  return { data: [...workspace.analysis.semanticTokens(document.uri).data] };
}

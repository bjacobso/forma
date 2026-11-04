import { SymbolKind, type SymbolInformation, type WorkspaceSymbolParams } from "vscode-languageserver";
import type { SearchQuery, SearchResult } from "@formalang/ts/analysis";

import { spanToLocation } from "../document.js";
import type { FormaWorkspace } from "../workspace.js";

/**
 * Search forms and global definitions across preludes and open documents.
 * Besides words, the query accepts `produces:IRType` and `type:TypeName`.
 */
export function getWorkspaceSymbols(
  workspace: FormaWorkspace,
  params: WorkspaceSymbolParams,
): SymbolInformation[] {
  return workspace.analysis.search(parseQuery(params.query)).flatMap((result) => {
    if (!result.sourceId || !result.span) return [];
    const location = spanToLocation(workspace, {
      sourceId: result.sourceId,
      startOffset: result.span.start,
      endOffset: result.span.end,
    });
    if (!location) return [];
    const container = result.produces ?? result.type;
    return [{ name: result.name, kind: symbolKind(result.kind), location, ...(container ? { containerName: container } : {}) }];
  });
}

function parseQuery(query: string): SearchQuery {
  const words: string[] = [];
  let produces: string | undefined;
  let type: string | undefined;
  for (const token of query.split(/\s+/).filter(Boolean)) {
    if (token.startsWith("produces:")) produces = token.slice("produces:".length);
    else if (token.startsWith("type:")) type = token.slice("type:".length);
    else words.push(token);
  }
  return { text: words.join(" "), ...(produces ? { produces } : {}), ...(type ? { type } : {}) };
}

function symbolKind(kind: SearchResult["kind"]): SymbolKind {
  switch (kind) {
    case "form":
      return SymbolKind.Struct;
    case "function":
      return SymbolKind.Function;
    case "macro":
      return SymbolKind.Operator;
    case "type":
      return SymbolKind.Class;
    case "constructor":
      return SymbolKind.EnumMember;
    case "method":
      return SymbolKind.Method;
    default:
      return SymbolKind.Variable;
  }
}

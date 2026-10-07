import { SymbolKind, type DocumentSymbol } from "vscode-languageserver";
import type { TextDocument } from "vscode-languageserver-textdocument";
import type { DocumentSymbol as FormaSymbol } from "@formalang/ts/analysis";

import { spanToRange } from "../document.js";
import type { FormaWorkspace } from "../workspace.js";

export function getDocumentSymbols(workspace: FormaWorkspace, document: TextDocument): DocumentSymbol[] {
  return workspace.analysis.documentSymbols(document.uri).map((symbol) => ({
    name: symbol.name,
    detail: symbol.form,
    kind: symbolKind(symbol.kind),
    range: spanToRange(document, symbol.span),
    selectionRange: spanToRange(document, symbol.selectionSpan),
  }));
}

function symbolKind(kind: FormaSymbol["kind"]): SymbolKind {
  switch (kind) {
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
    case "declaration":
      return SymbolKind.Struct;
    default:
      return SymbolKind.Variable;
  }
}

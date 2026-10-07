import {
  CompletionItemKind,
  InsertTextFormat,
  MarkupKind,
  type CompletionItem,
  type CompletionList,
  type CompletionParams,
} from "vscode-languageserver";
import type { TextDocument } from "vscode-languageserver-textdocument";
import type { CompletionKind } from "@formalang/ts/analysis";

import { positionToOffset, spanToRange } from "../document.js";
import type { FormaWorkspace } from "../workspace.js";

export function getCompletions(
  workspace: FormaWorkspace,
  document: TextDocument,
  params: CompletionParams,
): CompletionList {
  const items = workspace.analysis.completions(
    document.uri,
    positionToOffset(document, params.position),
  );
  return {
    isIncomplete: false,
    items: items.map(
      (item): CompletionItem => ({
        label: item.label,
        kind: completionKind(item.kind),
        sortText: item.sortText,
        insertTextFormat: InsertTextFormat.PlainText,
        textEdit: {
          range: spanToRange(document, { startOffset: item.replace.start, endOffset: item.replace.end }),
          newText: item.label,
        },
        ...(item.detail ? { detail: item.detail } : {}),
        ...(item.documentation
          ? { documentation: { kind: MarkupKind.Markdown, value: item.documentation } }
          : {}),
      }),
    ),
  };
}

function completionKind(kind: CompletionKind): CompletionItemKind {
  switch (kind) {
    case "form":
    case "keyword":
      return CompletionItemKind.Keyword;
    case "function":
      return CompletionItemKind.Function;
    case "macro":
      return CompletionItemKind.Snippet;
    case "type":
      return CompletionItemKind.Class;
    case "constructor":
      return CompletionItemKind.EnumMember;
    case "slot":
      return CompletionItemKind.Property;
    case "parameter":
    case "variable":
      return CompletionItemKind.Variable;
  }
}

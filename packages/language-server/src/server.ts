#!/usr/bin/env node
import {
  createConnection,
  ProposedFeatures,
  TextDocuments,
  TextDocumentSyncKind,
  type InitializeParams,
  type InitializeResult,
} from "vscode-languageserver/node.js";
import { TextDocument } from "vscode-languageserver-textdocument";
import { fileURLToPath } from "node:url";

import { getCompletions } from "./handlers/completion.js";
import { getDefinition } from "./handlers/definition.js";
import { getDiagnostics } from "./handlers/diagnostics.js";
import { formatDocument } from "./handlers/formatting.js";
import { getHover } from "./handlers/hover.js";
import { getReferences } from "./handlers/references.js";
import { prepareRename, rename } from "./handlers/rename.js";
import { getSemanticTokens, semanticTokensLegend } from "./handlers/semantic-tokens.js";
import { getDocumentSymbols } from "./handlers/symbols.js";
import { FormaWorkspace } from "./workspace.js";

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

let workspace: FormaWorkspace | undefined;
const formattingEnabled = ["1", "true"].includes(
  process.env["FORMA_LANGUAGE_SERVER_ENABLE_FORMATTING"] ?? "",
);

connection.onInitialize((params: InitializeParams): InitializeResult => {
  const root =
    params.workspaceFolders?.[0]?.uri ??
    params.rootUri ??
    (params.rootPath ? `file://${params.rootPath}` : undefined);
  workspace = new FormaWorkspace({
    workspaceRoot: root?.startsWith("file:") ? fileURLToPath(root) : process.cwd(),
  });

  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      hoverProvider: true,
      completionProvider: {
        resolveProvider: false,
        triggerCharacters: ["(", ":"],
      },
      definitionProvider: true,
      referencesProvider: true,
      renameProvider: { prepareProvider: true },
      documentSymbolProvider: true,
      semanticTokensProvider: { legend: semanticTokensLegend, full: true },
      documentFormattingProvider: formattingEnabled,
    },
  };
});

connection.onInitialized(() => {
  workspace?.ready().catch((error: unknown) => connection.console.error(message(error)));
});

documents.onDidChangeContent(async (event) => {
  if (!workspace) return;
  publish(await workspace.update(event.document));
});

documents.onDidClose(async (event) => {
  connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] });
  if (workspace) publish(await workspace.close(event.document.uri));
});

/** Run a request against the current text of its document. */
function handle<P extends { textDocument: { uri: string } }, R>(
  fallback: R,
  run: (workspace: FormaWorkspace, document: TextDocument, params: P) => R,
): (params: P) => Promise<R> {
  return async (params) => {
    const document = documents.get(params.textDocument.uri);
    if (!workspace || !document) return fallback;
    await workspace.update(document);
    return run(workspace, document, params);
  };
}

connection.onHover(handle(null, getHover));
connection.onCompletion(handle({ isIncomplete: false, items: [] }, getCompletions));
connection.onDefinition(handle(null, getDefinition));
connection.onReferences(handle([], getReferences));
connection.onPrepareRename(handle(null, prepareRename));
connection.onRenameRequest(handle(null, rename));
connection.onDocumentSymbol(handle([], getDocumentSymbols));
connection.languages.semanticTokens.on(
  handle({ data: [] }, (workspace, document) => getSemanticTokens(workspace, document)),
);
connection.onDocumentFormatting(
  handle([], (workspace, document) => (formattingEnabled ? formatDocument(workspace, document) : [])),
);

function publish(changed: readonly TextDocument[]): void {
  for (const document of changed) {
    if (!workspace || !documents.get(document.uri)) continue;
    try {
      connection.sendDiagnostics(getDiagnostics(workspace, document));
    } catch (error) {
      connection.console.error(message(error));
      connection.sendDiagnostics({
        uri: document.uri,
        diagnostics: [
          {
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
            message: message(error),
            source: "forma",
            severity: 1,
            code: "forma/internal",
          },
        ],
      });
    }
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

documents.listen(connection);
connection.listen();

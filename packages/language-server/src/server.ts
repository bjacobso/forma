#!/usr/bin/env node
import {
  createConnection,
  DidChangeConfigurationNotification,
  ProposedFeatures,
  TextDocuments,
  TextDocumentSyncKind,
  type InitializeParams,
  type InitializeResult,
} from "vscode-languageserver/node.js";
import { TextDocument } from "vscode-languageserver-textdocument";

import { getCompletions } from "./handlers/completion.js";
import { getDefinition } from "./handlers/definition.js";
import { getDiagnostics } from "./handlers/diagnostics.js";
import { formatDocument } from "./handlers/formatting.js";
import { getHover } from "./handlers/hover.js";
import { getReferences } from "./handlers/references.js";
import { OcamlWorkspaceSession } from "./session.js";

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

let workspaceSession: OcamlWorkspaceSession | undefined;
let hasConfigurationCapability = false;
const formattingEnabled = ["1", "true"].includes(
  process.env["FORMA_LANGUAGE_SERVER_ENABLE_FORMATTING"] ?? "",
);

connection.onInitialize((params: InitializeParams): InitializeResult => {
  hasConfigurationCapability = Boolean(params.capabilities.workspace?.configuration);
  const workspaceRoot =
    params.workspaceFolders?.[0]?.uri ??
    params.rootUri ??
    (params.rootPath ? `file://${params.rootPath}` : undefined);

  workspaceSession = new OcamlWorkspaceSession({
    workspaceRoot: workspaceRoot ? workspaceRoot.replace(/^file:\/\//, "") : process.cwd(),
  });

  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      hoverProvider: true,
      completionProvider: {
        resolveProvider: false,
        triggerCharacters: ["(", ":", "/", "-"],
        completionItem: {
          labelDetailsSupport: true,
        },
      },
      definitionProvider: true,
      referencesProvider: true,
      documentFormattingProvider: formattingEnabled,
    },
  };
});

connection.onInitialized(() => {
  if (hasConfigurationCapability) {
    connection.client.register(DidChangeConfigurationNotification.type, undefined).catch(() => {
      // Configuration is optional. The server still runs with env/default settings.
    });
  }
});

documents.onDidOpen(async (event) => {
  await publishDiagnostics(event.document);
});

documents.onDidChangeContent(async (event) => {
  await publishDiagnostics(event.document);
});

documents.onDidClose((event) => {
  workspaceSession?.forgetDocument(event.document.uri);
  connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] });
});

connection.onHover(async (params) => {
  const session = workspaceSession;
  const document = documents.get(params.textDocument.uri);
  if (!session || !document) return null;
  return await getHover(session, document, params);
});

connection.onCompletion(async (params) => {
  const session = workspaceSession;
  const document = documents.get(params.textDocument.uri);
  if (!session || !document) {
    return { isIncomplete: false, items: [] };
  }
  return await getCompletions(session, document, params);
});

connection.onDefinition(async (params) => {
  const session = workspaceSession;
  const document = documents.get(params.textDocument.uri);
  if (!session || !document) return null;
  return await getDefinition(session, document, params);
});

connection.onReferences(async (params) => {
  const session = workspaceSession;
  const document = documents.get(params.textDocument.uri);
  if (!session || !document) return [];
  return await getReferences(session, document, params);
});

connection.onDocumentFormatting(async (params) => {
  if (!formattingEnabled) return [];
  const session = workspaceSession;
  const document = documents.get(params.textDocument.uri);
  if (!session || !document) return [];
  return await formatDocument(session, document, params.options);
});

connection.onShutdown(async () => {
  await workspaceSession?.close();
});

connection.onExit(() => {
  process.exit(0);
});

async function publishDiagnostics(document: TextDocument): Promise<void> {
  const session = workspaceSession;
  if (!session) return;

  try {
    connection.sendDiagnostics(await getDiagnostics(session, document));
  } catch (error) {
    connection.console.error(error instanceof Error ? error.message : String(error));
    connection.sendDiagnostics({
      uri: document.uri,
      diagnostics: [
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 1 },
          },
          message: error instanceof Error ? error.message : String(error),
          source: "forma",
          severity: 1,
          code: "forma/internal",
        },
      ],
    });
  }
}

documents.listen(connection);
connection.listen();

import type { Location, ReferenceParams } from "vscode-languageserver";
import type { TextDocument } from "vscode-languageserver-textdocument";
import { TsLanguageHost, type FindReferencesResult, type Span } from "@formalang/host";

import { positionToOffset, spanToRange } from "../document.js";
import type { OcamlWorkspaceSession } from "../session.js";

// Name resolution is syntactic and engine-neutral over the shared reader
// grammar, so it runs on the TypeScript host. The OCaml ABI has no reference
// search yet.
const syntaxHost = new TsLanguageHost();

/** Every reference to the symbol at a position, across open documents and preludes. */
export async function getReferences(
  session: OcamlWorkspaceSession,
  document: TextDocument,
  params: ReferenceParams,
): Promise<Location[]> {
  const { result, documents } = await findSymbolOccurrences(
    session,
    document,
    positionToOffset(document, params.position),
  );
  const spans = [
    ...(params.context.includeDeclaration && result.definition ? [result.definition.span] : []),
    ...result.references.map((reference) => reference.span),
  ];
  return spans.flatMap((span) => location(documents, span));
}

/** The definition of the symbol at a position, from the symbol index. */
export async function findIndexedDefinition(
  session: OcamlWorkspaceSession,
  document: TextDocument,
  offset: number,
): Promise<Location | null> {
  const { result, documents } = await findSymbolOccurrences(session, document, offset);
  return result.definition ? (location(documents, result.definition.span)[0] ?? null) : null;
}

async function findSymbolOccurrences(
  session: OcamlWorkspaceSession,
  document: TextDocument,
  offset: number,
): Promise<{ result: FindReferencesResult; documents: ReadonlyMap<string, TextDocument> }> {
  // Open documents replace prelude files with the same URI.
  const byUri = new Map(
    [...(await session.preludeDocuments()), ...session.documents.values()].map(
      (item) => [item.uri, item] as const,
    ),
  );
  byUri.delete(document.uri);
  const others = [...byUri.values()];
  const documents = new Map([...others, document].map((item) => [item.uri, item] as const));
  const result = await syntaxHost.findReferences({
    sourceId: document.uri,
    source: document.getText(),
    offset,
    documents: others.map((other) => ({ sourceId: other.uri, source: other.getText() })),
  });
  return { result, documents };
}

function location(documents: ReadonlyMap<string, TextDocument>, span: Span): Location[] {
  const document = documents.get(span.sourceId);
  return document ? [{ uri: document.uri, range: spanToRange(document, span) }] : [];
}

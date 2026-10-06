import type { Location, ReferenceParams } from "vscode-languageserver";
import type { TextDocument } from "vscode-languageserver-textdocument";
import { TsLanguageHost, type FindReferencesResult, type SymbolIndexResult, type Span } from "@formalang/host";

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
    ...(params.context.includeDeclaration ? (result.definitionSites ?? (result.definition ? [result.definition] : [])).map((definition) => definition.span) : []),
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

interface CachedIndex {
  readonly signature: string;
  readonly result: Promise<SymbolIndexResult>;
}
const symbolIndexes = new WeakMap<OcamlWorkspaceSession, CachedIndex>();

async function findSymbolOccurrences(
  session: OcamlWorkspaceSession,
  document: TextDocument,
  offset: number,
): Promise<{ result: FindReferencesResult; documents: ReadonlyMap<string, TextDocument> }> {
  // Prelude order is load order; additional open documents have a fixed URI order.
  // Replacing an open prelude retains the prelude's original load position.
  const documents = new Map((await session.preludeDocuments()).map((item) => [item.uri, item] as const));
  for (const item of [...session.documents.values()].sort((a, b) => a.uri.localeCompare(b.uri))) documents.set(item.uri, item);
  documents.set(document.uri, document);
  const ordered = [...documents.values()];
  const signature = JSON.stringify(ordered.map((item) => [item.uri, item.version, item.getText()]));
  let cached = symbolIndexes.get(session);
  if (!cached || cached.signature !== signature) {
    const last = ordered.at(-1)!;
    cached = {
      signature,
      result: syntaxHost.symbolIndex({
        sourceId: last.uri,
        source: last.getText(),
        documents: ordered.slice(0, -1).map((item) => ({ sourceId: item.uri, source: item.getText() })),
      }),
    };
    symbolIndexes.set(session, cached);
  }
  const index = await cached.result;
  const hits = (item: { readonly span: Span }) => item.span.sourceId === document.uri && item.span.startOffset <= offset && offset <= item.span.endOffset;
  const reference = index.references.find(hits);
  const definition = index.definitions.find(hits) ?? index.definitions.find((item) => item.key === reference?.definition);
  const definitionSites = definition
    ? definition.scope === "global" ? index.definitions.filter((site) => site.scope === "global" && site.name === definition.name) : [definition]
    : [];
  const keys = new Set(definitionSites.map((site) => site.key));
  const references = definition
    ? index.references.filter((item) => item.definition !== undefined && keys.has(item.definition))
    : reference ? index.references.filter((item) => item.name === reference.name && item.resolution === reference.resolution) : [];
  return { result: { sourceId: document.uri, definition, definitionSites, references, diagnostics: index.diagnostics }, documents };
}

function location(documents: ReadonlyMap<string, TextDocument>, span: Span): Location[] {
  const document = documents.get(span.sourceId);
  return document ? [{ uri: document.uri, range: spanToRange(document, span) }] : [];
}

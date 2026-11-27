/**
 * Browser-safe read-only DefinitionIndex projection for host operations and MCP tools.
 * Delegates canonical alpha-equivalent/SCC definition hashing and index construction
 * to `@formalang/ts/store-queries` (`buildDefinitionIndexFromSources`), while
 * collecting parse diagnostics for malformed input documents.
 */
import { Effect } from "effect";
import { diagnosticFromUnknown, type Diagnostic } from "@formalang/ts/diagnostic";
import { parseManyToSExpr } from "@formalang/ts/reader";
import {
  buildDefinitionIndexFromSources,
  type DefinitionDetails,
  type DefinitionIndex,
  type DefinitionRecord,
} from "@formalang/ts/store-queries";

export interface IndexedSourceDocument {
  readonly id: string;
  readonly source: string;
}

export interface BuiltDefinitionIndex {
  readonly index: DefinitionIndex;
  readonly diagnostics: readonly Diagnostic[];
}

/**
 * Build a read-only canonical `DefinitionIndex` from one or more Forma source documents.
 */
export function buildSessionDefinitionIndex(
  documents: readonly IndexedSourceDocument[],
): BuiltDefinitionIndex {
  const diagnostics: Diagnostic[] = [];
  const validDocs: IndexedSourceDocument[] = [];

  for (const doc of documents) {
    const read = Effect.runSync(Effect.result(parseManyToSExpr(doc.source, doc.id)));
    if (read._tag === "Failure") {
      diagnostics.push(diagnosticFromUnknown(read.failure, "parse", doc.id));
      continue;
    }
    validDocs.push(doc);
  }

  const index = buildDefinitionIndexFromSources(validDocs);
  return { index, diagnostics };
}

/** Project a `DefinitionRecord` into a JSON-safe `DefinitionDetails` payload. */
export function recordToDetails(
  index: DefinitionIndex,
  record: DefinitionRecord,
): DefinitionDetails {
  const meta = index.metadata.get(record.hash) ?? record.meta;
  return {
    hash: record.hash,
    kind: record.kind,
    name: record.name,
    qualifiedName: record.qualifiedName,
    moduleId: record.moduleId,
    ...(record.signature !== undefined ? { signature: record.signature } : {}),
    ...(record.canonicalSignature !== undefined
      ? { canonicalSignature: record.canonicalSignature }
      : {}),
    requirements: [...record.requirements],
    errors: [...record.errors],
    ...(meta.authoredSource !== undefined ? { authoredSource: meta.authoredSource } : {}),
    ...(meta.docstring !== undefined ? { docstring: meta.docstring } : {}),
    ...(meta.span !== undefined ? { span: meta.span } : {}),
    languageProfile: record.languageProfile,
    dependencies: [...record.dependencies],
    formDependencies: [...record.formDependencies],
    opaqueRefs: [...record.opaqueRefs],
    ...(record.scc !== undefined ? { scc: record.scc } : {}),
  };
}

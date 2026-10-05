/**
 * Review D: cross-file name resolution in the language server.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { TsLanguageHost } from "@formalang/host";
import { describe, expect, test, vi } from "vitest";
import { TextDocument } from "vscode-languageserver-textdocument";
import type { Location } from "vscode-languageserver";

import { getDefinition } from "../src/handlers/definition.js";
import { getReferences } from "../src/handlers/references.js";
import { OcamlWorkspaceSession } from "../src/session.js";

const docUri = "file:///workspace/doc.lisp";

const positionOf = (document: TextDocument, text: string, nth = 0) => {
  let offset = -1;
  for (let count = 0; count <= nth; count++) offset = document.getText().indexOf(text, offset + 1);
  return document.positionAt(offset + 1);
};

const fakeSession = (preludes: TextDocument[], open: TextDocument[]) =>
  ({
    documents: new Map(open.map((document) => [document.uri, document])),
    preludeDocuments: async () => preludes,
    editorDefinition: async () => ({ ok: true, value: {} }),
  }) as unknown as OcamlWorkspaceSession;

describe("references across preludes and open documents", () => {
  test("14: an open prelude replaces its stale disk copy", async () => {
    const root = mkdtempSync(join(tmpdir(), "forma-review-d-"));
    writeFileSync(join(root, "prelude.lisp"), "(define stale-name 1)");
    const preludeUri = pathToFileURL(join(root, "prelude.lisp")).href;
    const prelude = TextDocument.create(preludeUri, "lisp", 2, "(define fresh-name 1)");
    const document = TextDocument.create(docUri, "lisp", 1, "(run fresh-name stale-name)");
    // No OCaml process is needed: preludeDocuments only reads files.
    const session = new OcamlWorkspaceSession({ workspaceRoot: root, preludePaths: ["prelude.lisp"] });
    session.documents.set(prelude.uri, prelude);
    session.documents.set(document.uri, document);

    const fresh = await getReferences(session, document, {
      textDocument: { uri: docUri },
      position: positionOf(document, "fresh-name"),
      context: { includeDeclaration: true },
    });
    expect(fresh.map((location) => location.uri)).toEqual([preludeUri, docUri]);
    expect(fresh[0]?.range.start).toEqual({ line: 0, character: 8 });

    const stale = await getReferences(session, document, {
      textDocument: { uri: docUri },
      position: positionOf(document, "stale-name"),
      context: { includeDeclaration: true },
    });
    expect(stale.map((location) => location.uri)).toEqual([docUri]);
  });

  test("15: a reference in an open document to a prelude global, asked from the document", async () => {
    const prelude = TextDocument.create("file:///workspace/prelude.lisp", "lisp", 1, "(define x 1)");
    const document = TextDocument.create(docUri, "lisp", 1, "(print x)\n(define x 2)");
    const definition = await getDefinition(fakeSession([prelude], [document]), document, {
      textDocument: { uri: docUri },
      position: positionOf(document, "x"),
    });
    // Preludes load first, so the top-level `x` reads the prelude's value.
    expect((definition as Location | null)?.uri).toBe(prelude.uri);
  });

  test.fails("15: the same reference, asked from the prelude, gives the same answer", async () => {
    // Root cause: findSymbolOccurrences always indexes the requesting document last, so load order (and with it SymbolWalker.global's "latest before") depends on where the cursor is.
    const prelude = TextDocument.create("file:///workspace/prelude.lisp", "lisp", 1, "(define x 1)");
    const document = TextDocument.create(docUri, "lisp", 1, "(print x)\n(define x 2)");
    const references = await getReferences(fakeSession([prelude], [prelude, document]), prelude, {
      textDocument: { uri: prelude.uri },
      position: positionOf(prelude, "x"),
      context: { includeDeclaration: false },
    });
    expect(references.map((location) => location.uri)).toEqual([docUri]);
  });
});

describe("definition fallback", () => {
  test.fails("a definition miss on a builtin does not re-expand every document", async () => {
    // Root cause: getDefinition falls back to findIndexedDefinition on every miss, which rereads preludes and re-expands all documents synchronously, with no cache, cancellation, or time budget (a 2-line exponential macro costs ~0.65s at depth 12, doubling per level).
    const spy = vi.spyOn(TsLanguageHost.prototype, "findReferences");
    try {
      const document = TextDocument.create(docUri, "lisp", 1, "(+ 1 2)");
      await getDefinition(fakeSession([], [document]), document, {
        textDocument: { uri: docUri },
        position: { line: 0, character: 1 },
      });
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});

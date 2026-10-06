import { describe, expect, test } from "vitest";
import { TextDocument } from "vscode-languageserver-textdocument";

import { getCompletions } from "../src/handlers/completion.js";
import { getDefinition } from "../src/handlers/definition.js";
import { getReferences } from "../src/handlers/references.js";
import { formatDocument } from "../src/handlers/formatting.js";
import type { OcamlWorkspaceSession } from "../src/session.js";

const uri = "file:///workspace/source.lisp";

function fakeSession(document: TextDocument): OcamlWorkspaceSession {
  return {
    documents: new Map([[document.uri, document]]),
    preludeDocuments: async () => [],
    editorCompletion: async () => ({
      ok: true,
      value: {
        items: [
          { label: "define", kind: "form", detail: "core form" },
          { label: "x", kind: "value", detail: "define" },
        ],
      },
    }),
    editorDefinition: async () => ({
      ok: true,
      value: {
        definition: {
          name: "x",
          uri: document.uri,
          span: { sourceId: "source.lisp", startOffset: 8, endOffset: 9 },
          detail: "define",
        },
      },
    }),
    editorFormat: async () => ({
      ok: true,
      value: {
        text: "(define x 1)\nx\n",
      },
    }),
  } as unknown as OcamlWorkspaceSession;
}

describe("OCaml LSP handlers", () => {
  test("completion combines core forms and document definitions", async () => {
    const document = TextDocument.create(uri, "lisp", 1, "(define x 1)\nx");
    const result = await getCompletions(fakeSession(document), document, {
      textDocument: { uri },
      position: { line: 1, character: 1 },
    });

    expect(result.items.map((item) => item.label)).toContain("define");
    expect(result.items.map((item) => item.label)).toContain("x");
  });

  test("definition resolves document symbols to parsed definition spans", async () => {
    const document = TextDocument.create(uri, "lisp", 1, "(define x 1)\nx");
    const result = await getDefinition(fakeSession(document), document, {
      textDocument: { uri },
      position: { line: 1, character: 0 },
    });

    expect(result).toMatchObject({
      uri,
      range: {
        start: { line: 0, character: 8 },
        end: { line: 0, character: 9 },
      },
    });
  });

  test("formatting returns one full-document edit", async () => {
    const document = TextDocument.create(uri, "lisp", 1, "(define   x   1)");
    const result = await formatDocument(fakeSession(document), document, {
      tabSize: 2,
      insertSpaces: true,
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.newText).toBe("(define x 1)\nx\n");
  });

  test("references cover open documents and resolve macro-made names", async () => {
    const library = TextDocument.create(
      "file:///workspace/steps.lisp",
      "lisp",
      1,
      "(macro (defstep name) `(define ~name {:step true}))\n(defstep verify)",
    );
    const document = TextDocument.create(uri, "lisp", 1, "(run verify)\n(log verify)");
    const session = {
      documents: new Map([
        [library.uri, library],
        [document.uri, document],
      ]),
      preludeDocuments: async () => [],
      editorDefinition: async () => ({ ok: true, value: {} }),
    } as unknown as OcamlWorkspaceSession;

    const references = await getReferences(session, document, {
      textDocument: { uri },
      position: { line: 0, character: 6 },
      context: { includeDeclaration: true },
    });
    expect(references).toEqual([
      {
        uri: library.uri,
        range: { start: { line: 1, character: 9 }, end: { line: 1, character: 15 } },
      },
      { uri, range: { start: { line: 0, character: 5 }, end: { line: 0, character: 11 } } },
      { uri, range: { start: { line: 1, character: 5 }, end: { line: 1, character: 11 } } },
    ]);

    // The OCaml engine knows nothing about the macro, so the index answers.
    const definition = await getDefinition(session, document, {
      textDocument: { uri },
      position: { line: 1, character: 6 },
    });
    expect(definition).toEqual(references[0]);
  });
});

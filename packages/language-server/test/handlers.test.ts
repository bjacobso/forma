import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, test } from "vitest";
import { TextDocument } from "vscode-languageserver-textdocument";
import { CompletionItemKind, ResponseError, SymbolKind } from "vscode-languageserver";

import {
  FormaWorkspace,
  formatDocument,
  getCompletions,
  getDefinition,
  getDiagnostics,
  getDocumentSymbols,
  getHover,
  getReferences,
  getSemanticTokens,
  prepareRename,
  rename,
  semanticTokensLegend,
} from "../src/index.js";

const PRELUDE = `(macro (defstep name) \`(define ~name {:step true}))
(define base 10)
(type WorkflowIR {:trigger String :steps (Option (List String))})
(form (workflow name {:keys [trigger steps]})
  "A named sequence of steps."
  :types {:name (Declares Workflow) :trigger String :steps (Option (List String))}
  :ir WorkflowIR {:trigger trigger :steps steps})
`;

const uri = "file:///workspace/source.lisp";

async function setup(source: string) {
  const directory = await mkdtemp(join(tmpdir(), "forma-ls-"));
  const preludePath = join(directory, "steps.lisp");
  await writeFile(preludePath, PRELUDE);
  const workspace = new FormaWorkspace({ workspaceRoot: directory, preludePaths: ["steps.lisp"] });
  const document = TextDocument.create(uri, "forma", 1, source);
  await workspace.update(document);
  return { workspace, document, preludeUri: pathToFileURL(preludePath).href };
}

const position = (document: TextDocument, text: string, delta = 0, nth = 0) => {
  let offset = -1;
  for (let count = 0; count <= nth; count++) offset = document.getText().indexOf(text, offset + 1);
  if (offset < 0) throw new Error(`no ${text}`);
  return document.positionAt(offset + delta);
};

describe("Forma language server handlers", () => {
  test("diagnostics report parse and type errors at their ranges", async () => {
    const { workspace, document } = await setup('(define ok (+ base 1))\n(+ 1 "nope")\n(define broken');
    const { diagnostics } = getDiagnostics(workspace, document);
    expect(diagnostics.map((diagnostic) => [diagnostic.code, diagnostic.range.start.line])).toEqual(
      expect.arrayContaining([
        ["parse/syntax", 2],
        ["typecheck/type-mismatch", 1],
      ]),
    );
    expect(diagnostics.every((diagnostic) => diagnostic.source === "forma")).toBe(true);
    expect(diagnostics.some((diagnostic) => diagnostic.range.start.line === 0)).toBe(false);
  });

  test("hover shows types, including names from preludes", async () => {
    const { workspace, document } = await setup("(define double (fn [n] (* n 2)))\n(double base)");
    const hover = getHover(workspace, document, {
      textDocument: { uri },
      position: position(document, "base", 1),
    });
    expect(hover?.contents).toMatchObject({ kind: "markdown" });
    expect(JSON.stringify(hover?.contents)).toContain("base : Int");
    expect(hover?.range).toEqual({
      start: { line: 1, character: 8 },
      end: { line: 1, character: 12 },
    });
  });

  test("completion offers locals, prelude names, forms, and slots", async () => {
    const { workspace, document } = await setup("(define (scale factor) (* factor ))");
    const { items } = getCompletions(workspace, document, {
      textDocument: { uri },
      position: position(document, " ))", 1),
    });
    const byLabel = new Map(items.map((item) => [item.label, item]));
    expect(byLabel.get("factor")?.kind).toBe(CompletionItemKind.Variable);
    expect(byLabel.get("base")).toMatchObject({ kind: CompletionItemKind.Variable, detail: "Int" });
    expect(byLabel.get("workflow")?.kind).toBe(CompletionItemKind.Keyword);

    const slots = await setup('(workflow onboarding :trigger "hired" :');
    const slotItems = getCompletions(slots.workspace, slots.document, {
      textDocument: { uri },
      position: slots.document.positionAt(slots.document.getText().length),
    }).items;
    expect(slotItems.map((item) => [item.label, item.kind])).toEqual([
      [":steps", CompletionItemKind.Property],
    ]);
  });

  test("definitions and references resolve names introduced by prelude macros", async () => {
    const { workspace, document, preludeUri } = await setup("(defstep verify)\n(run verify)\n(log verify)");
    const definition = getDefinition(workspace, document, {
      textDocument: { uri },
      position: position(document, "verify", 0, 1),
    });
    expect(definition).toEqual({
      uri,
      range: { start: { line: 0, character: 9 }, end: { line: 0, character: 15 } },
    });
    const references = getReferences(workspace, document, {
      textDocument: { uri },
      position: position(document, "verify", 0, 1),
      context: { includeDeclaration: false },
    });
    expect(references.map((location) => location.range.start.line)).toEqual([1, 2]);

    const macro = getDefinition(workspace, document, {
      textDocument: { uri },
      position: position(document, "defstep", 1),
    });
    expect(macro).toMatchObject({ uri: preludeUri, range: { start: { line: 0, character: 8 } } });
  });

  test("rename edits every reference, across documents and preludes", async () => {
    const { workspace, document, preludeUri } = await setup("(+ base 1)\n(* base 2)");
    expect(
      prepareRename(workspace, document, { textDocument: { uri }, position: position(document, "base", 1) }),
    ).toEqual({ start: { line: 0, character: 3 }, end: { line: 0, character: 7 } });
    const edit = rename(workspace, document, {
      textDocument: { uri },
      position: position(document, "base", 1),
      newName: "origin",
    });
    if (edit instanceof ResponseError || !edit) throw new Error("rename failed");
    expect(Object.keys(edit.changes ?? {}).sort()).toEqual([uri, preludeUri].sort());
    expect(edit.changes?.[uri]?.map((change) => change.newText)).toEqual(["origin", "origin"]);

    const refused = rename(workspace, document, {
      textDocument: { uri },
      position: position(document, "+", 0),
      newName: "plus",
    });
    expect(refused).toBeInstanceOf(ResponseError);
  });

  test("document symbols list top-level definitions", async () => {
    const { workspace, document } = await setup("(define a 1)\n(define (f x) x)\n(workflow onboarding)");
    expect(getDocumentSymbols(workspace, document).map((symbol) => [symbol.name, symbol.kind])).toEqual([
      ["a", SymbolKind.Variable],
      ["f", SymbolKind.Function],
      ["onboarding", SymbolKind.Struct],
    ]);
  });

  test("semantic tokens use the advertised legend", async () => {
    const { workspace, document } = await setup("(define (f x) x)");
    const { data } = getSemanticTokens(workspace, document);
    // define, f, x, x
    expect(data.length).toBe(4 * 5);
    const types = Array.from({ length: data.length / 5 }, (_, index) =>
      semanticTokensLegend.tokenTypes[data[index * 5 + 3]!],
    );
    expect(types).toEqual(["keyword", "function", "parameter", "parameter"]);
  });

  test("formatting returns one full-document edit", async () => {
    const { workspace, document } = await setup("(define   x   1)");
    const edits = formatDocument(workspace, document);
    expect(edits).toHaveLength(1);
    expect(edits[0]?.newText).toBe("(define x 1)\n");
  });

  test("an open prelude replaces its file for every document", async () => {
    const { workspace, document, preludeUri } = await setup("(+ base 1)");
    const prelude = TextDocument.create(preludeUri, "forma", 2, '(define base "ten")');
    const changed = await workspace.update(prelude);
    expect(changed.map((item) => item.uri)).toContain(uri);
    expect(getDiagnostics(workspace, document).diagnostics.map((d) => d.code)).toContain(
      "typecheck/type-mismatch",
    );
    await workspace.close(preludeUri);
    expect(getDiagnostics(workspace, document).diagnostics).toEqual([]);
  });
});

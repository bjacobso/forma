import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test } from "vitest";
import { TextDocument } from "vscode-languageserver-textdocument";
import { FormaWorkspace, formatDocument } from "../src/index.js";

test("Markdown ranges preserve prose and other forms; fragments are reported", async () => {
  const diagnostics: string[] = [];
  const workspace = new FormaWorkspace({ onFormattingDiagnostic: (_, d) => diagnostics.push(d.code) });
  const source = "# Prose  \n```lisp\n(a   b)\n(c   d)\n```\n```lisp\n(broken\n```\n";
  const doc = TextDocument.create("file:///workspace/doc.md", "markdown", 1, source);
  await workspace.update(doc);
  expect(workspace.analysis.text(doc.uri)).toBeUndefined();
  const start = doc.positionAt(source.indexOf("b)"));
  const edits = formatDocument(workspace, doc, { start, end: { ...start, character: start.character + 1 } });
  expect(TextDocument.applyEdits(doc, edits)).toBe(source.replace("(a   b)", "(a b)"));
  formatDocument(workspace, doc);
  expect(diagnostics).toContain("format/markdown-fragment");
});

test("CLI and LSP agree on imported layouts and LSP uses unsaved dependency text", async () => {
  const dir = mkdtempSync(join(tmpdir(), "forma-lsp-fmt-"));
  try {
    const macros = join(dir, "macros.md"), path = join(dir, "main.forma");
    const macroSource = '(export whenish)\n(macro (whenish test context body ...) `(if ~test (do ~context ~@body) nil))';
    const markdown = (code: string) => "# Macro module\n```lisp\n" + code + "\n```\n";
    writeFileSync(macros, markdown(macroSource));
    const source = '(import "./macros.md" [whenish])\n(whenish true false (str "first sufficiently long expression") (str "second sufficiently long expression"))';
    const doc = TextDocument.create(pathToFileURL(path).href, "forma", 1, source), workspace = new FormaWorkspace();
    await workspace.update(doc);
    const lsp = TextDocument.applyEdits(doc, formatDocument(workspace, doc));
    const cli = spawnSync(process.execPath, [resolve(import.meta.dirname, "../../host/dist/cli.mjs"), "fmt", "--stdin", "--stdin-filepath", path], { input: source, encoding: "utf8" });
    expect(cli.status, cli.stderr).toBe(0); expect(lsp).toBe(cli.stdout);
    expect(lsp).toContain("(whenish true false\n");
    const edited = TextDocument.create(pathToFileURL(macros).href, "markdown", 2, markdown(macroSource.replace("test context body", "test body").replace("~context ", "")));
    await workspace.update(edited);
    const unsaved = TextDocument.applyEdits(doc, formatDocument(workspace, doc));
    expect(unsaved).toContain("(whenish true\n  false\n");
    expect(unsaved).not.toBe(lsp);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}, 20_000);

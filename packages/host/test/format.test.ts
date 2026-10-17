import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { JsonAbi } from "../src/json-abi.js";
import { TsLanguageHost } from "../src/ts-host.js";

const cli = resolve(import.meta.dirname, "../dist/cli.mjs");
const run = (args: string[], input?: string) => spawnSync(process.execPath, [cli, "fmt", ...args], { input, encoding: "utf8" });
describe("forma fmt", () => {
  test("checks without writing, writes files, and stays idempotent", () => {
    const dir = mkdtempSync(join(tmpdir(), "forma-fmt-")), file = join(dir, "source.forma");
    try {
      writeFileSync(file, "(define   x 1)\n");
      const checked = run(["--check", file]);
      expect(checked.status, checked.stderr).toBe(1);
      expect(checked.stdout).toContain(file + "\n@@ line 1 @@\n");
      expect(readFileSync(file, "utf8")).toBe("(define   x 1)\n");
      expect(run([dir]).status).toBe(0);
      expect(readFileSync(file, "utf8")).toBe("(define x 1)\n");
      expect(run(["--check", dir]).status).toBe(0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 20_000);
  test("stdin respects the filepath language and strict fragment policy", () => {
    const source = "prose  \n```forma\n(a   b)\n```\n";
    const result = run(["--stdin", "--stdin-filepath", "example.md"], source);
    expect(result.status, result.stderr).toBe(0); expect(result.stdout).toBe(source.replace("(a   b)", "(a b)"));
    const fragment = "```lisp\n(a\n```\n";
    const skipped = run(["--check", "--stdin", "--stdin-filepath", "example.md"], fragment);
    expect(skipped.status).toBe(0); expect(skipped.stderr).toContain("format/markdown-fragment");
    const strict = run(["--strict", "--check", "--stdin", "--stdin-filepath", "example.md"], fragment);
    expect(strict.status).toBe(1);
    const invalid = run(["--stdin"], "(a");
    expect(invalid.status).toBe(1); expect(invalid.stdout).toBe("(a"); expect(invalid.stderr).toContain("format/parse");
  }, 20_000);
  test("usage failures return 64", () => {
    for (const args of [[], ["--wat"], ["--stdin", "x.forma"], ["--stdin-filepath", "x.md"], ["--stdin", "--stdin-filepath"], ["--stdin", "--stdin-filepath", "x.txt"]]) expect(run(args).status, args.join(" ")).toBe(64);
  }, 20_000);
  test("stdin loads imported macro layouts relative to its filepath", () => {
    const dir = mkdtempSync(join(tmpdir(), "forma-fmt-import-"));
    try {
      writeFileSync(join(dir, "macros.forma"), '(export whenish)\n(macro (whenish test context body ...) `(if ~test (do ~context ~@body) nil))');
      const source = '(import "./macros.forma" [whenish])\n(whenish true false (str "first sufficiently long expression") (str "second sufficiently long expression"))';
      const result = run(["--stdin", "--stdin-filepath", join(dir, "main.forma")], source);
      expect(result.status, result.stderr).toBe(0); expect(result.stderr).toBe("");
      expect(result.stdout).toContain("(whenish true false\n");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 20_000);
  test("stdin loads imported descriptors relative to its filepath", () => {
    const path = resolve(import.meta.dirname, "../../../conformance/compile-time-modules/main.forma");
    const source = '(import "./salesforce.forma" [picklist-of])\n(picklist-of LongDeclarationName billing/prices)\n';
    // An unresolved value prevents graph loading and is reported, with a local fallback.
    const result = run(["--stdin", "--stdin-filepath", path], source);
    expect(result.status).toBe(0); expect(result.stderr).toContain("format/module-resolution");
    expect(result.stdout).toContain("picklist-of");
  }, 20_000);
});

test("JSON and language-host formatting share the pure result and located diagnostics", async () => {
  const host = new TsLanguageHost(), abi = new JsonAbi(host);
  const source = "(define  x 'x) ; tail\n";
  expect(await host.format({ source })).toMatchObject({ text: "(define x 'x) ; tail\n", changed: true, diagnostics: [] });
  expect(await abi.handleJson(JSON.stringify({ op: "format", source, language: "forma" }))).toMatchObject({ ok: true, value: { text: "(define x 'x) ; tail\n" }, diagnostics: [] });
  expect(await abi.handleJson(JSON.stringify({ op: "format", source: "(x", sourceId: "bad.forma" }))).toMatchObject({ ok: false, value: { text: "(x", changed: false }, diagnostics: [{ code: "format/parse", severity: "error", span: { sourceId: "bad.forma", startOffset: 0 } }] });
  expect(await abi.handleJson(JSON.stringify({ op: "format", source: "```lisp\n(x\n```\n", language: "markdown" }))).toMatchObject({ ok: true, diagnostics: [{ code: "format/markdown-fragment", severity: "warning" }] });
  expect(await abi.handleJson(JSON.stringify({ op: "format", source, language: "javascript" }))).toMatchObject({ ok: false, diagnostics: [{ code: "abi/invalid-request" }] });
});

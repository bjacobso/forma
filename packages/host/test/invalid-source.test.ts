import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test } from "vitest";
import { diagnosticCatalog } from "@formalang/ts/diagnostic";
import { TsLanguageHost } from "../src/ts-host.js";

const cli = resolve(import.meta.dirname, "../dist/cli.mjs");
const fixtures = resolve(import.meta.dirname, "../../../conformance/invalid-source");
const cases = Object.fromEntries(readdirSync(fixtures).filter(name => name.endsWith(".lisp"))
  .map(name => [name, readFileSync(join(fixtures, name), "utf8")]));

// Prelude syntax is validated during load, before check/run/declarations can
// execute. Ordinary module bindings named `protocol` are not manifests.
for (const name of readdirSync(join(fixtures, "prelude")).filter(name => name.endsWith(".lisp"))) {
  test(`author mistakes in preludes are located during load: ${name}`, async () => {
    const host = new TsLanguageHost();
    const { sessionId } = await host.openSession();
    try {
      const source = readFileSync(join(fixtures, "prelude", name), "utf8");
      const result = await host.loadSource({ sessionId, sourceId: name, source, kind: "prelude" });
      expect(result.diagnostics.length).toBeGreaterThan(0);
      for (const diagnostic of result.diagnostics) {
        expect(diagnostic.code).not.toBe("internal/error");
        expect(diagnosticCatalog.get(diagnostic.code)).toBeDefined();
        expect(diagnostic.span).toMatchObject({ sourceId: name, startLine: expect.any(Number), startColumn: expect.any(Number) });
        expect(diagnostic.message).not.toMatch(/__forma_|\bt\d+\b/);
      }
    } finally {
      await host.closeSession({ sessionId });
    }
  });
}

for (const [name, source] of Object.entries(cases)) {
  test(`author mistakes are located across CLI operations: ${name}`, () => {
    const dir = mkdtempSync(join(tmpdir(), "forma-invalid-"));
    try {
      const file = join(dir, name);
      writeFileSync(file, source);
      for (const args of [["check", "--json"], ["run", "--json"], ["file", "declarations"]]) {
        const result = spawnSync(process.execPath, [cli, ...args, file], { encoding: "utf8", timeout: 10_000 });
        expect(result.status, `${args.join(" ")}: ${result.stderr}`).toBe(1);
        const response = JSON.parse(result.stdout);
        expect(response.ok).toBe(false);
        expect(response.diagnostics.length).toBeGreaterThan(0);
        for (const diagnostic of response.diagnostics) {
          expect(diagnostic.code).not.toBe("internal/error");
          expect(diagnosticCatalog.get(diagnostic.code)).toBeDefined();
          expect(diagnostic.span).toMatchObject({ sourceId: expect.stringContaining(name), startLine: expect.any(Number), startColumn: expect.any(Number) });
          expect(diagnostic.message).not.toMatch(/__forma_|\bt\d+\b/);
        }
        if (name === "form-missing-type.lisp") {
          expect(response.diagnostics[0]).toMatchObject({ code: "elaborate/form-definition", help: expect.stringContaining(":types"), span: { startOffset: source.indexOf("amount)") } });
        }
        if (name === "fn-parameters.lisp") {
          expect(response.diagnostics[0]).toMatchObject({ span: { startOffset: source.indexOf("(x)"), endOffset: source.indexOf("(x)") + 3 } });
        }
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000); // spawns the CLI three times per program; slow under parallel load
}

test("malformed imported functions retain the dependency's location", () => {
  const dir = mkdtempSync(join(tmpdir(), "forma-invalid-import-"));
  try {
    writeFileSync(join(dir, "main.lisp"), '(import "./bad.lisp" [bad])\nbad');
    writeFileSync(join(dir, "bad.lisp"), '(export bad)\n(define bad (fn (x) x))');
    const result = spawnSync(process.execPath, [cli, "check", "--json", join(dir, "main.lisp")], { encoding: "utf8", timeout: 10_000 });
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout).diagnostics[0]).toMatchObject({
      code: "lower/lambda",
      span: { sourceId: expect.stringContaining("bad.lisp"), startLine: 2, startColumn: 17 },
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 30_000);

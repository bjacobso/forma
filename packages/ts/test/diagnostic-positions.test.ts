import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "vitest";
import * as Engine from "../src/Engine.js";

const root = resolve(import.meta.dirname, "../../..");
function jsonFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? jsonFiles(resolve(dir, entry.name)) : entry.name.endsWith(".json") ? [resolve(dir, entry.name)] : []);
}

test("engine positions belong in spans, including multiline end positions", async () => {
  for (const source of ['(+ 1 "nope")', '\n(+ 1 "nope")', '(define x "a\nb")\n(+ 1 x)', '(', 'missing-name', '(fail "boom")', '(define f [x] (+ x 1))\n(f "nope")']) {
    for (const result of [Engine.parse({ source }), Engine.expand({ source }), Engine.typecheck({ source }), Engine.typecheckCore({ source }), await Engine.evaluate({ source })]) {
      for (const diagnostic of result.diagnostics) {
        expect(diagnostic.message).not.toMatch(/\(at (offset|line) | at line \d+, column /);
        if (diagnostic.span) {
          for (const field of ["startLine", "startColumn", "endLine", "endColumn"] as const) {
            expect(diagnostic.span[field], `${source}: ${field}`).toBeGreaterThanOrEqual(1);
          }
        }
      }
    }
  }
  expect(Engine.typecheck({ source: '(+ 1 "nope")' }).diagnostics[0]?.span)
    .toMatchObject({ startLine: 1, startColumn: 6, endLine: 1, endColumn: 12 });
});

test("conformance and surface expectations keep positions out of messages", () => {
  const visit = (value: unknown, file: string): void => {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (key === "message" && typeof child === "string") expect(child, file).not.toMatch(/\(at (offset|line) /);
      else visit(child, file);
    }
  };
  for (const file of jsonFiles(resolve(root, "conformance"))) visit(JSON.parse(readFileSync(file, "utf8")), file);
});

// These are separate public entry points used without a host or JSON adapter.
test("workspace, module checks and descriptor diagnostics project their own source", async () => {
  const { AnalysisWorkspace } = await import("../src/Analysis.js");
  const { resolveModuleGraph, sourceModuleResolver, checkModuleGraph, ModuleError } = await import("../src/Modules.js");
  const { bootstrapFromSources, elaborateProgram } = await import("../src/Descriptor.js");
  const workspace = new AnalysisWorkspace();
  workspace.setDocument("doc.lisp", '\n(+ 1 "nope")');
  expect(workspace.diagnostics("doc.lisp")[0]?.span)
    .toMatchObject({ sourceId: "doc.lisp", startLine: 2, startColumn: 6, endLine: 2, endColumn: 12 });
  const graph = resolveModuleGraph({ id: "main.lisp", source: '(import "./bad.lisp" [x])\nx' }, sourceModuleResolver([
    { id: "bad.lisp", source: '(export x)\n(define x (+ 1 "nope"))' },
  ]));
  expect(checkModuleGraph(graph).diagnostics[0]?.span)
    .toMatchObject({ sourceId: "bad.lisp", startLine: 2, startColumn: 16, endLine: 2, endColumn: 22 });
  try {
    resolveModuleGraph({ id: "main.lisp", source: '\n(import "./missing.lisp" [x])' }, sourceModuleResolver([]));
    expect.fail("expected resolution failure");
  } catch (error) {
    expect(error).toBeInstanceOf(ModuleError);
    expect((error as InstanceType<typeof ModuleError>).diagnostic.span)
      .toMatchObject({ sourceId: "main.lisp", startLine: 2, startColumn: 9, endLine: 2, endColumn: 25 });
  }
  const diagnostic = elaborateProgram('\n(itme A)', { sourceId: "forms.lisp", prelude: bootstrapFromSources("", `
(type ItemIR {:kind "Item" :name Symbol})
(form (item name) :types {:name (Declares Item)} :ir ItemIR {:kind "Item" :name name})`) }).diagnostics[0]!;
  expect(diagnostic.span).toMatchObject({ startLine: 2, startColumn: 1, endLine: 2, endColumn: 9 });
  expect(diagnostic.fix?.[0]?.span).toMatchObject({ startLine: 2, startColumn: 2, endLine: 2, endColumn: 6 });
});

test("module runtime refusal carries the same complete author span", async () => {
  const { resolveModuleGraph, sourceModuleResolver, ModuleRuntime } = await import("../src/Modules.js");
  const source = '\n(service Storage (: read (-> String (Effect String [] []))))';
  const graph = resolveModuleGraph({ id: "effect.lisp", source }, sourceModuleResolver([]));
  await expect(new ModuleRuntime().initialize(graph)).rejects.toMatchObject({
    diagnostic: { code: "module/effect-runtime", span: { startLine: 2, startColumn: 1, endLine: 2, endColumn: source.length } },
  });
});

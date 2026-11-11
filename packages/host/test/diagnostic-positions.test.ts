import { expect, test } from "vitest";
import { TsLanguageHost } from "../src/ts-host.js";
import { JsonAbi } from "../src/json-abi.js";

test("in-process host and JSON share engine positions without message rewriting", async () => {
  const host = new TsLanguageHost();
  const source = '\n(+ 1 "nope")';
  const checked = host.typecheckSync({ source });
  expect(checked.diagnostics[0]?.span).toMatchObject({ startLine: 2, startColumn: 6, endLine: 2, endColumn: 12 });
  const abi = new JsonAbi(host);
  const json = await abi.handleJson(JSON.stringify({ op: "typecheck", source }));
  expect(json.diagnostics).toEqual(checked.diagnostics);
  expect(json.diagnostics[0]?.message).not.toMatch(/\(at (offset|line) /);
  const { sessionId } = await host.openSession();
  const loaded = await host.loadSource({ sessionId, sourceId: "bad.lisp", source: '\n(import)' });
  expect(loaded.diagnostics.length).toBeGreaterThan(0);
  expect(loaded.diagnostics[0]?.span).toMatchObject({ startLine: 2, startColumn: 1, endLine: 2, endColumn: 9 });
  const edited = await host.analyzeEditor({ sourceId: "bad.lisp", source });
  expect(edited.errors[0]?.span).toMatchObject({ startLine: 2, startColumn: 6, endLine: 2, endColumn: 12 });
});

test("syntax identity diagnostics include complete engine positions", () => {
  const result = new TsLanguageHost().identifySyntaxSync({ source: "\n(" });
  expect(result.diagnostics.length).toBeGreaterThan(0);
  expect(result.diagnostics[0]?.span).toMatchObject({ startLine: 2, startColumn: 1, endLine: 2, endColumn: 2 });
});

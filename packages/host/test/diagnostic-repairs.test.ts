import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { JsonAbi } from "../src/json-abi.js";
import { TsLanguageHost } from "../src/ts-host.js";

test("the JSON transport retains atomic symbol repairs", async () => {
  const source = readFileSync(new URL("../../../conformance/diagnostic-repairs/unbound.lisp", import.meta.url), "utf8");
  const abi = new JsonAbi(new TsLanguageHost());
  const response = await abi.handleJson(JSON.stringify({op:"typecheck",sourceId:"unbound.lisp",source}));
  expect(response.diagnostics[0]?.fix).toEqual([{newText:"total",span:{sourceId:"unbound.lisp",startOffset:23,endOffset:27,startLine:2,startColumn:2,endLine:2,endColumn:6}}]);
});

test("annotated mismatches retain related locations in JSON and human output", async () => {
  const { renderDiagnostics } = await import("../src/cli/output.js");
  const source = '(: value Float)\n(define value "nope")';
  const abi = new JsonAbi(new TsLanguageHost());
  const response = await abi.handleJson(JSON.stringify({op:"typecheck",sourceId:"annotation.lisp",source}));
  expect(response.diagnostics[0]?.related?.[0]?.span).toMatchObject({sourceId:"annotation.lisp",startLine:1,startColumn:10});
  expect(renderDiagnostics(response.diagnostics, () => source, false)).toContain("note: Expected type declared here --> annotation.lisp:1:10");
});

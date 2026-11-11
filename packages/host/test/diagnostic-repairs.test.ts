import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { JsonAbi } from "../src/json-abi.js";
import { TsLanguageHost } from "../src/ts-host.js";

test("the JSON transport retains atomic symbol repairs", async () => {
  const source = readFileSync(new URL("../../../conformance/diagnostic-repairs/unbound.lisp", import.meta.url), "utf8");
  const abi = new JsonAbi(new TsLanguageHost());
  const response = await abi.handleJson(JSON.stringify({op:"typecheck",sourceId:"unbound.lisp",source}));
  expect(response.diagnostics[0]?.fix).toEqual([{newText:"total",span:{sourceId:"unbound.lisp",startOffset:23,endOffset:27}}]);
});

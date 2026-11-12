import { expect, test } from "vitest";
import { createLanguage } from "../src/language.js";
import { JsonAbi } from "../src/json-abi.js";
import { TsLanguageHost } from "../src/ts-host.js";
import { renderDiagnostics } from "../src/cli/output.js";
import { evaluate } from "@formalang/ts/engine";

const source = '(: repair (-> Int Int)) (define repair [a] ?todo)';

test("embedding refuses holes and JSON checks retain details", async () => {
  const language = await createLanguage();
  expect(await language.run(source)).toMatchObject({ ok: false, diagnostics: [ { code: "typecheck/hole" } ] });
  const response = await new JsonAbi(new TsLanguageHost()).handleJson(JSON.stringify({op:"typecheck", sourceId:"holes.lisp", source}));
  expect(response.diagnostics[0]).toMatchObject({code:"typecheck/hole", details:{name:"?todo", expected:"Int", candidates:["a"]}});
  expect(renderDiagnostics(response.diagnostics, () => source, false)).toContain("Hole ?todo needs Int; candidates: a");
});

test("unchecked evaluation reports the hole at runtime", async () => {
  const result = await evaluate({ source: "?todo" });
  expect(result.diagnostics[0]?.message).toContain("Cannot evaluate hole ?todo");
});

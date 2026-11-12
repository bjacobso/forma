import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "vitest";
import { bootstrapFromSources } from "../src/descriptor/bootstrap.js";
import { elaborateProgram, elaborateSources, elaborateProgramOrThrow, ElaborationFailure } from "../src/descriptor/elaborate.js";
import { normalizeForm } from "../src/descriptor/normalize.js";
import { recognizeForms } from "../src/descriptor/recognize.js";
import { parse, toSExprMany } from "../src/reader/index.js";
import { InferenceError } from "../src/diagnostic/errors.js";
import { diagnosticFromUnknown } from "../src/diagnostic/diagnostic.js";
import { diagnosticCatalog } from "../src/diagnostic/catalog.js";

const fixture = (name: string) => readFileSync(resolve(import.meta.dirname, "../../../conformance/invalid-source", name), "utf8");

for (const [name, text] of [
  ["descriptor-unknown-slot.lisp", '(:typo "bad")'],
  ["descriptor-child-option.lisp", ":typo"],
] as const) {
  test(`normalization reports a located typed diagnostic: ${name}`, () => {
    const source = fixture(name);
    const prelude = bootstrapFromSources("", source);
    const forms = recognizeForms(toSExprMany(parse(source).redTree), prelude.descriptions);
    expect(forms).toHaveLength(1);
    expect(() => normalizeForm(forms[0]!, prelude.descriptions)).toThrow(InferenceError);
    try { normalizeForm(forms[0]!, prelude.descriptions); }
    catch (error) {
      const diagnostic = diagnosticFromUnknown(error, "elaborate", name);
      expect(diagnostic).toMatchObject({ code: "descriptor/unknown-slot", span: { sourceId: name, startOffset: source.indexOf(text), endOffset: source.indexOf(text) + text.length } });
      expect(diagnosticCatalog.get(diagnostic.code)).toBeDefined();
    }
    const result = elaborateProgram(source, { prelude, sourceId: name });
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: "descriptor/unknown-slot", span: expect.objectContaining({ startOffset: source.indexOf(text) }) }));
  });
}

test("duplicate source forms retain their declaration location", () => {
  const name = "elaboration/form-duplicate.lisp";
  const source = fixture(name);
  const prelude = bootstrapFromSources("", source);
  const result = elaborateProgram(source, { prelude, sourceId: name });
  expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: "elaborate/form-definition", span: expect.objectContaining({ sourceId: name, startOffset: source.indexOf("(form") }) }));
  expect(elaborateSources([{sourceId: "first.lisp", source}, {sourceId: name, source}], {prelude: bootstrapFromSources("", "")} ).diagnostics).toContainEqual(expect.objectContaining({code: "elaborate/form-definition", span: expect.objectContaining({sourceId: name})}));
  expect(() => elaborateProgramOrThrow(source, { prelude, sourceId: name })).toThrow(ElaborationFailure);
});

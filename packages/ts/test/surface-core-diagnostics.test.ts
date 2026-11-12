import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Effect } from "effect";
import { expect, test } from "vitest";
import { parseManyToSExpr } from "../src/Reader.js";
import { normalizeCoreProgram } from "../src/surface/core.js";
import { InferenceError } from "../src/diagnostic/errors.js";
import { diagnosticFromUnknown } from "../src/diagnostic/diagnostic.js";
import { diagnosticCatalog } from "../src/diagnostic/catalog.js";

const cases = [
  ["core-annotation", "(String :unknown true)", "Unknown type metadata :unknown"],
  ["core-class-name", "(class 42 {})", "class requires a name and a record type"],
  ["error-status", "(error Bad {} :status 200)", "error options support :status"],
  ["core-class-field", "{:x Str}", "Use String instead of Str"],
  ["core-numeric-name", "Num", "Num is no longer supported"],
  ["core-tag-payload", ":_tag", "Tagged record payload must be disjoint"],
  ["core-type-body", "(List)", "List expects one type argument"],
  ["core-typeclass", "(-> a Number)", "Number is no longer supported"],
  ["core-instance", "Number", "Number is no longer supported"],
  ["core-let-pattern", "[[]]", "let expects pattern/value pairs"],
  ["fn-parameters", "(x)", "fn parameters must be a vector"],
] as const;

for (const [file, at, message] of cases) {
  test(`core surface errors are typed and located: ${file}`, () => {
    const sourceId = `${file}.lisp`;
    const source = readFileSync(resolve(import.meta.dirname, "../../../conformance/invalid-source", sourceId), "utf8");
    const expressions = Effect.runSync(parseManyToSExpr(source));
    let caught: unknown;
    try { normalizeCoreProgram(expressions); } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(InferenceError);
    const diagnostic = diagnosticFromUnknown(caught, "elaborate", sourceId);
    expect(diagnostic).toMatchObject({
      code: file === "fn-parameters" ? "lower/lambda" : "surface/invalid-form",
      message: expect.stringContaining(message),
      span: { sourceId, startOffset: source.indexOf(at), endOffset: source.indexOf(at) + at.length },
    });
    expect(diagnosticCatalog.get(diagnostic.code)).toBeDefined();
  });
}

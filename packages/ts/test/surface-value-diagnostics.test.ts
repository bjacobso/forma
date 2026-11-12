import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Effect } from "effect";
import { expect, test } from "vitest";
import { parseManyToSExpr } from "../src/Reader.js";
import { bootstrapFromSources } from "../src/descriptor/bootstrap.js";
import { elaborateProgram } from "../src/descriptor/elaborate.js";
import { parsePrelude } from "../src/descriptor/meta-fn-decl.js";
import { contractErrors } from "../src/surface/contract.js";
import { typeDefinition, resolveTypeAlias } from "../src/surface/type-alias.js";
import { InferenceError } from "../src/diagnostic/errors.js";
import { diagnosticFromUnknown } from "../src/diagnostic/diagnostic.js";
import { diagnosticCatalog } from "../src/diagnostic/catalog.js";

for (const [file, message] of [
  ["contract-label", "Record type labels must be keywords or strings"],
  ["alias-cycle", "Cyclic type alias"],
  ["alias-arity", "Type Box expects 1 arguments"],
] as const) {
  test(`surface values produce typed source errors: ${file}`, () => {
    const sourceId = `${file}.lisp`;
    const source = readFileSync(resolve(import.meta.dirname, "../../../conformance/invalid-source", sourceId), "utf8");
    const expressions = Effect.runSync(parseManyToSExpr(source));
    const types = new Map(expressions.flatMap(expr => { const definition = typeDefinition(expr); return definition ? [definition] : []; }));
    let caught: unknown;
    try {
      if (file === "contract-label") contractErrors(new Map([[":field", "ok"]]), types.get("IR")!, types);
      else resolveTypeAlias(types.get(file === "alias-cycle" ? "First" : "IR")!, types);
    } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(InferenceError);
    const diagnostic = diagnosticFromUnknown(caught, "elaborate", sourceId);
    expect(diagnostic).toMatchObject({
      code: "surface/invalid-form", message: expect.stringContaining(message),
      span: { sourceId, startLine: expect.any(Number), startColumn: expect.any(Number) },
    });
    expect(diagnosticCatalog.get(diagnostic.code)).toBeDefined();
    if (file !== "alias-arity") {
      const prelude = bootstrapFromSources("", source);
      const result = elaborateProgram("(sample)", {prelude, sourceId});
      expect(result.diagnostics[0]).toMatchObject({
        code:"elaborate/construct-failed",message:expect.stringContaining(message),
        span:{sourceId,startLine:1,startColumn:1},
      });
    } else {
      expect(() => parsePrelude(source, undefined, [], sourceId)).toThrow(message);
    }
  });
}

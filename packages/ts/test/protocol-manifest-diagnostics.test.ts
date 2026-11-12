import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "vitest";
import { InferenceError } from "../src/diagnostic/errors.js";
import { diagnosticFromUnknown } from "../src/diagnostic/diagnostic.js";
import { diagnosticCatalog } from "../src/diagnostic/catalog.js";
import { parsePrelude } from "../src/descriptor/meta-fn-decl.js";

for (const [name, at, message] of [
  ["protocol-field.lisp", ":unknown", "Unknown protocol manifest field :unknown"],
  ["protocol-name.lisp", "{:imports []}", "Protocol manifests require a name"],
  ["protocol-value.lisp", "(quote [])", "Protocol manifest values must be literals or vectors of literals"],
]) {
  test(`protocol manifest validation is typed and located: ${name}`, () => {
    const source = readFileSync(resolve(import.meta.dirname, "../../../conformance/invalid-source/prelude", name!), "utf8");
    try {
      parsePrelude(source, undefined, [], name!);
      expect.fail("Expected an invalid manifest to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(InferenceError);
      const diagnostic = diagnosticFromUnknown(error, "elaborate", name!);
      expect(diagnostic).toMatchObject({
        code: "surface/invalid-form",
        message,
        span: { sourceId: name, startOffset: source.indexOf(at!), endOffset: source.indexOf(at!) + at!.length, startLine: 1 },
      });
      expect(diagnosticCatalog.get(diagnostic.code)).toBeDefined();
    }
  });
}

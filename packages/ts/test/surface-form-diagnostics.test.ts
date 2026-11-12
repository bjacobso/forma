import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "vitest";
import { InferenceError } from "../src/diagnostic/errors.js";
import { diagnosticFromUnknown } from "../src/diagnostic/diagnostic.js";
import { diagnosticCatalog } from "../src/diagnostic/catalog.js";
import { parsePrelude } from "../src/descriptor/meta-fn-decl.js";

const cases = [
  [
    "surface-form-shape",
    "form expects"
  ],
  [
    "form-key",
    "expected a :key"
  ],
  [
    "surface-form-option",
    "unknown option"
  ],
  [
    "form-duplicate-option",
    "duplicate option"
  ],
  [
    "form-required",
    "requires :types"
  ],
  [
    "form-ir",
    "unknown IR type"
  ],
  [
    "form-type-key",
    "keys must be keywords"
  ],
  [
    "form-duplicate-type",
    "Duplicate hole type"
  ],
  [
    "form-numeric-type",
    "Number is no longer supported"
  ],
  [
    "form-duplicate-variable",
    "duplicate pattern variable"
  ],
  [
    "surface-form-missing-type",
    "missing type"
  ],
  [
    "form-options-pattern",
    "options pattern must be"
  ],
  [
    "form-option-name",
    "option names must be symbols"
  ],
  [
    "form-repeated-hole",
    "repeated form hole must be final"
  ],
  [
    "form-pattern-literal",
    "Form patterns contain"
  ],
  [
    "surface-form-extra-type",
    "type for unknown hole"
  ],
  [
    "form-extensions",
    ":extensions expects"
  ],
  [
    "form-examples",
    ":examples expects"
  ]
] as const;
for (const [file, message] of cases) {
  test(`form definitions are typed and located: ${file}`, () => {
    const sourceId = `${file}.lisp`;
    const source = readFileSync(resolve(import.meta.dirname, "../../../conformance/invalid-source", sourceId), "utf8");
    let caught: unknown;
    try { parsePrelude(source, undefined, [], sourceId); } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(InferenceError);
    const diagnostic = diagnosticFromUnknown(caught, "elaborate", sourceId);
    expect(diagnostic).toMatchObject({
      code: "elaborate/form-definition", message: expect.stringContaining(message),
      span: { sourceId, startLine: 2, startColumn: expect.any(Number) },
    });
    expect(diagnosticCatalog.get(diagnostic.code)).toBeDefined();
  });
}

import { Effect } from "effect";
import { parseManyToSExpr } from "../src/Reader.js";
import { normalizeUnifiedForm } from "../src/surface/form.js";
const applications = [
  [
    "form-unknown-option",
    "Unknown option"
  ],
  [
    "form-duplicate-argument",
    "Duplicate option"
  ],
  [
    "form-option-value",
    "needs a value"
  ],
  [
    "form-required-option",
    "Missing required option"
  ],
  [
    "form-positional",
    "Missing positional argument"
  ],
  [
    "form-too-many",
    "Too many positional arguments"
  ],
  [
    "form-string-identifier",
    "must be a string"
  ],
  [
    "form-symbol-identifier",
    "must be a symbol"
  ]
] as const;
for (const [file, message] of applications) {
  test(`form applications are typed and located: ${file}`, () => {
    const sourceId = `${file}.lisp`;
    const source = readFileSync(resolve(import.meta.dirname, "../../../conformance/invalid-source", sourceId), "utf8");
    const descriptor = parsePrelude(source, undefined, [], sourceId).forms.find(form => form.name === "sample")!;
    const application = Effect.runSync(parseManyToSExpr(source)).at(-1)!;
    let caught: unknown;
    try { normalizeUnifiedForm(descriptor, application); } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(InferenceError);
    const diagnostic = diagnosticFromUnknown(caught, "elaborate", sourceId);
    expect(diagnostic).toMatchObject({
      code: "elaborate/malformed-form", message: expect.stringContaining(message),
      span: { sourceId, startLine: 3, startColumn: expect.any(Number) },
    });
    expect(diagnosticCatalog.get(diagnostic.code)).toBeDefined();
  });
}

import { Exit, Cause } from "effect";
import { bootstrapFromSources } from "../src/descriptor/bootstrap.js";
import { elaborateProgram } from "../src/descriptor/elaborate.js";
import { unifiedFormHooks } from "../src/surface/form.js";
import { SimpleSemanticEnvironment } from "../src/descriptor/SemanticEnvironment.js";
const hookResults = [
  [
    "form-check-list",
    ":check must return a list"
  ],
  [
    "form-check-record",
    "Each :check diagnostic must be a record"
  ],
  [
    "form-check-severity",
    "Invalid diagnostic severity"
  ],
  [
    "form-check-code",
    "Diagnostic code must be a string"
  ],
  [
    "form-check-details",
    "Diagnostic details must be a record"
  ],
  [
    "form-check-help",
    "Diagnostic help must be a string"
  ],
  [
    "form-check-fix",
    "Diagnostic fix must be a list"
  ],
  [
    "form-check-edit",
    "Diagnostic edits require authored"
  ],
  [
    "form-construct-result",
    "payload must be a record"
  ],
  [
    "form-scope-result",
    ":scope must return a record"
  ]
] as const;
for (const [file, message] of hookResults) {
  test(`authored hook results fail without Effect defects: ${file}`, () => {
    const sourceId = `${file}.lisp`;
    const source = readFileSync(resolve(import.meta.dirname, "../../../conformance/invalid-source", sourceId), "utf8");
    const prelude = bootstrapFromSources("", source);
    const descriptor = prelude.descriptions.get("sample")!;
    const application = Effect.runSync(parseManyToSExpr(source)).at(-1)!;
    const normalized = normalizeUnifiedForm(descriptor, application);
    const kind = file === "form-construct-result" ? "construct" : "validate";
    const hook = unifiedFormHooks(descriptor, prelude.descriptions).find(hook => hook.kind === kind)!;
    const exit = Effect.runSyncExit(hook.execute({ ...normalized, normalizedSlots: normalized.slots, semanticEnv: new SimpleSemanticEnvironment() }));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.hasDies(exit.cause)).toBe(false);
      expect(String(Cause.squash(exit.cause))).toContain(message);
    }
    const result = elaborateProgram(source.split("\n").filter(Boolean).at(-1)!, {prelude, sourceId});
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]).toMatchObject({
      code: kind === "construct" ? "elaborate/construct-failed" : "elaborate/validation-failed",
      message: expect.stringContaining(message),
      span: {sourceId, startLine: 1, startColumn: 1},
    });
  });
}

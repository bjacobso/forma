import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Effect } from "effect";
import { expect, test } from "vitest";
import { parseManyToSExpr } from "../src/Reader.js";
import { generateEffectProgram } from "../src/mechanics/elaborate.js";
import { lowerActionProgram } from "../src/surface/action.js";
import { lowerOntologyOperations } from "../src/surface/ontology-effect.js";
import { InferenceError } from "../src/diagnostic/errors.js";
import { diagnosticFromUnknown } from "../src/diagnostic/diagnostic.js";
import { diagnosticCatalog } from "../src/diagnostic/catalog.js";

const actions = [
  [
    "action-duplicate-signature",
    "Duplicate Action signature"
  ],
  [
    "action-definition",
    "requires exactly one definition"
  ],
  [
    "action-parameters",
    "parameters must match"
  ],
  [
    "action-body",
    "requires a body"
  ],
  [
    "action-bindings",
    "requires binding/value pairs"
  ],
  [
    "action-let-bindings",
    ":let requires binding/value pairs"
  ],
  [
    "action-match",
    "match requires pattern/body pairs"
  ],
  [
    "action-link",
    "link! requires a relation"
  ],
  [
    "action-instantiate",
    "instantiate! requires a document"
  ],
  [
    "action-task",
    "task! requires an entity"
  ],
  [
    "action-implicit-id",
    "requires an Id with a known entity type"
  ],
  [
    "action-entity",
    "requires an entity symbol"
  ],
  [
    "action-arguments",
    "has invalid arguments"
  ]
] as const;
const ontology = [
  [
    "ontology-runtime",
    "OntologyRuntime is the service"
  ],
  [
    "ontology-collision",
    "conflicts with an existing declaration"
  ],
  [
    "ontology-id",
    "Id requires a declared entity"
  ],
  [
    "ontology-entity",
    "entity requires a name"
  ],
  [
    "ontology-duplicate",
    "Duplicate entity"
  ],
  [
    "ontology-relation",
    "relation requires a name"
  ],
  [
    "ontology-reserved-id",
    "reserves the id field"
  ],
  [
    "ontology-operation",
    "requires a declared entity"
  ],
  [
    "ontology-link",
    "link! requires a declared relation"
  ]
] as const;
for (const [cases, lower] of [[actions, lowerActionProgram], [ontology, lowerOntologyOperations]] as const) {
  for (const [file, message] of cases) {
    test(`ontology surface errors are typed and located: ${file}`, () => {
      const sourceId = `${file}.lisp`;
      const source = readFileSync(resolve(import.meta.dirname, "../../../conformance/invalid-source", sourceId), "utf8");
      const expressions = Effect.runSync(parseManyToSExpr(source));
      let caught: unknown;
      try { lower(expressions); } catch (error) { caught = error; }
      expect(caught).toBeInstanceOf(InferenceError);
      const diagnostic = diagnosticFromUnknown(caught, "elaborate", sourceId);
      expect(diagnostic).toMatchObject({
        code: "surface/invalid-form", message: expect.stringContaining(message),
        span: { sourceId, startLine: expect.any(Number), startColumn: expect.any(Number) },
      });
      expect(diagnosticCatalog.get(diagnostic.code)).toBeDefined();
      const generated = generateEffectProgram(source, {sourceId});
      expect(generated.ok).toBe(false);
      expect(generated.diagnostics[0]).toMatchObject({
        code: "surface/invalid-form", message: expect.stringContaining(message),
        span: {sourceId, startLine: expect.any(Number), startColumn: expect.any(Number)},
      });
    });
  }
}

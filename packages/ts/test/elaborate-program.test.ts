import { describe, expect, test } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { relative, resolve } from "node:path";
import {
  ElaborationFailure,
  declarationDiagnostic,
  elaborateProgram,
  elaborateProgramOrThrow,
  formatDiagnostic,
  isJsonRuntimeStringLiteral,
  toJsonValue,
} from "../src/Descriptor.js";
import { bootstrapOntologyPreludes } from "../src/Preludes.js";

const prelude = bootstrapOntologyPreludes();

const fieldService = `(define-entity Technician
  (:field [technician/name String {:required true}]))

(define-relation assigned-to WorkOrder Technician)

(define-entity WorkOrder
  (:field [work-order/status String {:required true}]))

(define-action close-order
  (:input [order String {:required true}])
  (:returns String)
  (:do (set order :work-order/status "closed")))

(define-datalog-query open-orders
  (:query {:find ["?o"] :where [["?o" ":work-order/status" "open"]]}))
`;

describe("elaborateProgram", () => {
  test("elaborates every form to a JSON payload with a summary and span", () => {
    const result = elaborateProgram(fieldService, { prelude, sourceId: "field-service.lisp" });
    expect(result.diagnostics).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.declarations.map((d) => [d.formName, d.summary.kind, d.summary.name])).toEqual([
      ["define-entity", "Entity", "Technician"],
      ["define-relation", "Relation", "assigned-to"],
      ["define-entity", "Entity", "WorkOrder"],
      ["define-action", "Action", "close-order"],
      ["define-datalog-query", "Query", "open-orders"],
    ]);

    const [technician, relation] = result.declarations;
    expect(technician!.span).toEqual({
      sourceId: "field-service.lisp",
      startOffset: 0,
      endOffset: 79,
      startLine: 1,
      startColumn: 1,
      endLine: 2,
      endColumn: 54,
    });
    expect(technician!.formIndex).toBe(0);
    expect(technician!.payload).toMatchObject({
      kind: "Entity",
      fields: [{ name: "technician/name", type: "String", required: true }],
    });
    // Forward references resolve because every name is declared before construction.
    expect(relation!.payload).toMatchObject({ source: "WorkOrder", target: "Technician" });
    expect(JSON.parse(JSON.stringify(result.declarations))).toEqual(result.declarations);
  });

  test("keeps runtime string literals distinguishable in JSON", () => {
    const [, , , action] = elaborateProgramOrThrow(fieldService, { prelude });
    const body = (action!.payload as { do: { expr: unknown[] } }).do.expr;
    expect(body.slice(0, 3)).toEqual(["set", "order", ":work-order/status"]);
    expect(isJsonRuntimeStringLiteral(body[3] as never)).toBe(true);
    expect(isJsonRuntimeStringLiteral("order")).toBe(false);
  });

  test("reports located diagnostics per form and keeps the rest", () => {
    const source = [
      "(define-entity A (:field [a/x String]))",
      "(frobnicate 1)",
      "(define-relation r A)",
      "(define-query q (:select [a/x]))",
      "(define-entity A (:field [a/y String]))",
      "(define-datalog-query later (:query {:find [] :where []}))",
    ].join("\n");
    const result = elaborateProgram(source, { prelude, sourceId: "model.lisp" });
    expect(result.ok).toBe(false);
    expect(result.declarations.map((d) => d.summary.name)).toEqual(["A", "later"]);
    expect(
      result.diagnostics.map((d) => [d.code, d.span?.startLine, d.span?.startColumn, d.message]),
    ).toEqual([
      ["elaborate/unknown-form", 2, 1, "Unknown form 'frobnicate'"],
      ["elaborate/duplicate-declaration", 5, 1, "'A' is already declared by define-entity"],
      ["elaborate/missing-identifier", 3, 1, "define-relation is missing its target"],
      ["elaborate/missing-slot", 4, 1, "define-query requires :from"],
    ]);
    expect(result.diagnostics.every((d) => d.phase === "elaborate")).toBe(true);
    expect(result.diagnostics[2]!.details).toEqual({ form: "define-relation", declaration: "r" });
  });

  test("restricts top-level forms when asked", () => {
    const result = elaborateProgram(fieldService, {
      prelude,
      forms: ["define-entity", "define-relation"],
    });
    expect(result.declarations).toHaveLength(3);
    expect(result.diagnostics.map((d) => [d.code, d.span?.startLine])).toEqual([
      ["elaborate/unsupported-form", 9],
      ["elaborate/unsupported-form", 14],
    ]);
  });

  test("reports parse errors with their location", () => {
    const result = elaborateProgram("(define-entity A\n  (:field [a/x String]", { prelude });
    expect(result.ok).toBe(false);
    expect(result.declarations).toEqual([]);
    expect(result.diagnostics[0]).toMatchObject({ code: "parse/syntax", phase: "parse" });
    expect(result.diagnostics[0]!.span?.sourceId).toBe("source.forma");
  });

  test("throws a single failure carrying every diagnostic", () => {
    const run = () => elaborateProgramOrThrow("(define-entity A)\n(nope)", { prelude, sourceId: "m.lisp" });
    expect(run).toThrow(ElaborationFailure);
    try {
      run();
    } catch (error) {
      const failure = error as ElaborationFailure;
      expect(failure.message).toBe(
        "m.lisp:2:1: Unknown form 'nope'\nm.lisp:1:1: define-entity requires :field",
      );
      expect(failure.span?.startLine).toBe(2);
      expect(failure.diagnostics).toHaveLength(2);
    }
  });

  test("lets hosts anchor their own checks to a declaration", () => {
    const [entity] = elaborateProgramOrThrow(fieldService, { prelude, sourceId: "m.lisp" });
    const diagnostic = declarationDiagnostic(entity!, "host/unknown-ref", "Unknown ref", "warning");
    expect(diagnostic).toMatchObject({
      code: "host/unknown-ref",
      severity: "warning",
      phase: "elaborate",
      details: { form: "define-entity", declaration: "Technician" },
    });
    expect(formatDiagnostic(diagnostic)).toBe("m.lisp:1:1: Unknown ref");
  });

  test("converts construct values to plain JSON", () => {
    expect(
      toJsonValue(
        new Map<string, unknown>([
          ["list", [1, new Set(["a"])]],
          ["missing", undefined],
          ["nan", Number.NaN],
          ["nested", new Map([["k", true]])],
        ]),
      ),
    ).toEqual({ list: [1, ["a"]], missing: null, nan: null, nested: { k: true } });
  });

  test("elaborates the example corpus without unexpected diagnostics", () => {
    const examples = resolve(import.meta.dirname, "../../../examples");
    const markdown = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = resolve(dir, entry.name);
        if (entry.isDirectory()) return entry.name === "shared" ? [] : markdown(path);
        return entry.name.endsWith(".md") ? [path] : [];
      });
    const moduleForms = new Set(["import", "export", "export-from", "test", "test-suite"]);
    // These examples need host-provided builtins or are intentionally invalid.
    const excluded = new Set(["compiler-debug/http-api.md", "compiler-debug/invalid-query.md"]);

    let declarations = 0;
    for (const path of markdown(examples)) {
      const sourceId = relative(examples, path);
      if (excluded.has(sourceId)) continue;
      const blocks = [...readFileSync(path, "utf8").matchAll(/```(?:lisp|clojure|clj)\n([\s\S]*?)```/g)]
        .map((match) => match[1]!)
        .filter((block) => !/^\s*\(ontology[\s)]/.test(block));
      if (blocks.length === 0) continue;
      const result = elaborateProgram(blocks.join("\n"), { prelude, sourceId });
      const unexpected = result.diagnostics.filter(
        (d) => !(d.code === "elaborate/unknown-form" && moduleForms.has(String(d.details?.["form"]))),
      );
      expect(unexpected.map(formatDiagnostic), sourceId).toEqual([]);
      declarations += result.declarations.length;
    }
    expect(declarations).toBeGreaterThan(500);
  });
});

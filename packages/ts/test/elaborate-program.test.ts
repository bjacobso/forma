import { describe, expect, test } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { relative, resolve } from "node:path";
import {
  ElaborationFailure,
  declarationDiagnostic,
  elaborateProgram,
  elaborateSources,
  elaborateProgramOrThrow,
  formatDiagnostic,
  isJsonRuntimeStringLiteral,
  toJsonValue,
} from "../src/Descriptor.js";
import { packageArtifact } from "../src/Artifact.js";
import { bootstrapOntologyPreludes, preludeSource } from "../src/Preludes.js";
import { openSession } from "../src/Session.js";

const prelude = bootstrapOntologyPreludes();

const fieldService = `(entity Technician
  {:name String})

(relation assigned-to WorkOrder Technician {})

(entity WorkOrder
  {:status String})

(: close-order (-> (Id WorkOrder) (Action Unit)))
(define close-order [order]
  (update! WorkOrder order {:status "closed"}))

(datalog-query open-orders
  {:find [?o] :where [[?o :work-order/status "open"]]})
`;

describe("elaborateProgram", () => {
  test("elaborates every form to a JSON payload with a summary and span", () => {
    const result = elaborateProgram(fieldService, { prelude, sourceId: "field-service.lisp" });
    expect(result.diagnostics).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.declarations.map((d) => [d.formName, d.summary.kind, d.summary.name])).toEqual([
      ["entity", "Entity", "Technician"],
      ["relation", "Relation", "assigned-to"],
      ["entity", "Entity", "WorkOrder"],
      ["__action", "Action", "close-order"],
      ["datalog-query", "Query", "open-orders"],
    ]);

    const [technician, relation] = result.declarations;
    expect(technician!.span).toEqual({
      sourceId: "field-service.lisp",
      startOffset: 0,
      endOffset: fieldService.indexOf("\n\n"),
      startLine: 1,
      startColumn: 1,
      endLine: 2,
      endColumn: 18,
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
    expect(body.slice(0, 3)).toEqual(["update!", "WorkOrder", "order"]);
    expect(isJsonRuntimeStringLiteral((body[3] as Record<string, never>)["status"])).toBe(true);
    expect(isJsonRuntimeStringLiteral("order")).toBe(false);
  });

  test("reports located diagnostics per form and keeps the rest", () => {
    const source = [
      "(entity A {:x String})",
      "(frobnicate 1)",
      "(relation r A)",
      "(query q :select [x])",
      "(entity A {:y String})",
      "(datalog-query later {:find [] :where []})",
    ].join("\n");
    const result = elaborateProgram(source, { prelude, sourceId: "model.lisp" });
    expect(result.ok).toBe(false);
    expect(result.declarations.map((d) => d.summary.name)).toEqual(["A", "later"]);
    expect(
      result.diagnostics.map((d) => [d.code, d.span?.startLine, d.span?.startColumn, d.message]),
    ).toEqual([
      ["elaborate/unknown-form", 2, 1, "Unknown form 'frobnicate'"],
      ["elaborate/malformed-form", 3, 1, "Missing positional argument target"],
      ["elaborate/malformed-form", 4, 1, "Missing required option :from"],
      ["elaborate/duplicate-declaration", 5, 1, "'A' is already declared by entity"],
    ]);
    expect(result.diagnostics.every((d) => d.phase === "elaborate")).toBe(true);
    expect(result.diagnostics[1]!.details).toEqual({ form: "relation" });
  });

  test("restricts top-level forms when asked", () => {
    const result = elaborateProgram(fieldService, {
      prelude,
      forms: ["entity", "relation"],
    });
    expect(result.declarations).toHaveLength(3);
    expect(result.diagnostics.map((d) => [d.code, d.span?.startLine])).toEqual([
      ["elaborate/unsupported-form", 10],
      ["elaborate/unsupported-form", 13],
    ]);
  });

  test("reports parse errors with their location", () => {
    const result = elaborateProgram("(entity A\n  {:x String", { prelude });
    expect(result.ok).toBe(false);
    expect(result.declarations).toEqual([]);
    expect(result.diagnostics[0]).toMatchObject({ code: "parse/syntax", phase: "parse" });
    expect(result.diagnostics[0]!.span?.sourceId).toBe("source.forma");
  });

  test("throws a single failure carrying every diagnostic", () => {
    const run = () => elaborateProgramOrThrow("(entity A)\n(nope)", { prelude, sourceId: "m.lisp" });
    expect(run).toThrow(ElaborationFailure);
    try {
      run();
    } catch (error) {
      const failure = error as ElaborationFailure;
      expect(failure.message).toBe(
        "m.lisp:1:1: Missing positional argument fields\nm.lisp:2:1: Unknown form 'nope'",
      );
      expect(failure.span?.startLine).toBe(1);
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
      details: { form: "entity", declaration: "Technician" },
    });
    expect(formatDiagnostic(diagnostic)).toBe("m.lisp:1:1: Unknown ref");
  });

  test("maps payload paths back to authored child forms", () => {
    const [entity] = elaborateProgramOrThrow(fieldService, { prelude });
    expect(entity!.origin).toEqual({ kind: "authored" });
    expect(entity!.payloadContract).toBe("EntityDeclarationIR");
    expect(entity!.sourceMap.map((entry) => [entry.path, entry.span.startLine, entry.span.startColumn])).toEqual([
      ["", 1, 1],
      ["/fields/0", 2, 4],
    ]);
  });

  test("expands top-level macros defined in the source and records their origin", () => {
    const source = [
      "(macro (named name field)",
      "  `(entity ~name {~field String}))",
      "(macro (pair a b)",
      "  `(do (entity ~a {:a/x String}) (entity ~b {:b/x String})))",
      "(named Person :person/name)",
      "(pair Left Right)",
    ].join("\n");
    const result = elaborateProgram(source, { prelude, sourceId: "m.lisp" });
    expect(result.diagnostics).toEqual([]);
    expect(result.declarations.map((d) => [d.summary.name, d.span.startLine, d.formIndex])).toEqual([
      ["Person", 5, 2],
      ["Left", 6, 3],
      ["Right", 6, 3],
    ]);
    const [person] = result.declarations;
    expect(person!.payload).toMatchObject({ fields: [{ name: "person/name", required: true }] });
    expect(person!.origin).toEqual({
      kind: "expanded",
      macros: [{ macroName: "named", span: person!.span }],
    });
    expect(person!.sourceMap.every((entry) => entry.span.startLine === 5)).toBe(true);
  });

  test("reports macro expansion failures at the call", () => {
    const result = elaborateProgram(
      "(macro (broken x) (car-of-nothing x))\n(broken 1)",
      { prelude, sourceId: "m.lisp" },
    );
    expect(result.diagnostics.map((d) => [d.code, d.span?.startLine])).toEqual([
      ["elaborate/expansion-failed", 2],
    ]);
  });

  test("packages elaborated declarations with their source maps", () => {
    const session = openSession({ id: "elaborate-test" });
    session.rememberSource({ id: "field-service.lisp", text: fieldService });
    const declarations = elaborateProgramOrThrow(fieldService, {
      prelude,
      sourceId: "field-service.lisp",
    });
    const result = packageArtifact({ engineName: "test", engineVersion: "0", session, declarations });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [entity] = result.artifact.declarations;
    expect(entity).toMatchObject({
      declarationId: "Entity:Technician",
      origin: { kind: "authored" },
      sourceMap: [{ path: "" }, { path: "/fields/0" }],
    });
    expect(entity!.sourceHash).not.toBe("");
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
    const groups=new Map<string,{sourceId:string;source:string}[]>();
    for (const path of markdown(examples)) {
      const sourceId = relative(examples, path);
      if (excluded.has(sourceId)) continue;
      const blocks = [...readFileSync(path, "utf8").matchAll(/```(?:lisp|clojure|clj)\n([\s\S]*?)```/g)]
        .map((match) => match[1]!)
        .filter((block) => !/^\s*\(ontology[\s)]/.test(block));
      if (blocks.length === 0) continue;
      const group=sourceId.split("/")[0]!;
      groups.set(group,[...(groups.get(group) ?? []),{sourceId,source:blocks.join("\n")}]);
    }
    for (const [sourceId,sources] of groups) {
      const result = elaborateSources([{sourceId:"system",source:preludeSource("system.lisp")},...sources], { prelude });
      const unexpected = result.diagnostics.filter(
        (d) => !(d.code === "elaborate/unknown-form" && moduleForms.has(String(d.details?.["form"]))),
      );
      expect(unexpected.map(formatDiagnostic), sourceId).toEqual([]);
      declarations += result.declarations.length;
    }
    expect(declarations).toBeGreaterThan(500);
  },60_000);
});

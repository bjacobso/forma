import { describe, expect, test } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { relative, resolve } from "node:path";
import { formatDiagnostic } from "../src/Descriptor.js";
import {
  elaborateOntology,
  parseOntologyType,
  runtimeLiteralsToStrings,
} from "../src/Ontology.js";
import { preludeSource } from "../src/Preludes.js";

const supportDesk = `(entity Customer
  {:name String}
  :doc "An organisation that raises tickets.")

(entity Ticket
  {:title (String :indexed true)
   :customer (Id Customer)
   :owner (Option (Id Customer))
   :tags (Option (List String))})

(relation escalated-to Ticket Customer {:at Int})

(: close-ticket (-> (Id Ticket) (Option (List (Id Customer))) (Action Unit)))
(define close-ticket [ticket watchers]
  (update! Ticket ticket {:title "closed"}))

(query titles :from Ticket :select [title])

(datalog-query open-work {:find [?title] :where [[?t :ticket/title ?title]]})
`;

describe("elaborateOntology", () => {
  test("decodes ontology forms into typed declarations", () => {
    const { ok, model, diagnostics } = elaborateOntology(supportDesk, { sourceId: "desk.lisp" });
    expect(diagnostics).toEqual([]);
    expect(ok).toBe(true);

    const [customer, ticket] = model.entities;
    expect(customer).toMatchObject({
      kind: "Entity",
      name: "Customer",
      doc: "An organisation that raises tickets.",
      span: { sourceId: "desk.lisp", startLine: 1, endLine: 3 },
    });
    expect(ticket!.origin).toEqual({ kind: "authored" });
    expect(ticket!.fields.map((f) => f.span?.startLine)).toEqual([6, 7, 8, 9]);
    expect(ticket!.fields.map(({ span: _span, ...f }) => f)).toEqual([
      { name: "ticket/title", type: { kind: "scalar", name: "String" }, required: true, indexed: true },
      { name: "ticket/customer", type: { kind: "ref", target: "Customer" }, required: true, indexed: false },
      { name: "ticket/owner", type: { kind: "ref", target: "Customer" }, required: false, indexed: false },
      {
        name: "ticket/tags",
        type: { kind: "list", item: { kind: "scalar", name: "String" } },
        required: false,
        indexed: false,
      },
    ]);

    expect(model.relations).toMatchObject([
      { kind: "Relation", name: "escalated-to", source: "Ticket", target: "Customer" },
    ]);

    const [action] = model.actions;
    expect(action!.inputs.map((i) => i.span?.startLine)).toEqual([14, 14]);
    expect(action!.inputs.map(({ span: _span, ...i }) => i)).toEqual([
      { name: "ticket", type: { kind: "ref", target: "Ticket" }, required: true },
      {
        name: "watchers",
        type: { kind: "list", item: { kind: "ref", target: "Customer" } },
        required: false,
      },
    ]);
    expect(action!.body).toEqual([
      "update!",
      "Ticket",
      "ticket",
      {title:{ "$forma.runtimeExpr": "string-literal", value: "closed" }},
    ]);

    expect(model.queries).toMatchObject([
      { name: "titles", from: "Ticket", select: ["ticket/title"] },
      {
        name: "open-work",
        from: "*",
        datalog: { find: ["?title"], where: [["?t", ":ticket/title", "?title"]] },
      },
    ]);
    expect(model.others).toEqual([]);
  });

  test("reports unknown references and duplicate fields at the declaration", () => {
    const { ok, diagnostics } = elaborateOntology(
      [
        "(entity A {:x String :x Int :b (Id Missing)})",
        "(relation r A Ghost {})",
        "(query q :from Nowhere)",
      ].join("\n"),
      { sourceId: "m.lisp" },
    );
    expect(ok).toBe(false);
    expect(diagnostics.map((d) => [d.code, formatDiagnostic(d)])).toEqual([
      ["elaborate/hole-type", "m.lisp:2:15: Unknown reference Ghost"],
      ["elaborate/hole-type", "m.lisp:3:16: Unknown reference Nowhere"],
      ["ontology/duplicate-field", "m.lisp:1:1: A declares a/x twice"],
      ["ontology/unknown-type", "m.lisp:1:1: a/b refers to unknown type Missing"],
    ]);
  });

  test("resolves references across sources", () => {
    const { ok, model, diagnostics } = elaborateOntology([
      { sourceId: "queries.lisp", source: "(query everyone :from Person)" },
      { sourceId: "entities.lisp", source: "(entity Person {:name String})" },
    ]);
    expect(diagnostics).toEqual([]);
    expect(ok).toBe(true);
    expect(model.queries[0]!.span.sourceId).toBe("queries.lisp");
    expect(model.entities[0]!.span.sourceId).toBe("entities.lisp");
  });

  test("parses type expressions and unwraps runtime literals", () => {
    expect(parseOntologyType(["Set", ["Id", "User"]])).toEqual({
      kind: "set",
      item: { kind: "ref", target: "User" },
    });
    expect(parseOntologyType(["Map", "String", "Int"])).toEqual({
      kind: "apply",
      constructor: "Map",
      args: [
        { kind: "scalar", name: "String" },
        { kind: "scalar", name: "Int" },
      ],
    });
    expect(
      runtimeLiteralsToStrings(["a", { "$forma.runtimeExpr": "string-literal", value: "b" }]),
    ).toEqual(["a", "b"]);
  });

  test("elaborates each example ontology with the system entities", () => {
    const examples = resolve(import.meta.dirname, "../../../examples");
    const system = { sourceId: "preludes/system.lisp", source: preludeSource("system.lisp") };
    const groups = new Map<string, { sourceId: string; source: string }[]>();
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = resolve(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== "shared") walk(path);
          continue;
        }
        if (!entry.name.endsWith(".md")) continue;
        const sourceId = relative(examples, path);
        if (sourceId === "compiler-debug/invalid-query.md") continue;
        const blocks = [...readFileSync(path, "utf8").matchAll(/```(?:lisp|clojure|clj)\n([\s\S]*?)```/g)]
          .map((match) => match[1]!)
          .filter((block) => !/^\s*\(ontology[\s)]/.test(block));
        if (blocks.length === 0) continue;
        const example = sourceId.split("/")[0]!;
        groups.set(example, [...(groups.get(example) ?? []), { sourceId, source: blocks.join("\n") }]);
      }
    };
    walk(examples);

    let entities = 0;
    for (const [example, sources] of groups) {
      const { model, diagnostics } = elaborateOntology([system, ...sources]);
      const ontologyErrors = diagnostics.filter((d) => d.severity === "error" && !(d.code === "elaborate/unknown-form" && ["export","export-from","import","test","test-suite"].includes(String(d.details?.["form"]))));
      expect(ontologyErrors.map(formatDiagnostic), example).toEqual([]);
      entities += model.entities.length;
    }
    expect(entities).toBeGreaterThan(60);
  }, 60_000);
});

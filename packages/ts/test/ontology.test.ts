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

const supportDesk = `(define-entity Customer
  (:doc "An organisation that raises tickets.")
  (:field [customer/name String {:required true}]))

(define-entity Ticket
  (:field [ticket/title String {:required true :indexed true}])
  (:field [ticket/customer (Ref Customer) {:required true}])
  (:field [ticket/owner Customer])
  (:field [ticket/tags (List String)]))

(define-relation escalated-to Ticket Customer
  (:field [escalated-to/at Instant {:required true}]))

(define-action close-ticket
  (:input [ticket String {:required true}])
  (:input [watchers (List Customer)])
  (:returns String)
  (:do (set ticket :ticket/status "closed")))

(define-query titles (:from Ticket) (:select [ticket/title]))

(define-datalog-query open-work
  (:query {:find ["?title"] :where [["?t" ":ticket/title" "?title"]]}))
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
    expect(ticket!.fields).toEqual([
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
    expect(action!.inputs).toEqual([
      { name: "ticket", type: { kind: "scalar", name: "String" }, required: true },
      {
        name: "watchers",
        type: { kind: "list", item: { kind: "ref", target: "Customer" } },
        required: false,
      },
    ]);
    expect(action!.body).toEqual([
      "set",
      "ticket",
      ":ticket/status",
      { "$forma.runtimeExpr": "string-literal", value: "closed" },
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
        "(define-entity A (:field [a/x String]) (:field [a/x Int]) (:field [a/b Missing]))",
        "(define-relation r A Ghost)",
        "(define-query q (:from Nowhere))",
      ].join("\n"),
      { sourceId: "m.lisp" },
    );
    expect(ok).toBe(false);
    expect(diagnostics.map((d) => [d.code, formatDiagnostic(d)])).toEqual([
      ["ontology/duplicate-field", "m.lisp:1:1: A declares a/x twice"],
      ["ontology/unknown-type", "m.lisp:1:1: a/b refers to unknown type Missing"],
      ["ontology/unknown-entity", "m.lisp:2:1: r refers to unknown entity Ghost"],
      ["ontology/unknown-entity", "m.lisp:3:1: q queries unknown entity Nowhere"],
    ]);
  });

  test("resolves references across sources", () => {
    const { ok, model, diagnostics } = elaborateOntology([
      { sourceId: "queries.lisp", source: "(define-query everyone (:from Person))" },
      { sourceId: "entities.lisp", source: "(define-entity Person (:field [person/name String]))" },
    ]);
    expect(diagnostics).toEqual([]);
    expect(ok).toBe(true);
    expect(model.queries[0]!.span.sourceId).toBe("queries.lisp");
    expect(model.entities[0]!.span.sourceId).toBe("entities.lisp");
  });

  test("parses type expressions and unwraps runtime literals", () => {
    expect(parseOntologyType(["Set", ["Ref", "User"]])).toEqual({
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
      const ontologyErrors = diagnostics.filter((d) => d.code.startsWith("ontology/"));
      expect(ontologyErrors.map(formatDiagnostic), example).toEqual([]);
      entities += model.entities.length;
    }
    expect(entities).toBeGreaterThan(60);
  });
});

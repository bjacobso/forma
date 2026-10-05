import { describe, expect, test } from "vitest";
import { Effect } from "effect";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  RUNTIME_STRING_LITERAL_KEY,
  SimpleSemanticEnvironment,
  isRuntimeStringLiteral,
  normalizeForm,
  recognizeForms,
} from "../src/Descriptor.js";
import {
  bootstrapOntologyPreludes,
  bootstrapPreludes,
  ontologyPreludeStack,
  preludeSources,
} from "../src/Preludes.js";
import { parse, toSExprMany } from "../src/Reader.js";

const preludesDir = resolve(import.meta.dirname, "../../../preludes");

const ontology = bootstrapOntologyPreludes();

const construct = (source: string): unknown[] => {
  const semanticEnv = new SimpleSemanticEnvironment();
  return recognizeForms(toSExprMany(parse(source).redTree), ontology.descriptions).map((recognized) => {
    const form = normalizeForm(recognized, ontology.descriptions);
    const hook = form.descriptor.elaboration;
    if (hook.kind !== "hook") throw new Error(`${form.formName} has no construct hook`);
    return Effect.runSync(
      ontology.elaboration.construct(hook.fn, {
        formName: form.formName,
        descriptor: form.descriptor,
        normalizedSlots: form.slots,
        identifiers: form.identifiers,
        semanticEnv,
        loc: form.loc,
        rawExpr: form.rawExpr,
      }),
    );
  });
};

describe("bundled preludes", () => {
  test("embed every repository prelude verbatim", () => {
    const files = readdirSync(preludesDir).filter((name) => name.endsWith(".lisp")).sort();
    expect(Object.keys(preludeSources), "run `pnpm preludes:generate`").toEqual(files);
    for (const name of files) {
      expect(preludeSources[name as keyof typeof preludeSources], name).toBe(
        readFileSync(resolve(preludesDir, name), "utf8"),
      );
    }
  });

  test("bootstrap fresh registries for a named stack", () => {
    const first = bootstrapPreludes(ontologyPreludeStack);
    expect(first.descriptions.get("define-entity")).toBeDefined();
    expect(bootstrapOntologyPreludes().descriptions).not.toBe(first.descriptions);
    expect(() => bootstrapPreludes(["compiler.lisp"])).toThrow(/domain prelude/);
  });
});

describe("ontology preludes on the TypeScript engine", () => {
  test("constructs Datalog queries with construct/query", () => {
    const [query] = construct(`
      (define-datalog-query open-orders
        (:query {:find ["?title"] :where [["?o" ":order/title" "?title"]]}))`);
    expect(query).toBeInstanceOf(Map);
    const map = query as Map<string, unknown>;
    expect(map.get("kind")).toBe("Query");
    expect(map.get("name")).toBe("open-orders");
    expect((map.get("datalog") as Map<string, unknown>).get("kind")).toBe("raw-expr");
  });

  test("marks runtime string literals with a Forma-owned key", () => {
    const [action] = construct(`
      (define-action close
        (:input [order String {:required true}])
        (:do (set order :order/status "closed")))`) as Map<string, unknown>[];
    const body = (action!.get("do") as Map<string, unknown>).get("expr") as unknown[];
    const literal = body[3];
    expect(RUNTIME_STRING_LITERAL_KEY).toBe("$forma.runtimeExpr");
    expect(isRuntimeStringLiteral(literal)).toBe(true);
    expect((literal as Map<string, unknown>).get("value")).toBe("closed");
  });

  test("constructs typed queries with select fields", () => {
    const [, query] = construct(`
      (define-entity Order (:field [order/title String {:required true}]))
      (define-query titles (:from Order) (:select [order/title]))`) as Map<string, unknown>[];
    expect(query!.get("kind")).toBe("Query");
    expect(query!.get("from")).toBe("Order");
    expect(query!.get("select")).toEqual(["order/title"]);
  });
});

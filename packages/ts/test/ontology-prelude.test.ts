import { describe, expect, test } from "vitest";
import { Effect } from "effect";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  RUNTIME_STRING_LITERAL_KEY,
  SimpleSemanticEnvironment,
  bootstrapFromSources,
  isRuntimeStringLiteral,
  normalizeForm,
  recognizeForms,
} from "../src/Descriptor.js";
import { parse, toSExprMany } from "../src/Reader.js";

const preludesDir = resolve(import.meta.dirname, "../../../preludes");
const prelude = (name: string) => readFileSync(resolve(preludesDir, name), "utf8");

const ontology = bootstrapFromSources(
  prelude("compiler.lisp"),
  prelude("ontology.lisp"),
  prelude("ontology-compiler.lisp"),
  prelude("viewspec-compiler.lisp"),
);

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
});

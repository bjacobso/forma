import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { bootstrapFromSources } from "../src/descriptor/bootstrap.js";
import { elaborateProgram } from "../src/descriptor/elaborate.js";

const fixture = (name: string) => readFileSync(resolve(import.meta.dirname, "../../../conformance/form-alias-records", name), "utf8");
const elaborate = (source: string) => elaborateProgram(source, { prelude: bootstrapFromSources("", "") });
const program = (type: string, value: string, definitions = '(type Item {:id String})') => `${definitions}
(type ValueIR {:ok Bool})
(form (value item) :types {:item (Expr ${type})} :ir ValueIR {:ok true})
(value ${value})`;

describe("record aliases in expression holes", () => {
  test("accepts the benchmark repro", () => {
    const result = elaborate(fixture("accepted.lisp"));
    expect(result.diagnostics).toEqual([]);
    expect(result.declarations.at(-1)?.payload).toEqual({ items: [{ id: "a" }] });
  });

  test("accepts the nested conformance fixture", () => {
    expect(elaborate(fixture("nested.lisp")).diagnostics).toEqual([]);
  });

  test.each([["wrong-field.lisp", "42"], ["missing-field.lisp", "{}"]])("rejects %s at its authored field", (file, text) => {
    const source = fixture(file);
    const result = elaborate(source);
    expect(result.diagnostics).toHaveLength(1);
    const diagnostic = result.diagnostics[0]!;
    expect(diagnostic.code).toBe("elaborate/hole-type");
    expect(source.slice(diagnostic.span!.startOffset, diagnostic.span!.endOffset)).toBe(text);
  });

  test("keeps the IR contract identity independent of hole alias expansion", () => {
    const named = elaborate(fixture("accepted.lisp"));
    const structural = elaborate(fixture("accepted.lisp").replace("(Expr (List Item))", "(Expr (List {:id String}))"));
    expect(named.diagnostics).toEqual([]);
    expect(structural.diagnostics).toEqual([]);
    expect(named.declarations[0]!.payloadContractId).toMatch(/^[a-f0-9]{64}$/);
    expect(named.declarations[0]!.payloadContractId).toBe(structural.declarations[0]!.payloadContractId);
  });

  test.each([
    ["Item", '{:id "a"}'],
    ["(Option Item)", '(Some {:id "a"})'],
    ["(List (List Item))", '[[{:id "a"}]]'],
    ["(List Wrapper)", '[{:item {:id "a"}}]'],
    ["(List (Box Item))", '[{:value {:id "a"}}]'],
  ])("accepts aliases nested in %s", (type, value) => {
    const source = program(type, value, '(type Item {:id String}) (type Wrapper {:item Item}) (type (Box a) {:value a})');
    expect(elaborate(source).diagnostics).toEqual([]);
  });

  test.each([
    ["(List Item)", '[{:id 42}]', "42"],
    ["(List Item)", '[{}]', "{}"],
    ["(Option Item)", '(Some {:id 42})', "42"],
    ["(List (List Item))", '[[{:id 42}]]', "42"],
  ])("rejects a mismatched record in %s at its field or missing-field record", (type, value, text) => {
    const source = program(type, value);
    const result = elaborate(source);
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toHaveLength(1);
    const diagnostic = result.diagnostics[0]!;
    expect(diagnostic.code).toBe("elaborate/hole-type");
    expect(source.slice(diagnostic.span!.startOffset, diagnostic.span!.endOffset)).toBe(text);
  });

  test.each([
    ['(type Item (Brand String))', '"a"'],
    ['(type Item (Tagged (Entry {:id String})))', '{:_tag "Entry" :id "a"}'],
    ['(class Item {:id String})', '{:id "a"}'],
    ['(error Item {:id String})', '{:id "a"}'],
  ])("keeps nominal definitions nominal: %s", (definition, value) => {
    const result = elaborate(program("(List Item)", `[${value}]`, definition));
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]?.code).toBe("elaborate/hole-type");
  });

  test("keeps nominal record definitions in a prelude nominal", () => {
    const source = program("(List Item)", '[{:id "a"}]', '(class Item {:id String})');
    const prelude = source.slice(0, source.lastIndexOf("\n(value"));
    const result = elaborateProgram('(value [{:id "a"}])', { prelude: bootstrapFromSources("", prelude) });
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]?.code).toBe("elaborate/hole-type");
  });
});

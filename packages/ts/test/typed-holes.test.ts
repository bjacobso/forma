import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { typecheck } from "../src/Engine.js";
import { elaborateEffectProgram } from "../src/Mechanics.js";

const holes = (source: string) => typecheck({ source, sourceId: "holes.lisp" }).diagnostics;

test("argument holes receive their solved type and visible local candidates", () => {
  const diagnostics = holes('(: add (-> Int Int Int)) (define add [a b] (+ a b)) (: repair (-> Int Int)) (define repair [a] (add a ?todo))');
  expect(diagnostics).toHaveLength(1);
  expect(diagnostics[0]).toMatchObject({ code: "typecheck/hole", severity: "error", details: { name: "?todo", expected: "Int", candidates: ["a"] } });
});

test.each([
  ['(: value Int) (define value (let [a 1] ?body))', 'Int'],
  ['(: value {:count Int}) (define value {:count ?field})', 'Int'],
  ['(match true true 1 false ?arm)', 'Int'],
  ['(define identity [a] (if true a ?body)) (identity 1)', 'a'],
])("infers holes in expression contexts: %s", (source, expected) => {
  expect(holes(source).find(d => d.code === "typecheck/hole")?.details?.expected).toBe(expected);
});

test("reports separate occurrences alongside independent errors", () => {
  const diagnostics = holes('(: a Int) (define a ?same) (: b String) (define b ?same) missing');
  expect(diagnostics.filter(d => d.code === "typecheck/hole")).toHaveLength(2);
  expect(diagnostics.some(d => d.code === "typecheck/unbound-symbol")).toBe(true);
});

test("bare holes with no fitting bindings and quoted query variables", () => {
  expect(holes('(: value Int) (define value ?)')[0]).toMatchObject({ code: "typecheck/hole", details: { name: "?", expected: "Int" } });
  expect(holes("(quote [?person ?name])")).toEqual([]);
});

test("typed hole conformance fixture", () => {
  const source = readFileSync(new URL("../../../conformance/typed-holes/contexts.lisp", import.meta.url), "utf8");
  expect(holes(source).filter(d => d.code === "typecheck/hole").map(d => d.details?.expected)).toEqual(["Int", "String"]);
});

test("Effect checking reports holes with their contextual type", () => {
  const result = elaborateEffectProgram('(: answer (Effect Int)) (define answer (succeed ?todo))');
  expect(result.ok).toBe(false);
  expect(result.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({code:"typecheck/hole", message:expect.stringContaining("Int")})]));
});

test("module checks preserve hole codes, details, and authored names", () => {
  const diagnostics = holes('(export repair) (: repair (-> Int Int)) (define repair [a] ?todo)');
  expect(diagnostics[0]).toMatchObject({code:"typecheck/hole", details:{expected:"Int", candidates:["a"]}});
  expect(JSON.stringify(diagnostics)).not.toMatch(/__forma_|\bt\d+\b/);
});

test("no-fit goals return an empty candidate list", () => {
  expect(holes('(let [label "text"] (: ? Int))')[0]).toMatchObject({code:"typecheck/hole", details:{expected:"Int", candidates:[]}});
});

test("polymorphic fits are instantiated independently", () => {
  const diagnostics = holes('(define identity [x] x) (: int-fn (-> Int Int)) (define int-fn ?i) (: str-fn (-> String String)) (define str-fn ?s)');
  const goals = diagnostics.filter(d => d.code === "typecheck/hole");
  expect(goals).toHaveLength(2);
  for (const goal of goals) expect(goal.details?.candidates).toContain("identity");
});

test("locals win over shadowed globals and suggestions are bounded", () => {
  const source = '(export repair) (define aa 0) (define z 0) (: repair (-> Int Int)) (define repair [z] ?todo)';
  expect(holes(source)[0]?.details?.candidates).toEqual(["z", "aa"]);
  const many = Array.from({length:12}, (_, i) => `(define value${i} ${i})`).join(" ");
  expect(holes(`${many} (let [] (: ? Int))`)[0]?.details?.candidates).toHaveLength(10);
});

test("a shadowed binding with the wrong type is never suggested by its global name", () => {
  const diagnostics = holes('(export repair) (define value 1) (: repair (-> String Int)) (define repair [value] ?todo)');
  expect(diagnostics[0]?.details?.candidates).toEqual([]);
});

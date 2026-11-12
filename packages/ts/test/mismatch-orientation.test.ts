import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { typecheck } from "../src/Engine.js";

const cases = [
  ["builtin argument", '(+ 1 "nope")', "Float", "String"],
  ["user function argument", '(: f (-> Float Float)) (define f [x] x) (f "nope")', "Float", "String"],
  ["annotated definition", '(: value Float) (define value "nope")', "Float", "String"],
  ["if branches", '(if true 1 "nope")', "Int", "String"],
  ["record field", '(: value {:x Float}) (define value {:x "nope"})', "Float", "String"],
  ["list element", '(: value (List Float)) (define value ["nope"])', "Float", "String"],
  ["return against signature", '(: f (-> Float Float)) (define f [x] "nope")', "Float", "String"],
] as const;

test.each(cases)("%s identifies expected and actual", (_name, source, expected, got) => {
  const diagnostic = typecheck({sourceId:"mismatch.lisp",source}).diagnostics[0]!;
  expect(diagnostic).toMatchObject({code:"typecheck/type-mismatch",details:{expected,got}});
  expect(diagnostic.message).toContain(`Expected ${expected}, found ${got}`);
});

test("builtin arguments retain their context", () => {
  expect(typecheck({source:'(+ 1 "nope")'}).diagnostics[0]?.message).toBe("Argument 2 to +: Expected Float, found String");
});

test("an infinite type uses local display names", () => {
  const diagnostic = typecheck({source:'(fn [x] (x x))'}).diagnostics[0]!;
  expect(diagnostic.message).not.toMatch(/\bt\d+\b/);
});

test("an annotation is a related location for a mismatch", () => {
  const source = readFileSync(new URL("../../../conformance/diagnostic-repairs/annotated-mismatch.lisp",import.meta.url),"utf8");
  const diagnostic = typecheck({sourceId:"annotation.lisp",source}).diagnostics[0]!;
  expect(diagnostic.related).toEqual([{message:"Expected type declared here",span:expect.objectContaining({sourceId:"annotation.lisp",startOffset:9,endOffset:14,startLine:1,startColumn:10})}]);
});

test("arity errors point to the function definition", () => {
  const source = '(define add [a b] (+ a b))\n(add 1)';
  expect(typecheck({sourceId:"arity.lisp",source}).diagnostics[0]).toMatchObject({code:"typecheck/arity",related:[{message:"Function defined here",span:{sourceId:"arity.lisp",startOffset:0,endOffset:26}}]});
});

test("a call mismatch points to the function's signature", () => {
  const source = '(: f (-> Float Float))\n(define f [x] x)\n(f "nope")';
  expect(typecheck({sourceId:"call.lisp",source}).diagnostics[0]?.related).toEqual([{message:"Expected type declared here",span:expect.objectContaining({sourceId:"call.lisp",startOffset:5,endOffset:21})}]);
});

test.each([
  '(type Color (Union "red" "green")) (: color Color) (define color "blue")',
  '(error Missing {}) (catch 1 (Missing err) 0)',
  '(let [x (<- 1)] x)',
  '(: value {:x Int :y Int}) (define value {:x 1})',
])("custom mismatch errors also carry both types: %s", source => {
  const diagnostics = typecheck({source}).diagnostics;
  expect(diagnostics).toHaveLength(1);
  for (const diagnostic of diagnostics) {
    expect(diagnostic.code).toBe("typecheck/type-mismatch");
    expect(diagnostic.details?.expected).toEqual(expect.any(String));
    expect(diagnostic.details?.got).toEqual(expect.any(String));
  }
});

test.each(['(count 1)','(merge {:x 1} 2)','(assoc {:x 1} (str "x") 2)'])('collection mismatch carries both sides: %s', source => {
  const diagnostic = typecheck({source}).diagnostics[0]!;
  expect(diagnostic).toMatchObject({code:"typecheck/type-mismatch",details:{expected:expect.any(String),got:expect.any(String)}});
  expect(diagnostic.message).toMatch(/Expected .+, found /);
});

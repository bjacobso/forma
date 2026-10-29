import { expect, test } from "vitest";
import { typecheck } from "../src/Engine.js";
import { checkModuleGraph, resolveModuleGraph, sourceModuleResolver } from "../src/Modules.js";

test.each([
  '(: thunk (-> Int)) (define thunk (fn [] 42)) (thunk)',
  '(define make [value] (fn [] value)) (define thunk (make 42)) (thunk)',
  '(define call [f] (f)) (call (fn [] 42))',
])("infers a zero-argument callback: %s", source => {
  const checked = typecheck({ sourceId: "callbacks.forma", source });
  expect(checked.diagnostics).toEqual([]);
  expect(checked.display).toBe("Int");
});

test.each([
  '(define thunk [] 42) (thunk nil)',
  '(define unary [x] x) (unary)',
  '(: thunk (-> Unit Int)) (define thunk (fn [] 42))',
  '(define call [f] (f nil)) (call (fn [] 42))',
])("rejects incompatible callback arity: %s", source => {
  const checked = typecheck({ sourceId: "callbacks.forma", source });
  expect(checked.diagnostics[0]?.code).toBe("typecheck/arity");
});

test("portable inferred interfaces preserve a returned zero-argument function", () => {
  const entry = { id: "callbacks.forma", source: '(export make) (define make [value] (fn [] value))' };
  const g = resolveModuleGraph(entry, sourceModuleResolver([entry]));
  const checked = checkModuleGraph(g);
  expect(checked.diagnostics).toEqual([]);
  expect(checked.interfaces[0]!.exports[0]!.scheme).toEqual({
    parameters: ["a0"], type: ["->", "a0", ["->", "a0"]],
  });
});

test("portable inferred interfaces preserve a returned function with arguments", () => {
  const entry = { id: "callbacks.forma", source: '(export make) (define make [value] (fn [ignored] value))' };
  const g = resolveModuleGraph(entry, sourceModuleResolver([entry]));
  const checked = checkModuleGraph(g);
  expect(checked.diagnostics).toEqual([]);
  expect(checked.interfaces[0]!.exports[0]!.scheme).toEqual({
    parameters: ["a0", "a1"], type: ["->", "a0", ["->", "a1", "a0"]],
  });
});

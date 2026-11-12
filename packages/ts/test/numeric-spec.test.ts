import { readFileSync } from "node:fs";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { Type, Reader, Evaluator, Builtins } from "../src/index.js";
import { normalizeCoreProgram } from "../src/surface/core.js";

interface Case {
  id: string;
  stage: number;
  source: string;
  type: string;
  printed?: string;
  runtimeError?: boolean;
}
const cases: Case[] = JSON.parse(readFileSync(new URL("../../../conformance/numeric/expected.json", import.meta.url), "utf8"));
// Stage 2 ships; opt in to the future branch-join contract with stage 3.
const stage = Number(process.env.FORMA_NUMERIC_SPEC ?? 2);
describe("numeric semantics proposal contract", () => {
  it("keeps intrinsic numeric requirements separate from user typeclasses", async () => {
    const source = '(typeclass (Numeric a) (: describe-number (-> a String))) (instance (Numeric String) (define describe-number [x] x)) (define describe [x] (describe-number x)) (describe "custom")';
    expect(await Effect.runPromise(Type.inferSourceStr(source))).toBe("String");
  });
  it.each([
    ["(map abs [-1 2])", "List<Int>"],
    ["(define absolute abs) (map absolute [-1 2])", "List<Int>"],
    ["(define increment [x] (+ x 1)) (increment 1) (increment 1.5)", "Float"],
    ["(define add-first [xs x] (+ (first xs) x)) (add-first [1] 2.5)", "Float"],
  ])("numeric values specialize consistently: %s", async (source, expected) => {
    expect(await Effect.runPromise(Type.inferSourceStr(source))).toBe(expected);
  });
  it.each([
    '(define square [x] (* x x)) (square "bad")',
    '(map (fn [x] (+ x 1)) ["bad"])',
    '(filter (fn [x] (> x 0)) ["bad"])',
    '(define total [xs] (reduce + 0 xs)) (total ["bad"])',
  ])("rejects nonnumeric inputs: %s", async source => {
    await expect(Effect.runPromise(Type.inferSourceStr(source))).rejects.toThrow();
  });
  for (const entry of cases) it.skipIf(entry.stage > stage)(entry.id, async () => {
    expect(await Effect.runPromise(Type.inferSourceStr(entry.source))).toBe(entry.type);
    const forms = Reader.toSExprMany(Reader.parse(entry.source).redTree);
    for (const interpreter of [false, true]) {
      const run = () => Effect.runSync((interpreter ? Evaluator.evaluateCompileTimeExprs : Evaluator.evaluateExprs)(
        interpreter ? normalizeCoreProgram(forms) : forms,
        {builtins: Builtins.defaultBuiltins, stepLimit: 100_000},
      ));
      if (entry.runtimeError) expect(run).toThrow();
      else expect(Evaluator.printKValue(run().value)).toBe(entry.printed);
    }
  });
});

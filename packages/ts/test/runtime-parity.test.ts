import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { Effect } from "effect";
import { Reader, Evaluator, VM } from "../src/index.js";
import { Env } from "../src/Env.js";
import { defaultBuiltins as builtins } from "../src/builtins/index.js";
import { buildVMGlobals } from "../src/evaluator/vm-bridge.js";

const root = resolve(import.meta.dirname, "../../..");
const cases = JSON.parse(readFileSync(resolve(root, "conformance/runtime-parity/cases.json"), "utf8"));
function forms(source: string) {
  return Evaluator.expandKernelExprsSync(Reader.toSExprMany(Reader.parse(source).redTree), { builtins }).expanded;
}
function outcome(source: string, vm: boolean, expand = true) {
  try {
    const exprs = expand ? forms(source) : Reader.toSExprMany(Reader.parse(source).redTree);
    const env = Env.empty();
    const compiled = vm ? VM.compileProgram(exprs, { builtins, env, normalized: true }) : undefined;
    const result = Effect.runSync(compiled
      ? VM.runChunkWithStats(compiled.chunk, {
          builtins: compiled.builtinRegistry.toArray(builtins), builtinLookup: compiled.builtinRegistry.toMap(builtins),
          globals: buildVMGlobals(compiled.globals, env), strictGlobals: true,
          globalNames: Array.from({ length: compiled.globals.count }, (_, i) => compiled.globals.nameAt(i)), stepLimit: 10_000,
        })
      : Evaluator.evaluateCompileTimeExprs(exprs, { builtins, stepLimit: 10_000 }));
    return { printed: Evaluator.isKFn(result.value) ? "<function>" : Evaluator.printKValue(result.value) };
  } catch (error) {
    const failure = error as { _tag?: string; name: string; message: string };
    return { error: failure._tag ?? failure.name, message: failure.message };
  }
}

describe("independent kernel runtime contracts", () => {
  for (const entry of cases) test(`${entry.classification}: ${entry.file}`, () => {
    const source = readFileSync(resolve(root, entry.file), "utf8");
    for (const vm of [false, true]) expect(outcome(source, vm)).toEqual(entry.expected);
  });
  test.each([
    ["(let [x 1 y (+ x 1)] y)", "2"],
    ["(let [+ (fn [x y] x)] (+ 1 2))", "1"],
    ["(let [x 1 f (fn [] x) x 2] (f))", "1"],
    ["(let [id (fn [x] x)] (let [a (id 42) b (id true)] a))", "42"],
    ["(type (Color) (Tagged Red Blue)) [(Red) Red]", '[{:_tag "Red"} {:_tag "Red"}]'],
  ])("lexical/constructor contract %s", (source, printed) => {
    for (const vm of [false, true]) expect(outcome(source, vm)).toEqual({ printed });
  });
});

// These are raw runtime contracts: no checker is needed to reject malformed forms.
test.each([
  ["(let [x 1 y] x)", "let bindings must have an even number of forms"],
  ["(fn 1 2)", "fn params must be a vector"],
  ["(fn [x & xs y] x)", "rest parameter must be the final fn parameter"],
  ["(if true)", "if expects 2-3 arguments, got 1"],
  ["(let [])", "let expects 2+ arguments, got 1"],
  ["(handle 1)", "Unbound symbol: handle"],
])("validates %s", (source, message) => {
  for (const vm of [false, true]) expect(outcome(source, vm, false)).toMatchObject({ message });
});

test("builtin failures retain the author span", () => {
  const source = "\n(first 1)";
  const exprs = forms(source);
  for (const vm of [false, true]) {
    try {
      if (vm) {
        const c = VM.compileProgram(exprs, { builtins, normalized: true });
        Effect.runSync(VM.runChunkWithStats(c.chunk, { builtins: c.builtinRegistry.toArray(builtins), globals: [], stepLimit: 100 }));
      } else Effect.runSync(Evaluator.evaluateCompileTimeExprs(exprs, { builtins, stepLimit: 100 }));
      expect.unreachable("expected a located failure");
    } catch (error) {
      expect(error).toMatchObject({ _tag: "KernelTypeError", loc: { start: 1, line: 2, col: 1 }, message: "first: expected list, got Int" });
    }
  }
});

test("nullary constructor syntax resolves a rebound function at execution time", () => {
  const source = "(__sum-type (Color) (Red) (Blue)) (define Red (fn [] 7)) (Red)";
  for (const vm of [false, true]) expect(outcome(source, vm, false)).toEqual({ printed: "7" });
});

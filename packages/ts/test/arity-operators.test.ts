import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { Reader, Evaluator, Builtins, Type } from "../src/index.js";
import { normalizeCoreProgram } from "../src/surface/core.js";
import { typecheck } from "../src/Engine.js";

const run = (source: string, interpreter: boolean) => {
  const forms = Reader.toSExprMany(Reader.parse(source).redTree);
  return Evaluator.printKValue(Effect.runSync(
    (interpreter ? Evaluator.evaluateCompileTimeExprs : Evaluator.evaluateExprs)(
      interpreter ? normalizeCoreProgram(forms) : forms,
      { builtins: Builtins.defaultBuiltins, stepLimit: 100_000 },
    ),
  ).value);
};

describe("call arity", () => {
  it.each([
    ["(define add (fn [a b] (+ a b))) (add 1)", "add", 2, 1],
    ["(define add (fn [a b] (+ a b))) (add 1 2 3)", "add", 2, 3],
    ["((fn [x y] x) 1)", "function", 2, 1],
    ["(first)", "first", 1, 0],
    ["(define f (fn [] 1)) (f 2)", "f", 0, 1],
    ["(define f (fn [x] (fn [y] y))) (f 1 2)", "f", 1, 2],
    ["(define f (fn [x y] (f x))) (f 1 2)", "f", 2, 1],
    ["(define f (fn [x] (fn [y z] y))) ((f 1) 2)", "function", 2, 1],
  ])("rejects %s", async (source, name, expected, actual) => {
    const checked = await typecheck({ source: source as string });
    expect(checked.diagnostics).toContainEqual(expect.objectContaining({
      code: "typecheck/arity", message: `${name} expects ${expected} arguments, got ${actual}`,
      details: expect.objectContaining({ name, expected, actual }),
    }));
  });

  it.each(["(+ 1 2 3)", "(define f (fn [x & xs] x)) (f 1 2 3)", "(define f (fn [x] (fn [y] y))) ((f 1) 2)", "(define f (fn [] 1)) (f)", "(define f (fn [] (fn [x] x))) ((f) 1)"])("accepts %s", async source => {
    expect((await typecheck({ source })).diagnostics).toEqual([]);
  });
});

describe("operators as values", () => {
  it.each([
    ["(reduce + 0 [1 2 3])", "Int", "6"],
    ["(reduce + 0.0 [1 2 3])", "Float", "6.0"],
    ["(reduce + 0 [1.0 2 3])", "Float", "6.0"],
    ["(let [op +] (op 1 2))", "Int", "3"],
    ["(let [op +] (op 1 2.0))", "Float", "3.0"],
    ["(let [op /] (op 6 2))", "Float", "3.0"],
    ["(reduce min 9 [1 2 3])", "Int", "1"],
    ["(reduce max 0 [1 2 3])", "Int", "3"],
    ["(reduce - 9 [1 2 3])", "Int", "3"],
    ["(reduce * 1 [1 2 3])", "Int", "6"],
    ["(let [op mod] (op 5 2))", "Int", "1"],
    ["(let [op <] (op 1 2))", "Bool", "true"],
    ["(let [op <=] (op 1 2.0))", "Bool", "true"],
    ["(let [op >] (op 2 1))", "Bool", "true"],
    ["(let [op >=] (op 2.0 1))", "Bool", "true"],
    ["(let [op =] (op 1 1.0))", "Bool", "true"],
    ["(map abs [-1 2])", "List<Int>", "[1 2]"],
  ])("checks and runs %s", async (source, type, printed) => {
    expect(await Effect.runPromise(Type.inferSourceStr(source))).toBe(type);
    for (const interpreter of [false, true]) expect(run(source, interpreter)).toBe(printed);
  });

  it("rejects nonnumeric operator arguments", async () => {
    await expect(Effect.runPromise(Type.inferSourceStr('(let [op +] (op "a" "b"))'))).rejects.toThrow();
  });

  it("accepts builtin values in unchecked filter callbacks", () => {
    // Head-position arithmetic retains its runtime variadic contract.
    for (const interpreter of [false, true]) expect(run("(filter + [0 1])", interpreter)).toBe("[0 1]");
  });
});

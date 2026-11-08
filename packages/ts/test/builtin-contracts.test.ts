import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import ts from "typescript";
import { Reader, Evaluator, Type, Mechanics } from "../src/index.js";
import { defaultBuiltins } from "../src/builtins/index.js";
import { builtinContracts } from "../src/builtins/contracts.js";
import { builtinScheme } from "../src/type/builtin-schemes.js";
import { builtins, arithmeticOperators } from "../src/mechanics/builtins.js";
import { normalizeCoreProgram } from "../src/surface/core.js";

const source = readFileSync(new URL("../../../conformance/fixtures/typecheck/builtin-contracts-success/source.lisp", import.meta.url), "utf8");
const run = (text: string, interpreter: boolean) => {
  const forms = Reader.toSExprMany(Reader.parse(text).redTree);
  return Effect.runSync((interpreter ? Evaluator.evaluateCompileTimeExprs : Evaluator.evaluateExprs)(
    interpreter ? normalizeCoreProgram(forms) : forms, { builtins: defaultBuiltins, stepLimit: 100_000 },
  )).value;
};

describe("builtin contracts", () => {
  it("accounts for every registered name and declared pass", () => {
    // The HM provider is a switch, not an enumerable map. Enumerate its literal
    // cases with the TS parser so a new case cannot silently escape the audit.
    const file = ts.createSourceFile("builtin-schemes.ts", readFileSync(new URL("../src/type/builtin-schemes.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest);
    const hm = new Set<string>();
    const visit = (node: ts.Node): void => {
      if (ts.isCaseClause(node) && ts.isStringLiteral(node.expression)) hm.add(node.expression.text);
      ts.forEachChild(node, visit);
    };
    visit(file);
    const runtime = new Set(Object.keys(defaultBuiltins));
    const effect = new Set([...builtins.keys(), ...arithmeticOperators.keys()]);
    expect([...new Set([...runtime, ...hm, ...effect])].sort()).toEqual([...builtinContracts.keys()].sort());
    for (const [name, contract] of builtinContracts) {
      expect(runtime.has(name), `${name}: runtime`).toBe(contract.runtime);
      expect(hm.has(name), `${name}: HM inventory`).toBe(contract.hm);
      expect(builtinScheme(name) !== undefined, `${name}: HM scheme`).toBe(contract.hm);
      expect(effect.has(name), `${name}: Effect`).toBe(contract.effect);
      if (!contract.runtime || !contract.hm || !contract.effect) expect(contract.reason, name).toBeTruthy();
    }
  });

  it("checks and runs the shared fixture in the VM and interpreter", async () => {
    expect(await Effect.runPromise(Type.inferSourceStr(source))).toBe("List<Bool>");
    for (const interpreter of [false, true]) expect(run(source, interpreter)).toEqual(Array(15).fill(true));
  });

  it.each([
    ['(reverse [3 1 2])', 'List<Int>', [2, 1, 3]],
    ['(sqrt 2.25)', 'Float', new Evaluator.KFloat(1.5)],
    // A list accumulator and Int elements distinguish callback parameter order.
    ['(reduce (fn [acc item] (conj acc item)) [] [3 1 2])', 'List<Int>', [3, 1, 2]],
    ['(conj ["a"] "b")', 'List<String>', ['a', 'b']],
    ['(concat ["a"] ["b" "c"])', 'List<String>', ['a', 'b', 'c']],
    ['(quot -7 3)', 'Int', -2],
  ] as const)("infers the result type and runs %s", async (text, type, value) => {
    expect(await Effect.runPromise(Type.inferSourceStr(text))).toBe(type);
    for (const interpreter of [false, true]) expect(run(text, interpreter)).toEqual(value);
  });

  it.each([
    ['(concat "a" "b")', 'String'],
    ['(concat [1] ["a"])', '(List Int)'],
    ['(conj [1] "a")', '(List Int)'],
    ['(reduce (fn [acc item] item) "" [1])', 'String'],
    ['(quot 7.5 2)', 'Int'],
    ['(reverse "abc")', '(List Int)'],
    ['(sqrt "9")', 'Float'],
  ])("rejects incompatible checked calls: %s", async (text, resultType) => {
    await expect(Effect.runPromise(Type.inferSourceStr(text))).rejects.toThrow();
    const result = Mechanics.generateEffectProgram(`(: bad (-> Int ${resultType})) (define bad [unused] ${text})`);
    expect(result.diagnostics.some(d => d.severity === "error")).toBe(true);
  });

  it("rejects zero division and invalid runtime arguments in both execution paths", () => {
    for (const interpreter of [false, true]) for (const text of [
      '(quot 1 0)', '(quot 1.0 2)', '(quot 1)', '(quot 1 2 3)',
      '(sqrt)', '(sqrt 1.0 2.0)', '(reverse)', '(reverse [1] [2])',
      '(concat "a" "b")', '(reverse "abc")',
    ]) expect(() => run(text, interpreter), text).toThrow();
  });
});

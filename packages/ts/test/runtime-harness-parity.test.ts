import { readFileSync } from "node:fs";
import { afterEach, describe, expect, test, vi } from "vitest";
import { Effect } from "effect";
import * as evaluator from "../src/evaluator/eval.js";
import { printKValue } from "../src/Evaluator.js";
import { parse, toSExprMany } from "../src/Reader.js";
import { defaultBuiltins as builtins } from "../src/Builtins.js";
import { openSession } from "../src/Session.js";
import { ModuleRuntime, resolveModuleGraph, sourceModuleResolver } from "../src/Modules.js";
import { elaborateEffectProgram, makeMechanicsRuntime } from "../src/Mechanics.js";

const fixtures = JSON.parse(readFileSync(new URL("../../../conformance/runtime-parity/harnesses.json", import.meta.url), "utf8"));
const vmEvaluate = evaluator.evaluateExprs;
const treeEvaluate: typeof vmEvaluate = (exprs, options) => Effect.flatMap(
  evaluator.expandExprs(exprs, options), expanded => evaluator.evaluateCompileTimeExprs(expanded, options),
);
afterEach(() => vi.restoreAllMocks());
for (const vm of [false, true]) describe(vm ? "VM harnesses" : "tree harnesses", () => {
  const evaluate = vm ? vmEvaluate : treeEvaluate;
  test("session environments retain closures across loads", async () => {
    const session = openSession({ id: "runtime-parity" });
    let printed = "";
    for (const [i, source] of fixtures.session.sources.entries()) {
      session.rememberSource({ id: `session-${i}.lisp`, text: source });
      const result = await Effect.runPromise(evaluate(toSExprMany(parse(source).redTree), { env: session.env, builtins, stepLimit: 10_000 }));
      session.env = result.env;
      printed = printKValue(result.value);
    }
    expect(printed).toBe(fixtures.session.expected);
  });
  test("module imports initialize and call exported closures", async () => {
    if (!vm) vi.spyOn(evaluator, "evaluateExprs").mockImplementation(treeEvaluate);
    const graph = resolveModuleGraph(fixtures.modules[1], sourceModuleResolver(fixtures.modules));
    const result = await new ModuleRuntime().evaluate(graph);
    expect(printKValue(result.result.value)).toBe(fixtures.moduleExpected);
  });
  test("service callbacks use the hosted adapter and preserve trace order", async () => {
    const projected = elaborateEffectProgram(fixtures.service.source);
    expect(projected.diagnostics).toEqual([]);
    const calls: unknown[] = [];
    const runtime = makeMechanicsRuntime({ declarations: projected.declarations, services: {
      Console: { print: message => { calls.push(message); return null; } },
    } });
    const log = () => Effect.tryPromise({ try: () => runtime.invoke("log", [fixtures.service.calls[calls.length]]).then(() => null), catch: error => { throw error; } });
    const exprs = toSExprMany(parse("(map (fn [x] (log)) [1 2])").redTree);
    const result = await Effect.runPromise(evaluate(exprs, { builtins: { ...builtins, log }, stepLimit: 10_000 }));
    expect(printKValue(result.value)).toBe("[nil nil]");
    expect(calls).toEqual(fixtures.service.calls);
    await expect(makeMechanicsRuntime({ declarations: projected.declarations, services: {} }).invoke("log", ["missing"])).rejects.toMatchObject({ code: "mechanics/missing-capability" });
  });
});

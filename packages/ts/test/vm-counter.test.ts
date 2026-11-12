import { describe, expect, test } from "vitest";
import { Effect } from "effect";
import { Reader, Evaluator, VM } from "../src/index.js";
import { defaultBuiltins as builtins } from "../src/builtins/index.js";
import { FailError } from "../src/diagnostic/errors.js";
import type { BuiltinFn } from "../src/evaluator/types.js";

function prepare(source: string, extra: Record<string, BuiltinFn> = {}, observed = false) {
  const registry = { ...builtins, ...extra };
  const observer = observed ? { targetsOf: () => [0], observe: () => {} } : undefined;
  const exprs = Evaluator.expandKernelExprsSync(Reader.toSExprMany(Reader.parse(source).redTree), { builtins: registry }).expanded;
  const c = VM.compileProgram(exprs, { builtins: registry, normalized: true, ...(observer ? { observer } : {}) });
  return (stepLimit: number) => VM.runChunkWithStats(c.chunk, {
    builtins: c.builtinRegistry.toArray(registry), builtinLookup: c.builtinRegistry.toMap(registry),
    globals: [], stepLimit, ...(observer ? { observer } : {}),
  });
}
const workloads = [
  ["(+ 1 2)", 4, 3],
  ["(define (count n) (if (= n 0) 0 (count (- n 1)))) (count 3)", 42, 0],
  ["(map (fn [x] (+ x 1)) [1 2 3])", 19, [2, 3, 4]],
] as const;

describe("per-run VM instruction budget", () => {
  test.each(workloads)("pins value, steps and boundaries for %s", (source, steps, value) => {
    const run = prepare(source);
    const unlimited = Effect.runSync(run(0));
    expect(unlimited).toEqual({ value, steps });
    expect(Effect.runSync(run(steps))).toEqual(unlimited);
    expect(Effect.runSync(run(steps + 1))).toEqual(unlimited);
    for (const limit of [1, steps - 1]) expect(() => Effect.runSync(run(limit))).toThrow(/step limit/);
  });
  test("observer bookkeeping leaves steps unchanged", () => {
    const plain = Effect.runSync(prepare("(+ 1 2)")(0));
    const observed = prepare("(+ 1 2)", {}, true);
    expect(Effect.runSync(observed(0))).toEqual(plain);
    expect(Effect.runSync(observed(plain.steps))).toEqual(plain);
    expect(Effect.runSync(observed(plain.steps + 1))).toEqual(plain);
    expect(() => Effect.runSync(observed(1))).toThrow(/step limit/);
  });
  test("reusing an Effect after failure starts a fresh budget", () => {
    const run = prepare("(+ 1 2)");
    for (let i = 0; i < 2; i++) expect(() => Effect.runSync(run(1))).toThrow(/step limit/);
    const effect = run(4);
    expect(Effect.runSync(effect)).toEqual(Effect.runSync(effect));
  });
  test("builtin failure does not leak a budget into a repeated Effect", () => {
    let first = true;
    const flaky: BuiltinFn = () => {
      if (!first) return Effect.succeed(7);
      first = false;
      return Effect.fail(new FailError({ message: "first attempt" }));
    };
    const effect = prepare("(flaky)", { flaky })(2);
    expect(() => Effect.runSync(effect)).toThrow("first attempt");
    expect(Effect.runSync(effect)).toEqual({ value: 7, steps: 2 });
  });
  test("simultaneous suspended callbacks use independent budgets", async () => {
    const pause: BuiltinFn = () => Effect.promise(async () => { await new Promise(resolve => setTimeout(resolve, 1)); return 1; });
    const run = prepare("(map (fn [x] (+ x (pause))) [1 2 3])", { pause });
    const baseline = await Effect.runPromise(run(0));
    expect(await Promise.all([Effect.runPromise(run(baseline.steps)), Effect.runPromise(run(baseline.steps))])).toEqual([baseline, baseline]);
  });
  test("cancellation does not leak a partially used budget", async () => {
    const controller = new AbortController();
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    let first = true;
    const pause: BuiltinFn = () => {
      if (!first) return Effect.succeed(1);
      first = false;
      return Effect.promise(() => { entered(); return new Promise<null>(() => {}); });
    };
    const effect = prepare("(pause)", { pause })(2);
    const pending = Effect.runPromise(effect, { signal: controller.signal });
    await started;
    controller.abort();
    await expect(pending).rejects.toBeDefined();
    expect(await Effect.runPromise(effect)).toEqual({ value: 1, steps: 2 });
  });
});

test("pure recursive execution cooperates with cancellation", async () => {
  const controller = new AbortController();
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const signal: BuiltinFn = () => Effect.sync(() => { entered(); return null; });
  const run = prepare("(define (count n) (if (= n 0) 0 (count (- n 1)))) (signal) (count 20000)", { signal });
  const pending = Effect.runPromise(run(0), { signal: controller.signal });
  await started;
  controller.abort();
  await expect(pending).rejects.toBeDefined();
});

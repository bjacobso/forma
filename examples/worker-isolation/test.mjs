import assert from "node:assert/strict";
import test from "node:test";
import { runIsolated } from "./index.mjs";

test("a granted capability call completes inside the worker", async () => {
  const state = await runIsolated('(read-note "welcome")');
  assert.equal(state.status, "completed");
  assert.equal(state.result.value.value, "Hello from the notes capability");
  assert.equal(state.hostCalls, 1);
});

test("a type error is rejected before running", async () => {
  const state = await runIsolated('(+ 1 (read-note "welcome"))');
  assert.equal(state.status, "rejected");
  assert.equal(state.stage, "typecheck");
});

test("a pure infinite loop stops at timeoutMs", async () => {
  const started = Date.now();
  const state = await runIsolated("(define spin [n] (spin (+ n 1)))\n(spin 0)", { limits: { steps: 2_000_000_000, timeoutMs: 200 } });
  assert.equal(state.status, "failed");
  assert.equal(state.diagnostics[0].code, "limit/time");
  assert(Date.now() - started < 8_000);
});

test("the parent's hard backstop terminates a worker that ignores its budgets", async () => {
  const started = Date.now();
  const state = await runIsolated("(define spin [n] (spin (+ n 1)))\n(spin 0)", {
    limits: { steps: 2_000_000_000, timeoutMs: 600_000 }, killAfterMs: 300,
  });
  assert.equal(state.stage, "killed");
  assert(Date.now() - started < 8_000);
});

test("an oversized result and an expansion bomb hit their limits", async () => {
  const big = await runIsolated('(str "abcdefghij" "klmnopqrst")', { limits: { maxResultBytes: 8 } });
  assert.equal(big.diagnostics[0].code, "limit/result-size");
  const bomb = await runIsolated("(macro (boom x) `(boom (boom ~x)))\n(boom 1)", { limits: { maxExpansionSteps: 200 } });
  assert.equal(bomb.diagnostics[0].code, "limit/expansion");
});

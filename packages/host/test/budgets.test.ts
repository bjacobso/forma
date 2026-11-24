import { describe, expect, it } from "vitest";
import { JsonAbi } from "../src/json-abi.js";
import { TsLanguageHost } from "../src/ts-host.js";
import type { CheckedRunState, HostBuiltinDescriptor } from "../src/types.js";

const builtins: readonly HostBuiltinDescriptor[] = [
  {
    name: "read-file",
    arity: 1,
    purity: "read",
    typeScheme: { kind: "function", params: [{ kind: "type", name: "String" }], result: { kind: "type", name: "String" } },
    handler: { kind: "host-effect", effect: "fs.read" },
  },
];

const spin = "(define spin [n] (spin (+ n 1)))\n(spin 0)";

async function withHost<T>(run: (host: TsLanguageHost, sessionId: string) => Promise<T>): Promise<T> {
  const host = new TsLanguageHost();
  const { sessionId } = await host.openSession();
  try {
    await host.configureSession({ sessionId, hostBuiltins: builtins });
    return await run(host, sessionId);
  } finally {
    await host.closeSession({ sessionId });
  }
}

describe("checkedRun resource budgets (RFC 0012 stage 3)", () => {
  it("stops a pure infinite loop at timeoutMs within bounded time", async () => {
    await withHost(async (host, sessionId) => {
      const started = Date.now();
      const state = await host.checkedRun({
        sessionId, sourceId: "loop.lisp", source: spin, grants: [],
        limits: { steps: 2_000_000_000, timeoutMs: 100 },
      });
      expect(Date.now() - started).toBeLessThan(5_000);
      expect(state).toMatchObject({ status: "failed", stage: "limit", diagnostics: [{ code: "limit/time", details: { limit: 100 } }] });
    });
  });

  it("applies the default timeout when limits omit timeoutMs", async () => {
    await withHost(async (host, sessionId) => {
      const started = Date.now();
      const state = await host.checkedRun({
        sessionId, sourceId: "loop.lisp", source: spin, grants: [], limits: { steps: 2_000_000_000 },
      });
      expect(Date.now() - started).toBeLessThan(15_000);
      expect(state).toMatchObject({ status: "failed", stage: "limit", diagnostics: [{ code: "limit/time", details: { limit: 5_000 } }] });
    });
  }, 20_000);

  it("aborts a pure infinite loop cooperatively through abortEvaluation", async () => {
    await withHost(async (host, sessionId) => {
      const started = Date.now();
      const running = host.checkedRun({
        sessionId, sourceId: "loop.lisp", source: spin, grants: [], evaluationId: "loop-1",
        limits: { steps: 2_000_000_000, timeoutMs: 60_000 },
      });
      await new Promise((resolve) => setTimeout(resolve, 50));
      await host.abortEvaluation({ sessionId, evaluationId: "loop-1", reason: "stop now" });
      const state = await running;
      expect(Date.now() - started).toBeLessThan(5_000);
      expect(state).toMatchObject({ status: "failed", stage: "aborted", diagnostics: [{ code: "evaluation/aborted", message: "stop now" }] });
    });
  });

  it("fails a macro expansion bomb with limit/expansion", async () => {
    await withHost(async (host, sessionId) => {
      const state = await host.checkedRun({
        sessionId, sourceId: "bomb.lisp", source: "(macro (boom x) `(boom (boom ~x)))\n(boom 1)", grants: [],
        limits: { maxExpansionSteps: 200 },
      });
      expect(state).toMatchObject({ status: "failed", stage: "limit", diagnostics: [{ code: "limit/expansion", details: { limit: 200 } }] });
    });
  });

  it("fails an oversized result with limit/result-size and keeps small ones", async () => {
    await withHost(async (host, sessionId) => {
      const source = '(str "abcdefghij" "klmnopqrst")';
      const failed = await host.checkedRun({ sessionId, sourceId: "big.lisp", source, grants: [], limits: { maxResultBytes: 8 } });
      expect(failed).toMatchObject({ status: "failed", stage: "limit", diagnostics: [{ code: "limit/result-size", details: { limit: 8 } }] });
      const ok = await host.checkedRun({ sessionId, sourceId: "big.lisp", source, grants: [], limits: { maxResultBytes: 4096 } });
      expect(ok.status).toBe("completed");
    });
  });

  it("stops before the next host call once maxHostCalls is spent", async () => {
    await withHost(async (host, sessionId) => {
      const source = '(let [a (read-file "1.txt")]\n  (read-file "2.txt"))';
      let state = await host.checkedRun({
        sessionId, sourceId: "calls.lisp", source, grants: [{ name: "read-file", mode: "allow" }], limits: { hostCalls: 1 },
      });
      let pauses = 0;
      while (state.status === "host-call") {
        pauses++;
        state = (await host.resumeHostCall({
          sessionId, evaluationId: state.call.evaluationId, callId: state.call.callId,
          result: { ok: true, value: { kind: "string", value: "x" } },
        })) as CheckedRunState;
      }
      expect(pauses).toBe(1);
      expect(state).toMatchObject({ status: "failed", stage: "limit", diagnostics: [{ code: "limit/host-calls", span: { startLine: 2, startColumn: 3 } }] });
    });
  });

  it("does not count time spent waiting on the host against the deadline", async () => {
    await withHost(async (host, sessionId) => {
      let state = await host.checkedRun({
        sessionId, sourceId: "wait.lisp", source: '(read-file "a.txt")', grants: [{ name: "read-file", mode: "ask" }],
        limits: { timeoutMs: 300 },
      });
      expect(state.status).toBe("host-call");
      await new Promise((resolve) => setTimeout(resolve, 450));
      if (state.status === "host-call") {
        state = (await host.resumeHostCall({
          sessionId, evaluationId: state.call.evaluationId, callId: state.call.callId,
          result: { ok: true, value: { kind: "string", value: "late" } },
        })) as CheckedRunState;
      }
      expect(state.status).toBe("completed");
    });
  });

  it("accepts the new limits over the JSON ABI and rejects invalid ones", async () => {
    const abi = new JsonAbi();
    const send = (input: unknown) => abi.handleJson(JSON.stringify(input));
    const { sessionId } = (await send({ op: "openSession" })).value as { sessionId: string };
    const limited = await send({
      op: "checkedRun", sessionId, sourceId: "loop.lisp", source: spin, grants: [],
      limits: { steps: 2_000_000_000, timeoutMs: 80 },
    });
    expect(limited.value).toMatchObject({ status: "failed", stage: "limit", diagnostics: [{ code: "limit/time" }] });
    expect(await send({ op: "checkedRun", sessionId, source: "1", grants: [], limits: { maxResultBytes: 0 } }))
      .toMatchObject({ ok: false, diagnostics: [{ code: "abi/invalid-request" }] });
    expect(await send({ op: "evaluateInSession", sessionId, source: spin, stepLimit: 2_000_000_000, timeoutMs: 80 }))
      .toMatchObject({ value: { status: "failed", diagnostics: [{ code: "limit/time" }] } });
  });
});

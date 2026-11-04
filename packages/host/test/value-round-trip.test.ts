import { expect, it } from "vitest";
import { TsLanguageHost } from "../src/index.js";

const echo = [{ name: "echo", arity: 1, handler: { kind: "host-effect", effect: "test/echo" } }] as const;

/** Evaluate `source`, answering every host call with its own argument. */
async function echoed(source: string) {
  const host = new TsLanguageHost();
  const { sessionId } = await host.openSession({});
  try {
    await host.configureSession({ sessionId, hostBuiltins: [...echo] });
    let state = await host.evaluateInSession({ sessionId, source });
    while (state.status === "host-call") {
      const { evaluationId, callId, args } = state.call;
      state = await host.resumeHostCall({ sessionId, evaluationId, callId, result: { ok: true, value: args[0]! } });
    }
    return state;
  } finally {
    await host.closeSession({ sessionId });
  }
}

it("keeps keyword, symbol, and string map keys through a host call", async () => {
  const source = `{:a 1 "b" 2 ":c" 3 (quote d) 4}`;
  const direct = await new TsLanguageHost().evaluate({ source });
  const state = await echoed(`(echo ${source})`);
  expect(state).toMatchObject({ status: "completed", result: { printed: direct.printed } });
  if (state.status !== "completed") throw new Error("expected completion");
  expect(state.result.value).toMatchObject({
    kind: "map",
    entries: [
      { key: { kind: "keyword", value: ":a" } },
      { key: { kind: "string", value: "b" } },
      { key: { kind: "string", value: ":c" } },
      { key: { kind: "symbol", value: "d" } },
    ],
  });
});

it("resolves a retained function returned from a host call", async () => {
  expect(await echoed("((echo (fn [x] (+ x 1))) 41)")).toMatchObject({
    status: "completed",
    result: { value: { kind: "int", value: 42 } },
  });
});

// Runs inside a node:worker_threads Worker. It owns the Forma engine, so a runaway
// or crashing program can be stopped by the parent with `worker.terminate()`.
import { parentPort } from "node:worker_threads";
import { createDefaultLanguageHost } from "@forma-language/forma";

const host = createDefaultLanguageHost();
const { sessionId } = await host.openSession();
await host.configureSession({
  sessionId,
  hostBuiltins: [{
    name: "read-note",
    arity: 1,
    purity: "read",
    typeScheme: { kind: "function", params: [{ kind: "type", name: "String" }], result: { kind: "type", name: "String" } },
    handler: { kind: "host-effect", effect: "notes.read" },
  }],
});

// The untrusted program never sees this table: host calls are answered here, in
// the worker, by code the embedder wrote. Validate arguments; this is the trust boundary.
const notes = { welcome: "Hello from the notes capability" };
const answer = (call) => {
  const key = call.args[0]?.kind === "string" ? call.args[0].value : undefined;
  if (key === undefined || !Object.hasOwn(notes, key)) {
    return { ok: false, diagnostics: [{ code: "capability/denied", severity: "error", message: `Unknown note "${key}".` }] };
  }
  return { ok: true, value: { kind: "string", value: notes[key] } };
};

parentPort.on("message", async ({ id, source, limits }) => {
  let state = await host.checkedRun({ sessionId, sourceId: `job-${id}.lisp`, source, grants: [{ name: "read-note", mode: "allow" }], limits });
  while (state.status === "host-call") {
    state = await host.resumeHostCall({ sessionId, evaluationId: state.call.evaluationId, callId: state.call.callId, result: answer(state.call) });
  }
  parentPort.postMessage({ id, state });
});

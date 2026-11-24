// Runs inside a node:worker_threads Worker. Owns the Forma host session so a
// runaway program can be terminated by the parent with `worker.terminate()`.
import { readFile } from "node:fs/promises";
import { parentPort } from "node:worker_threads";
import {
  createDefaultLanguageHost,
  JOURNAL_FORMAT,
  parseJournalJsonl,
  serializeJournalJsonl,
} from "@forma-language/forma";

const preludeSource = await readFile(new URL("prelude.lisp", import.meta.url), "utf8");
const host = createDefaultLanguageHost();
const { sessionId } = await host.openSession();

await host.configureSession({
  sessionId,
  hostBuiltins: [
    {
      name: "fetch-incident",
      arity: 1,
      purity: "read",
      typeScheme: {
        kind: "function",
        params: [{ kind: "type", name: "String" }],
        result: { kind: "type", name: "String" },
      },
      handler: { kind: "host-effect", effect: "incident.read" },
    },
    {
      name: "post-alert",
      arity: 2,
      purity: "write",
      typeScheme: {
        kind: "function",
        params: [
          { kind: "type", name: "String" },
          { kind: "type", name: "String" },
        ],
        result: { kind: "type", name: "Bool" },
      },
      handler: { kind: "host-effect", effect: "alert.post" },
    },
    {
      name: "delete-cluster",
      arity: 1,
      purity: "write",
      typeScheme: {
        kind: "function",
        params: [{ kind: "type", name: "String" }],
        result: { kind: "type", name: "Bool" },
      },
      handler: { kind: "host-effect", effect: "cluster.delete" },
    },
  ],
});

const loaded = await host.loadSource({
  sessionId,
  sourceId: "prelude.lisp",
  source: preludeSource,
  kind: "prelude",
});
if (loaded.diagnostics.some(d => d.severity === "error")) {
  throw new Error(`Failed to load prelude: ${JSON.stringify(loaded.diagnostics)}`);
}

const incidents = {
  "INC-404": "checkout-api latency > 2s in us-east-1",
  "INC-500": "payment-worker queue depth exceeded threshold",
};

const forbiddenTargets = new Set(["prod-root", "billing-db"]);

/**
 * Approval hook inspecting the capability call, its arguments, and the author
 * source span before executing any live handler.
 */
function approveHostCall(call, source) {
  const snippet = call.span ? source.slice(call.span.startOffset, call.span.endOffset) : null;
  const args = call.args.map(arg => (arg.kind === "string" ? arg.value : arg));
  const auditEntry = {
    name: call.name,
    effect: call.effect,
    args,
    span: call.span ?? null,
    snippet,
  };
  if (call.name === "post-alert" && forbiddenTargets.has(args[0])) {
    return {
      decision: { action: "deny", reason: `Channel "${args[0]}" requires manual break-glass approval.` },
      auditEntry: { ...auditEntry, decision: "deny" },
    };
  }
  return {
    decision: { action: "allow" },
    auditEntry: { ...auditEntry, decision: "allow" },
  };
}

function executeLiveCapability(call) {
  if (call.name === "fetch-incident") {
    const id = call.args[0]?.kind === "string" ? call.args[0].value : undefined;
    if (id === undefined || !Object.hasOwn(incidents, id)) {
      return {
        ok: false,
        diagnostics: [{ code: "incident/not-found", severity: "error", message: `Unknown incident "${id}".` }],
      };
    }
    return { ok: true, value: { kind: "string", value: incidents[id] } };
  }
  if (call.name === "post-alert") {
    const channel = call.args[0]?.kind === "string" ? call.args[0].value : undefined;
    const message = call.args[1]?.kind === "string" ? call.args[1].value : undefined;
    if (!channel || !message) {
      return {
        ok: false,
        diagnostics: [{ code: "alert/invalid", severity: "error", message: "Channel and message are required." }],
      };
    }
    return { ok: true, value: { kind: "bool", value: true } };
  }
  return {
    ok: false,
    diagnostics: [{ code: "capability/denied", severity: "error", message: `Capability "${call.name}" is not implemented.` }],
  };
}

parentPort.on("message", async (message) => {
  try {
    if (message.action === "describe") {
      const description = await host.describe({ sessionId });
      parentPort.postMessage({ id: message.id, ok: true, description });
      return;
    }

    if (message.action === "check") {
      const checked = await host.typecheck({
        sessionId,
        sourceId: message.sourceId ?? "agent-policy.lisp",
        source: message.source,
      });
      parentPort.postMessage({ id: message.id, ok: true, checked });
      return;
    }

    const {
      id,
      source,
      sourceId = "agent-policy.lisp",
      grants = [
        { name: "fetch-incident", mode: "ask" },
        { name: "post-alert", mode: "ask" },
      ],
      limits = { steps: 100_000, timeoutMs: 2_000, hostCalls: 8 },
      journalMode,
      journalJsonl,
      allowProgramMismatch = false,
    } = message;

    const journal =
      journalMode === "record"
        ? { mode: "record" }
        : journalMode === "replay"
          ? {
              mode: "replay",
              journal: parseJournalJsonl(journalJsonl),
              allowProgramMismatch,
            }
          : undefined;

    const auditLog = [];
    let liveHostCalls = 0;

    let state = await host.checkedRun({
      sessionId,
      sourceId,
      source,
      grants,
      limits,
      ...(journal ? { journal } : {}),
    });

    while (state.status === "host-call") {
      const { decision, auditEntry } = approveHostCall(state.call, source);
      auditLog.push(auditEntry);
      let result;
      if (decision.action === "deny") {
        result = {
          ok: false,
          diagnostics: [
            {
              code: "capability/denied",
              severity: "error",
              message: decision.reason,
              phase: "host-effect",
              ...(state.call.span ? { span: state.call.span } : {}),
              details: { capability: state.call.name, effect: state.call.effect },
            },
          ],
        };
      } else {
        liveHostCalls += 1;
        result = executeLiveCapability(state.call);
      }
      state = await host.resumeHostCall({
        sessionId,
        evaluationId: state.call.evaluationId,
        callId: state.call.callId,
        result,
      });
    }

    const recordedJsonl =
      state.journal && state.journal.header?.format === JOURNAL_FORMAT
        ? serializeJournalJsonl(state.journal)
        : undefined;

    parentPort.postMessage({
      id,
      ok: true,
      state,
      auditLog,
      liveHostCalls,
      ...(recordedJsonl !== undefined ? { journalJsonl: recordedJsonl } : {}),
    });
  } catch (error) {
    parentPort.postMessage({
      id: message.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import { createLanguage, JOURNAL_FORMAT, parseJournalJsonl } from "@forma-language/forma";

/**
 * Open the high-level Forma policy language facade with the incident-response
 * prelude, pure helper module, typed capabilities, and optional approval hook.
 */
export async function openPolicyLanguage({ onAlert = () => {}, onHostCall } = {}) {
  const [preludeSource, policySource] = await Promise.all([
    readFile(new URL("prelude.lisp", import.meta.url), "utf8"),
    readFile(new URL("policy.lisp", import.meta.url), "utf8"),
  ]);
  const incidents = {
    "INC-404": "checkout-api latency > 2s in us-east-1",
    "INC-500": "payment-worker queue depth exceeded threshold",
  };
  return createLanguage({
    preludes: [{ id: "prelude.lisp", source: preludeSource }],
    modules: [{ id: "policy.lisp", source: policySource }],
    onHostCall,
    capabilities: {
      "fetch-incident": {
        arity: 1,
        purity: "read",
        typeScheme: {
          kind: "function",
          params: [{ kind: "type", name: "String" }],
          result: { kind: "type", name: "String" },
        },
        handler: (id) => {
          if (typeof id !== "string" || !Object.hasOwn(incidents, id)) {
            return {
              ok: false,
              diagnostics: [{ code: "incident/not-found", severity: "error", message: `Unknown incident "${id}".` }],
            };
          }
          return { ok: true, value: incidents[id] };
        },
      },
      "post-alert": {
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
        handler: (channel, message) => {
          onAlert({ channel, message });
          return { ok: true, value: true };
        },
      },
    },
  });
}

/**
 * Execute an agent-authored policy program inside an isolated worker thread
 * with cooperative Forma budgets AND a hard wall-clock termination backstop.
 */
export async function runInWorker(
  request,
  { killAfterMs = 10_000, resourceLimits = { maxOldGenerationSizeMb: 128 } } = {},
) {
  const worker = new Worker(new URL("worker.mjs", import.meta.url), { resourceLimits });
  const id = 1;
  try {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        resolve({
          ok: true,
          liveHostCalls: 0,
          auditLog: [],
          state: {
            status: "failed",
            stage: "killed",
            diagnostics: [{ code: "limit/time", severity: "error", message: `Worker terminated after ${killAfterMs}ms.` }],
          },
        });
      }, killAfterMs);
      worker.once("message", (message) => {
        clearTimeout(timer);
        resolve(message);
      });
      worker.once("error", (error) => {
        clearTimeout(timer);
        resolve({
          ok: false,
          liveHostCalls: 0,
          auditLog: [],
          state: {
            status: "failed",
            stage: "killed",
            diagnostics: [{ code: "internal/error", severity: "error", message: `Worker crashed: ${error.code ?? error.name}` }],
          },
        });
      });
      worker.once("exit", (code) => {
        clearTimeout(timer);
        if (code !== 0) reject(new Error(`Worker exited with code ${code}`));
      });
      worker.postMessage({ id, ...request });
    });
  } finally {
    await worker.terminate();
  }
}

export const SAMPLE_PROGRAM = [
  '(let [detail (fetch-incident "INC-404")]',
  '  (post-alert "ops-oncall" (str "[sev1] INC-404: " detail))',
  '  detail)',
].join("\n");

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const lang = await openPolicyLanguage();
  try {
    const description = lang.describe();
    const checked = await lang.check('(let [d (fetch-incident "INC-404")] (post-alert "ops-oncall" (format-alert "INC-404" "sev1" d)) d)');
    const live = await runInWorker({
      action: "run",
      source: SAMPLE_PROGRAM,
      journalMode: "record",
    });
    const replay = await runInWorker({
      action: "run",
      source: SAMPLE_PROGRAM,
      journalMode: "replay",
      journalJsonl: live.journalJsonl,
    });
    const parsedJournal = parseJournalJsonl(live.journalJsonl);
    console.log(JSON.stringify({
      forms: description.forms.map(f => f.name),
      manifestCapabilities: checked.manifest.capabilities.map(c => c.name),
      journalFormat: parsedJournal.header.format === JOURNAL_FORMAT ? JOURNAL_FORMAT : "unexpected",
      liveHostCalls: live.liveHostCalls,
      replayHostCalls: replay.liveHostCalls,
      result: replay.state.result?.value,
    }, null, 2));
  } finally {
    await lang.close();
  }
}

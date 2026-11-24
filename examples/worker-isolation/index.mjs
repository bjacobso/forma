import { Worker } from "node:worker_threads";
import { pathToFileURL } from "node:url";

/**
 * Run untrusted Forma source in a worker thread with cooperative budgets AND a
 * hard wall-clock backstop: if the worker does not answer within `killAfterMs`
 * (a defect in the engine, a hung builtin), the parent terminates it.
 */
export async function runIsolated(source, { limits = {}, killAfterMs = 10_000, resourceLimits = { maxOldGenerationSizeMb: 128 } } = {}) {
  const worker = new Worker(new URL("worker.mjs", import.meta.url), { resourceLimits });
  const id = 1;
  try {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve({ status: "failed", stage: "killed", diagnostics: [{ code: "limit/time", severity: "error", message: `Worker terminated after ${killAfterMs}ms.` }] }), killAfterMs);
      worker.once("message", message => { clearTimeout(timer); resolve(message.state); });
      worker.once("error", error => { clearTimeout(timer); resolve({ status: "failed", stage: "killed", diagnostics: [{ code: "internal/error", severity: "error", message: `Worker crashed: ${error.code ?? error.name}` }] }); });
      worker.once("exit", code => { clearTimeout(timer); if (code !== 0) reject(new Error(`Worker exited with ${code}`)); });
      worker.postMessage({ id, source, limits });
    });
  } finally {
    await worker.terminate();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(await runIsolated('(read-note "welcome")'), null, 2));
}

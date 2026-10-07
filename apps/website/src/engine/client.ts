import {
  timeoutRunResult,
  type EnginePassName,
  type RunResult,
  type WorkerRequest,
  type WorkerResponse,
} from "./protocol";

const WATCHDOG_MS = 2_000;
const STARTUP_MS = 10_000;

export class EngineClient {
  private worker: Worker | null = null;
  private ready = false;
  private nextId = 1;
  private pending = new Map<
    number,
    {
      request: WorkerRequest;
      resolve: (result: RunResult) => void;
      reject: (error: Error) => void;
      timeout: number;
    }
  >();

  run(source: string, passes: readonly EnginePassName[], sourceId = "demo", dialect?: "effect"): Promise<RunResult> {
    const id = this.nextId++;
    const worker = this.ensureWorker();
    const request: WorkerRequest = { id, sourceId, source, passes, ...(dialect ? { dialect } : {}) };

    return new Promise((resolve, reject) => {
      const timeout = this.watchdog(id, !this.ready);
      this.pending.set(id, { request, resolve, reject, timeout });
      if (this.ready) worker.postMessage(request);
    });
  }

  dispose(): void {
    this.restart();
  }

  private watchdog(id: number, startup: boolean): number {
    return window.setTimeout(() => {
      const pending = this.pending.get(id);
      if (!pending) return;
      this.pending.delete(id);
      this.restart();
      if (startup) pending.reject(new Error("Compiler worker startup timed out after 10 seconds."));
      else pending.resolve(timeoutRunResult(pending.request, WATCHDOG_MS));
    }, startup ? STARTUP_MS : WATCHDOG_MS);
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;

    const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      if (this.worker !== worker) return;
      const message = event.data;
      if (message.kind === "ready") {
        this.ready = true;
        for (const [id, pending] of this.pending) {
          window.clearTimeout(pending.timeout);
          pending.timeout = this.watchdog(id, false);
          worker.postMessage(pending.request);
        }
        return;
      }
      const id = message.kind === "result" ? message.result.id : message.id;
      const pending = this.pending.get(id);
      if (!pending) return;
      window.clearTimeout(pending.timeout);
      this.pending.delete(id);
      if (message.kind === "result") {
        pending.resolve(message.result);
      } else {
        pending.reject(new Error(message.message));
      }
    };
    worker.onerror = (event) => {
      if (this.worker === worker) this.restart(new Error(event.message || "Compiler worker failed."));
    };
    this.worker = worker;
    return worker;
  }

  private restart(error = new Error("Compiler worker stopped before the run completed.")): void {
    this.worker?.terminate();
    this.worker = null;
    this.ready = false;
    for (const pending of this.pending.values()) {
      window.clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

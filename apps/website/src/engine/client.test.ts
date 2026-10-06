import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EngineClient } from "./client";
import type { WorkerRequest, WorkerResponse } from "./protocol";

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  requests: WorkerRequest[] = [];
  terminated = false;
  constructor() {
    FakeWorker.instances.push(this);
  }
  postMessage(request: WorkerRequest) {
    this.requests.push(request);
  }
  terminate() {
    this.terminated = true;
  }
  emit(data: WorkerResponse) {
    this.onmessage?.({ data } as MessageEvent<WorkerResponse>);
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeWorker.instances = [];
  vi.stubGlobal("window", { setTimeout, clearTimeout });
  vi.stubGlobal("Worker", FakeWorker);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("lets a cold worker load before starting the execution watchdog", async () => {
  const client = new EngineClient();
  const result = client.run("(+ 1 2)", ["evaluate"]);
  const worker = FakeWorker.instances[0]!;
  vi.advanceTimersByTime(4_000);
  expect(worker.terminated).toBe(false);
  expect(worker.requests).toEqual([]);
  worker.emit({ kind: "ready" });
  const request = worker.requests[0]!;
  const completed = {
    id: request.id,
    sourceId: request.sourceId,
    passResults: [],
    diagnostics: [],
  };
  worker.emit({ kind: "result", result: completed });
  await expect(result).resolves.toEqual(completed);
  vi.advanceTimersByTime(10_000);
  expect(worker.terminated).toBe(false);
  client.dispose();
});

it("still stops execution after two seconds once the worker is ready", async () => {
  const client = new EngineClient();
  const result = client.run("(loop)", ["evaluate"]);
  const worker = FakeWorker.instances[0]!;
  worker.emit({ kind: "ready" });
  vi.advanceTimersByTime(2_000);
  await expect(result).resolves.toMatchObject({
    stoppedAt: "evaluate",
    diagnostics: [{ code: "WorkerTimeout", details: { timeoutMs: 2_000 } }],
  });
  expect(worker.terminated).toBe(true);
});

it("rejects queued runs when startup stalls or the client is disposed", async () => {
  const client = new EngineClient();
  const stalled = client.run("1", ["evaluate"]);
  const rejected = expect(stalled).rejects.toThrow("startup timed out");
  vi.advanceTimersByTime(10_000);
  await rejected;
  expect(FakeWorker.instances[0]!.terminated).toBe(true);
  const next = client.run("2", ["evaluate"]);
  const disposed = expect(next).rejects.toThrow("stopped before the run completed");
  client.dispose();
  await disposed;
});

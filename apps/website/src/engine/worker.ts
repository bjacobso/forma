import { evaluate, expand, parse, typecheck } from "@formalang/ts/engine";
import type { PassName } from "@formalang/ts/engine";
import {
  hasErrors,
  serializablePassResult,
  type RunRequest,
  type TimedPassResult,
  type WorkerResponse,
} from "./protocol";

const ctx: DedicatedWorkerGlobalScope = self as DedicatedWorkerGlobalScope;

ctx.onmessage = (event: MessageEvent<RunRequest>) => {
  void run(event.data);
};

async function run(request: RunRequest): Promise<void> {
  try {
    const passResults: TimedPassResult[] = [];
    let stoppedAt: PassName | undefined;

    for (const pass of request.passes) {
      const started = performance.now();
      const result = await runPass(pass, request);
      const timed = serializablePassResult({
        ...result,
        durationMs: Math.max(0, performance.now() - started),
      } as TimedPassResult);
      passResults.push(timed as TimedPassResult);
      if (hasErrors(result)) {
        stoppedAt = pass;
        break;
      }
    }

    post({
      kind: "result",
      result: {
        id: request.id,
        sourceId: request.sourceId,
        passResults,
        diagnostics: passResults.flatMap((result) => result.diagnostics),
        ...(stoppedAt ? { stoppedAt } : {}),
      },
    });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    post({
      kind: "fatal",
      id: request.id,
      message: err.message,
      stack: err.stack,
    });
  }
}

async function runPass(pass: PassName, request: RunRequest) {
  switch (pass) {
    case "parse":
      return parse({ sourceId: request.sourceId, source: request.source });
    case "expand":
      return expand({ sourceId: request.sourceId, source: request.source });
    case "typecheck":
      return typecheck({
        sourceId: request.sourceId,
        source: request.source,
        result: "per-expression",
      });
    case "evaluate":
      return await evaluate({
        sourceId: request.sourceId,
        source: request.source,
        stepLimit: 50_000,
      });
  }
}

function post(message: WorkerResponse): void {
  ctx.postMessage(message);
}

/// <reference lib="webworker" />
/** The reading editor's analysis worker: language services from ./analysis over postMessage. */
import { analyze, complete, definition, inspect, problems, snippets, warm } from "./analysis";
import type { ReadingRequest, ReadingResponse } from "./protocol";

const ctx = self as unknown as DedicatedWorkerGlobalScope;

async function answer(request: ReadingRequest): Promise<ReadingResponse> {
  switch (request.kind) {
    case "analyze": return { id: request.id, kind: "analyze", analysis: analyze(request.files, request.file) };
    case "inspect": return { id: request.id, kind: "inspect", inspection: await inspect(request.files, request.file, request.from, request.to) };
    case "definition": return { id: request.id, kind: "definition", location: definition(request.files, request.file, request.offset) };
    case "complete": return { id: request.id, kind: "complete", completions: complete(request.files, request.file, request.offset) };
    case "problems": return { id: request.id, kind: "problems", problems: problems(request.files) };
    case "snippets": return { id: request.id, kind: "snippets", snippets: snippets(request.files, request.file) };
  }
}

ctx.onmessage = async (event: MessageEvent<ReadingRequest>) => {
  let response: ReadingResponse;
  try {
    response = await answer(event.data);
  } catch (error) {
    response = { id: event.data.id, kind: "error", message: error instanceof Error ? error.message : String(error) };
  }
  ctx.postMessage(response);
};

warm();

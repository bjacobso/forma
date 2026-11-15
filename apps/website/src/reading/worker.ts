/// <reference lib="webworker" />
/** The reading editor's analysis worker: language services from ./analysis over postMessage. */
import { analyze, complete, definition, dispose, generated, inScope, inspect, preludeText, problems, references, rename, snippets, symbols, warm } from "./analysis";
import type { ReadingRequest, ReadingResponse } from "./protocol";

const ctx = self as unknown as DedicatedWorkerGlobalScope;

async function answer(request: ReadingRequest): Promise<ReadingResponse> {
  inScope(request.scope, request.setup);
  switch (request.kind) {
    case "analyze": return { id: request.id, kind: "analyze", analysis: analyze(request.files, request.file) };
    case "inspect": return { id: request.id, kind: "inspect", inspection: inspect(request.files, request.file, request.from, request.to) };
    case "definition": return { id: request.id, kind: "definition", location: definition(request.files, request.file, request.offset) };
    case "complete": return { id: request.id, kind: "complete", completions: complete(request.files, request.file, request.offset) };
    case "problems": return { id: request.id, kind: "problems", problems: problems(request.files) };
    case "snippets": return { id: request.id, kind: "snippets", snippets: snippets(request.files, request.file) };
    case "references": return { id: request.id, kind: "references", references: references(request.files, request.file, request.offset) };
    case "rename": return { id: request.id, kind: "rename", rename: rename(request.files, request.file, request.offset, request.name) };
    case "symbols": return { id: request.id, kind: "symbols", symbols: symbols(request.files) };
    case "generated": return { id: request.id, kind: "generated", generated: generated(request.files, request.file) };
    case "prelude": return { id: request.id, kind: "prelude", source: preludeText(request.file) };
    case "dispose": dispose(request.scope); return { id: request.id, kind: "dispose" };
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

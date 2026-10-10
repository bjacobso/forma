import { SegmentParser, ProtocolError } from "./protocol.js";
import type { Executable } from "./protocol.js";
import type { ExecutionSession, ExecutionResult } from "./runtime.js";

export type TranscriptSegment =
  | { readonly kind: "prose" | "continuation"; readonly responseId: string; readonly text: string }
  | ({ readonly kind: "code" } & Executable)
  | { readonly kind: "result"; readonly responseId: string; readonly result: ExecutionResult };

// Providers expose only decoded text chunks here. Only assistant generations
// enter the parser; user messages, catalogs, results and history never do.
export interface TextAdapter {
  generate(history: readonly TranscriptSegment[]): AsyncIterable<string>;
}

export async function chat(adapter: TextAdapter, executor: ExecutionSession, responsePrefix = "reply", maxGenerations = 4) {
  const history: TranscriptSegment[] = [];
  for (let generation = 1; generation <= maxGenerations; generation++) {
    const responseId = `${responsePrefix}-${generation}`;
    const parser = new SegmentParser(responseId);
    // Breaking calls iterator.return(): a live adapter must cancel the upstream
    // request and discard queued tokens. It must not reuse them as continuation.
    for await (const chunk of adapter.generate(history)) {
      if (parser.push(chunk)) break;
    }
    const segment = parser.finish();
    history.push({ kind: generation === 1 ? "prose" : "continuation", responseId, text: parser.prose });
    if (!segment) return history;
    history.push({ kind: "code", ...segment });
    const result = await executor.execute(segment);
    history.push({ kind: "result", responseId, result });
    // Only now can the adapter generate dependent prose.
  }
  throw new ProtocolError("limit/generations", "Continuation budget exhausted");
}

import {
  chat, chunks, compileCatalog, effectEvidence, ExecutionSession, mockBindings, SegmentParser,
} from "@formalang/host/inline-code-mode";
import type { TranscriptSegment } from "@formalang/host/inline-code-mode";
import catalogSource from "./catalog.forma?raw";
import companion from "./summary-effect.forma?raw";

export const catalog = compileCatalog(catalogSource);
export const evidence = effectEvidence(catalog, companion);

export async function runTranscript(text: string, variant: "primary" | "alternate", allowWrite: boolean, token: number): Promise<readonly TranscriptSegment[]> {
  // The editable input is a recording: check its complete remainder first.
  const recording = new SegmentParser(`recording-${token}`);
  recording.push(text);
  recording.finish();
  const allowed = new Set(["Issues.list-open", "Accounts.list-active"]);
  if (allowWrite) allowed.add("Issues.close");
  const executor = new ExecutionSession(catalog, mockBindings(variant), allowed);
  return chat({ generate(history) {
    const segment = history.findLast((item) => item.kind === "result");
    if (!segment || segment.kind !== "result") return chunks(text);
    const result = segment.result;
    return chunks(result.ok
      ? `The host returned ${JSON.stringify(result.value)}.\n`
      : `The request failed: ${result.diagnostics.map((item) => item.code).join(", ")}. No successful result was returned.\n`);
  } }, executor, `demo-${token}`);
}

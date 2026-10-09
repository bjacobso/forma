import { readFileSync } from "node:fs";
import { chat } from "./chat.ts";
import { chunks, initial, mockBindings, write } from "./fixture.ts";
import { ExecutionSession, effectEvidence } from "./runtime.ts";
import { SegmentParser } from "./protocol.ts";

const args = process.argv.slice(2);
const file = args.find((arg) => !arg.startsWith("--"));
const text = file ? readFileSync(file, "utf8") : args.includes("--write") ? write : initial;
// A recording is already available in full: reject its dependent remainder
// rather than silently discarding it when the simulated stream is cancelled.
const recording = new SegmentParser("recording");
recording.push(text);
recording.finish();
const executor = new ExecutionSession(mockBindings(args.includes("--alternate") ? "alternate" : "primary"));
const transcript = await chat({
  generate(history) {
    const result = history.findLast((item) => item.kind === "result");
    if (!result || result.kind !== "result") return chunks(text);
    // Deterministic fixture continuation, produced from the actual result.
    // This is a stand-in for a new model request, never a fabricated model run.
    const continuation = result.result.ok
      ? `The checked host result is ${JSON.stringify(result.result.value)}.\n`
      : `Execution failed: ${result.result.diagnostics.map((item) => item.code).join(", ")}.\n`;
    return chunks(continuation);
  },
}, executor);
console.log(JSON.stringify({ effectEvidence: effectEvidence(), transcript }, null, 2));

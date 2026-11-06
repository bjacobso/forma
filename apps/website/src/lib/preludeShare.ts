import LZString from "lz-string";
import { readSnapshot, type PreludeDemo } from "./playgroundSnapshot";
export type { PreludeDemo } from "./playgroundSnapshot";

export const defaultPreludeDemo: PreludeDemo = {
  title: "A workflow language in a prelude",
  prelude: `(type StepIR
  {:kind "Step" :name Symbol :action String})

(form (step name action)
  :types {:name (Declares Step) :action String}
  :ir StepIR
  {:kind "Step" :name name :action action})

(type WorkflowIR
  {:kind "Workflow" :name Symbol :steps (List StepIR)})

(form (workflow name step ...)
  :types {:name (Declares Workflow) :step (List step)}
  :ir WorkflowIR
  {:kind "Workflow" :name name :steps step})`,
  source: `;; This prelude defines a plan format, not a durable runtime.
;; Try replacing an action string with a number.
(workflow resolve-issue
  (step implement "agent.implement")
  (step test "process.test")
  (step review "agent.review")
  (step approve "human.approve"))`,
};

export function encodePreludeDemo(demo: PreludeDemo): string {
  return `#demo=${LZString.compressToEncodedURIComponent(JSON.stringify({ version: 1, ...demo }))}`;
}

export function decodePreludeDemo(hash: string): PreludeDemo | null {
  if (!hash.startsWith("#demo=")) return null;
  try {
    const value: unknown = JSON.parse(LZString.decompressFromEncodedURIComponent(hash.slice(6)) ?? "null");
    return readSnapshot(value);
  } catch {
    return null;
  }
}

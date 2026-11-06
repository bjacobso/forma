import { expect, test } from "vitest";
import { compilePreludeDemo } from "./preludeCompiler";
import { defaultPreludeDemo } from "../lib/preludeShare";

test("the shared workflow prelude elaborates the example and rejects an invalid action", () => {
  const request = { id: 1, sourceId: "example.forma", passes: [] as const, prelude: defaultPreludeDemo.prelude, source: defaultPreludeDemo.source };
  const result = compilePreludeDemo(request);
  expect(result.diagnostics).toEqual([]);
  expect(result.declarations).toEqual([{
    kind: "Workflow", name: "resolve-issue", steps: [
      { kind: "Step", name: "implement", action: "agent.implement" },
      { kind: "Step", name: "test", action: "process.test" },
      { kind: "Step", name: "review", action: "agent.review" },
      { kind: "Step", name: "approve", action: "human.approve" },
    ],
  }]);
  const invalid = compilePreludeDemo({ ...request, source: '(workflow fix (step implement 42))' });
  expect(invalid.diagnostics.some(d => d.severity === "error")).toBe(true);
});

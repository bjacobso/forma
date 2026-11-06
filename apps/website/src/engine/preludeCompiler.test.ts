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

test("debug output contains the current syntax, form contracts, provenance and source maps", () => {
  const result = compilePreludeDemo({ id: 1, sourceId: "example.forma", passes: [], prelude: defaultPreludeDemo.prelude, source: defaultPreludeDemo.source });
  expect(result.passResults[0]?.pass).toBe("parse");
  expect(result.preludeDebug?.preludeSyntax.ast.length).toBeGreaterThan(0);
  expect(result.preludeDebug?.forms.map(form => form.name)).toEqual(expect.arrayContaining(["workflow", "step"]));
  expect(result.preludeDebug?.forms.find(form => form.name === "step")?.definition).toMatchObject({ pattern: "(step name action)", holes: { action: "String" }, produces: "StepIR", ir: '{:kind "Step" :name Symbol :action String}' });
  expect(result.preludeDebug?.declarations[0]?.name).toBe("resolve-issue");
  expect(result.preludeDebug?.declarations[0]?.sourceMap.some(entry => entry.span.sourceId === "example.forma")).toBe(true);
  expect(result.preludeDebug?.timings.map(timing => timing.phase)).toEqual(["Read", "Load prelude", "Elaborate"]);
  expect(structuredClone(result)).toEqual(result);
});

test("syntax errors are located in the correct file and do not bootstrap a broken prelude", () => {
  const result = compilePreludeDemo({ id: 1, sourceId: "example.forma", passes: [], prelude: "(form", source: defaultPreludeDemo.source });
  expect(result.stoppedAt).toBe("parse");
  expect(result.diagnostics.some(d => d.span?.sourceId === "prelude.forma")).toBe(true);
  expect(result.declarations).toEqual([]);
});

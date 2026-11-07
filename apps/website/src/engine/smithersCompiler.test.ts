import { expect, test } from "vitest";
import { compilePreludeDemo } from "./preludeCompiler";
import { smithersPreludeDemo } from "../lib/smithersDemo";

test("the executable Smithers example uses the ordinary playground compiler", () => {
  const result = compilePreludeDemo({ id: 1, sourceId: "example.forma", passes: [], ...smithersPreludeDemo });
  expect(result.diagnostics).toEqual([]);
  expect(result.declarations).toHaveLength(7);
  expect(Array.isArray(result.declarations) && result.declarations.at(-1)).toMatchObject({ kind: "Workflow", name: "resolve-issue", return: "outcome" });
  expect(result.preludeDebug?.forms.map(form => form.name)).toEqual(expect.arrayContaining(["branch", "poll", "ask", "native-flow"]));
  const invalid = compilePreludeDemo({ id: 2, sourceId: "example.forma", passes: [], ...smithersPreludeDemo,
    source: smithersPreludeDemo.source.replace('["patch" "revision"]', '["patch" "missing"]') });
  expect(invalid.diagnostics.some(d => d.code === "workflow/expression" && d.span?.sourceId === "example.forma")).toBe(true);
});

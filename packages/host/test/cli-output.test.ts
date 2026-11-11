import { describe, expect, it } from "vitest";
import { diagnosticMessage, renderDiagnostics } from "../src/cli/output.js";

describe("CLI diagnostic rendering", () => {
  it("renders multiline spans, warnings, help and replacement fixes", () => {
    const source = '(+ 1\n  "bad")';
    const span = { sourceId: "main.lisp", startOffset: 0, endOffset: source.length };
    const result = renderDiagnostics([{
      code: "typecheck/type-mismatch", severity: "warning", message: "Expected a number",
      span, help: "Use a numeric value.", fix: [{ span: { ...span, startOffset: 7, endOffset: 12 }, newText: "2" }],
    }], () => source, false);
    expect(result).toBe('warning[typecheck/type-mismatch]: Expected a number\n  --> main.lisp:1:1\n   |\n 1 | (+ 1\n   | ^^^^^\n  = help: Use a numeric value.\n  = fix: replace `"bad"` with `2`\n0 errors, 1 warnings\n');
  });
  it("handles missing source text and opt-in colors", () => {
    const diagnostic = { code: "io/error", severity: "error" as const, message: "missing file" };
    expect(renderDiagnostics([diagnostic], () => undefined, false)).toBe("error[io/error]: missing file\n1 errors, 0 warnings\n");
    expect(renderDiagnostics([diagnostic], () => undefined, true)).toContain("\x1b[31merror[io/error]\x1b[0m");
  });
  it("resolves author names and leaves the rest of the message alone", () => {
    expect(diagnosticMessage("Unknown x__forma_ab_d12")).toBe("Unknown x");
    expect(diagnosticMessage("Keep (at line 2, column 3) inside")).toBe("Keep (at line 2, column 3) inside");
  });
});

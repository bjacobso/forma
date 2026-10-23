import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { generateEmailProgram } from "../src/Email.js";

const source = readFileSync(new URL("../../../conformance/effect-typescript/cases/email-warmup/program.lisp", import.meta.url), "utf8");
describe("Email prelude", () => {
  test("lowers a rule through the Effect checker", () => {
    const result = generateEmailProgram(source);
    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain('export const LaunchWarmup3 = { "name": "launch-warmup-3"');
  });
  test("reads durations as hours", () => {
    const result = generateEmailProgram(source.replace("(defer 6h)", "(defer 2d)"));
    expect(result.code).toContain("defer(48)");
  });
  test.each([
    [source.replace('(rule "launch-warmup-3"', '(rule "Launch Warmup"'), "email/rule-name", "an invalid rule name"],
    [`${source}\n(rule "second" (lanes (lane "a" :per-hour 1)) (send "a"))`, "email/cardinality", "a second rule"],
    [source.replace("(lanes", "(lane-set"), "email/lanes", "a missing lanes form"],
    [source.replace('(when (tag? "customer")', '(when (tag? "customer") (skip "x")'), "email/when", "a malformed when"],
    [`${source}\n(typo ignored)`, "email/top-level-form", "an unknown top-level form"],
  ].map(([program, code, reason]) => ({ program: program!, code: code!, reason: reason! })))("rejects $reason", ({ program, code }) => {
    const result = generateEmailProgram(program);
    expect(result.ok).toBe(false);
    expect(result.code).toBeUndefined();
    expect(result.diagnostics.map(d => d.code)).toContain(code);
    expect(result.diagnostics.every(d => d.span?.sourceId === "rules.forma")).toBe(true);
  });
});

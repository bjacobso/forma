import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { generateElmProgram } from "../src/Elm.js";

const source = readFileSync(new URL("../../../conformance/effect-typescript/cases/elm-counter/program.lisp", import.meta.url), "utf8");
describe("Elm prelude", () => {
  test("checks a headless Foldkit application", () => {
    const result = generateElmProgram(source);
    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain("Command.define");
  });
  test.each([
    [source.replace('[:span (str model.count)]', '[:span (let [ignored (log "oops")] "x")]'), "effect hidden in view"],
    [source + "\n(typo ignored)", "unknown top-level form"],
    [source.replace("  Increment (with", "  _ (with"), "wildcard update"],
    [source.replace(":load-count)", ":typo)"), "unknown command"],
  ].map(([program, reason]) => ({ program: program!, reason })))("rejects $reason", ({ program }) => {
    const result = generateElmProgram(program);
    expect(result.ok).toBe(false);
    expect(result.code).toBeUndefined();
    expect(result.diagnostics.every(d => d.span?.sourceId === "app.forma")).toBe(true);
  });
});

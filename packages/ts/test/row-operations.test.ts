import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { typecheck } from "../src/Engine.js";

interface RowFixture {
  id: string;
  sourceFile: string;
  expected: { typecheck: { type?: string; diagnostics: unknown[] } };
  expectedMessage?: string;
}

const parityRoot = new URL("../../../conformance/engine-parity/", import.meta.url);
const fixtures: RowFixture[] = JSON.parse(readFileSync(
  new URL("cases.json", parityRoot), "utf8",
)).cases.filter((fixture: RowFixture) => fixture.id.startsWith("row-operations/"));

describe("shared row operation conformance", () => {
  test.each(fixtures)("$id", fixture => {
    const source = readFileSync(new URL(fixture.sourceFile, parityRoot), "utf8");
    const result = typecheck({ source, sourceId: `engine-parity/${fixture.id}` });
    const actual = {
      ...(result.display === undefined ? {} : { type: result.display }),
      diagnostics: result.diagnostics.map(diagnostic => ({
        code: diagnostic.code, severity: diagnostic.severity, phase: diagnostic.phase,
        ...(diagnostic.span ? { span: {
          sourceId: diagnostic.span.sourceId,
          startOffset: diagnostic.span.startOffset,
          endOffset: diagnostic.span.endOffset,
        } } : {}),
      })),
    };
    expect(actual).toEqual(fixture.expected.typecheck);
    if (fixture.expectedMessage) expect(result.diagnostics[0]?.message).toContain(fixture.expectedMessage);
  });
});

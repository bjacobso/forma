import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { bootstrapFromSources, elaborateSources } from "../src/Descriptor.js";
import { preludeSource } from "../src/Preludes.js";

const root = resolve(import.meta.dirname, "../../../conformance/einvoice");
const read = (file: string) => readFileSync(resolve(root, file), "utf8");
const prelude = bootstrapFromSources(
  preludeSource("compiler.lisp"),
  preludeSource("ontology.lisp"),
  read("prelude.lisp"),
);
const sources = ["model.lisp", "parties.lisp", "lines.lisp"].map(file => ({
  sourceId: `einvoice/${file}`, source: read(file),
}));
const expectedCodes: Record<string, string[]> = {
  "mixed": [],
  "zero": [],
  "bad-presence": ["BR-01", "BR-02", "BR-16", "BR-CO-10", "BR-CO-13", "BR-S-01", "BR-S-08", "BR-S-08", "BR-Z-08"],
  "bad-totals": ["BR-CO-10", "BR-CO-13", "BR-CO-14", "BR-CO-15", "BR-CO-16"],
  "bad-groups": ["BR-CO-14", "BR-S-01", "BR-Z-01"],
  "bad-lines": ["BR-S-05", "BR-Z-05"],
  "bad-breakdowns": ["BR-S-09-exact", "BR-S-10", "BR-Z-09", "BR-Z-10"],
  "bad-taxable": ["BR-S-08", "BR-Z-08"],
  "bad-schema": ["elaborate/hole-type", "elaborate/hole-type"],
  "fractional-cent": ["BR-S-09-exact"],
};

// Stored expectations pin record projections and author blame, not benchmark results.
describe("EN 16931 ontology fit spike", () => {
  test("every authored case has an independent rule expectation", () => {
    expect(readdirSync(resolve(root, "cases")).sort()).toEqual(
      Object.keys(expectedCodes).map(name => `${name}.lisp`).sort(),
    );
  });
  for (const [name, codes] of Object.entries(expectedCodes)) test(name, () => {
    const sourceId = `einvoice/cases/${name}.lisp`;
    const source = read(`cases/${name}.lisp`);
    const result = elaborateSources([...sources, { sourceId, source }], { prelude });
    expect(result.ok).toBe(codes.length === 0);
    expect(result.diagnostics.map(d => d.code)).toEqual(
      codes.map(code => code.includes("/") ? code : `einvoice/${code}`),
    );
    for (const diagnostic of result.diagnostics) {
      expect(diagnostic.severity).toBe("error");
      expect(diagnostic.span?.sourceId).toBe(sourceId);
      expect(source.slice(diagnostic.span!.startOffset, diagnostic.span!.endOffset)).toMatch(/^\{/);
    }
    const actual = {
      ok: result.ok,
      records: result.ok ? result.declarations.filter(d => d.summary.kind === "Record").map(d => d.payload) : [],
      diagnostics: result.diagnostics.map(d => ({
        code: d.code, severity: d.severity, span: d.span,
        text: source.slice(d.span!.startOffset, d.span!.endOffset),
      })),
    };
    const path = resolve(root, "expected", `${name}.json`);
    if (process.env.FORMA_UPDATE_GOLDEN === "1") writeFileSync(path, `${JSON.stringify(actual, null, 2)}\n`);
    expect(actual).toEqual(JSON.parse(readFileSync(path, "utf8")));
    if (result.ok) expect(actual.records).toHaveLength(11);
  });
});

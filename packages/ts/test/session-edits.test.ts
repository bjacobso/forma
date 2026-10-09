import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AnalysisWorkspace } from "../src/Analysis.js";
import { elaborateSources } from "../src/descriptor/elaborate.js";
import { bootstrapOntologyPreludes } from "../src/Preludes.js";

const scenarios = JSON.parse(readFileSync(new URL("../../../conformance/session-load/scenarios.json", import.meta.url), "utf8"));

describe("fresh analysis equivalence (OCaml incremental and artifact-cache scenarios)", () => {
  it("edits, removes, and replaces forms without stale source bindings", () => {
    const workspace = new AnalysisWorkspace();
    workspace.setDocument("incremental.forma", scenarios.incremental.before);
    workspace.analysis("incremental.forma");
    workspace.symbols();
    for (const edit of scenarios.incremental.edits) {
      workspace.setDocument("incremental.forma", edit.source);
      const fresh = new AnalysisWorkspace();
      fresh.setDocument("incremental.forma", edit.source);
      expect(workspace.analysis("incremental.forma")).toEqual(fresh.analysis("incremental.forma"));
      expect(workspace.symbols()).toEqual(fresh.symbols());
      expect(workspace.documentSymbols("incremental.forma").map(s => s.name).sort()).toEqual(edit.expectedBindings);
    }
    workspace.removeDocument("incremental.forma");
    expect(workspace.symbols().definitions).toEqual([]);
  });

  it("schema removal invalidates dependent artifacts instead of leaving stale declarations", () => {
    const schema = scenarios.schema;
    const prelude = bootstrapOntologyPreludes();
    const sources = [{ sourceId: "schema.forma", source: schema.before }, { sourceId: "data.forma", source: schema.data }];
    expect(elaborateSources(sources, { prelude }).diagnostics).toEqual([]);
    sources[0] = { ...sources[0]!, source: schema.removed };
    const actual = elaborateSources(sources, { prelude });
    expect(actual).toEqual(elaborateSources(sources, { prelude: bootstrapOntologyPreludes() }));
    expect(actual.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: schema.expectedMissingCode, message: expect.stringContaining(schema.expectedMissingReference) })]));
    sources[0] = { ...sources[0]!, source: schema.before };
    expect(elaborateSources(sources, { prelude }).diagnostics).toEqual([]);
  });
  it("private schema edits reach the emitted artifact and match a fresh elaboration", () => {
    const schema = scenarios.schema, prelude = bootstrapOntologyPreludes();
    const sourceId = "people.forma";
    const before = schema.privateBefore.replace("(export Person)", "");
    const after = schema.privateAfter.replace("(export Person)", "");
    const initial = elaborateSources([{ sourceId, source: before }], { prelude });
    expect(initial.diagnostics).toEqual([]);
    expect(JSON.stringify(initial.declarations.find(d => d.summary.name === "InternalNote")?.payload)).toContain(schema.expectedPrivateFieldBefore);
    const actual = elaborateSources([{ sourceId, source: after }], { prelude });
    expect(actual.diagnostics).toEqual([]);
    expect(actual).toEqual(elaborateSources([{ sourceId, source: after }], { prelude: bootstrapOntologyPreludes() }));
    const payload = JSON.stringify(actual.declarations.find(d => d.summary.name === "InternalNote")?.payload);
    expect(payload).toContain(schema.expectedPrivateFieldAfter);
    expect(payload).not.toContain(schema.expectedPrivateFieldBefore);
  });

});

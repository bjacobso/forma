import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { preludeSource, ontologyPreludeStack } from "@formalang/ts/preludes";
import { TsLanguageHost } from "../src/ts-host.js";

const scenarios = JSON.parse(readFileSync(new URL("../../../conformance/session-load/scenarios.json", import.meta.url), "utf8"));

describe("session edits match fresh results (OCaml artifact-cache scenarios)", () => {
  it("refreshes dependent values and types across private edits, public edits, removal and replacement", async () => {
    const host = new TsLanguageHost(), { sessionId } = await host.openSession();
    const sources = [...scenarios.moduleEdits.sources];
    expect((await host.loadSourceBundle({ sessionId, sources })).diagnostics).toEqual([]);
    const dependent = sources[1].sourceId;
    expect(await host.evaluateInSession({ sessionId, sourceId: dependent })).toMatchObject({ status: "completed", result: { value: { kind: "int", value: 3 } } });
    for (const edit of scenarios.moduleEdits.edits) {
      sources[0] = { ...sources[0], source: edit.source };
      expect((await host.loadSource({ sessionId, ...sources[0] })).diagnostics).toEqual([]);
      const fresh = new TsLanguageHost(), opened = await fresh.openSession();
      expect((await fresh.loadSourceBundle({ sessionId: opened.sessionId, sources })).diagnostics).toEqual([]);
      const actual = await host.evaluateInSession({ sessionId, sourceId: dependent });
      expect(actual).toEqual(await fresh.evaluateInSession({ sessionId: opened.sessionId, sourceId: dependent }));
      expect(await host.typecheck({ sessionId, sourceId: dependent })).toEqual(await fresh.typecheck({ sessionId: opened.sessionId, sourceId: dependent }));
      if (edit.expectedCode) expect(actual).toMatchObject({ status: "failed", diagnostics: [{ code: edit.expectedCode }] });
      else expect(actual).toMatchObject({ status: "completed", result: { value: { kind: "int", value: edit.expectedValue } } });
      await fresh.closeSession({ sessionId: opened.sessionId });
    }
    await host.closeSession({ sessionId });
  });
  it("refreshes schema interfaces across private and public edits and schema removal", async () => {
    const host = new TsLanguageHost(), { sessionId } = await host.openSession();
    const preludes = ontologyPreludeStack.map(name => ({ sourceId: name, kind: "prelude" as const, source: preludeSource(name) }));
    expect((await host.loadSourceBundle({ sessionId, sources: preludes })).diagnostics).toEqual([]);
    const schema = scenarios.schema;
    const sources = [{ sourceId: "cache/people.forma", source: schema.moduleBefore }, { sourceId: "cache/hiring.forma", source: schema.moduleDependent }];
    expect((await host.loadSourceBundle({ sessionId, sources })).diagnostics).toEqual([]);
    const before = await host.moduleGraph({ sessionId, sourceId: sources[1]!.sourceId });
    expect(before.diagnostics).toEqual([]);
    for (const source of [schema.moduleAfter, schema.moduleAfter.replace("(Option String)", "(Option Bool)"), "", schema.moduleBefore]) {
      sources[0] = { ...sources[0]!, source };
      expect((await host.loadSource({ sessionId, ...sources[0] })).diagnostics).toEqual([]);
      const fresh = new TsLanguageHost(), opened = await fresh.openSession();
      expect((await fresh.loadSourceBundle({ sessionId: opened.sessionId, sources: [...preludes, ...sources] })).diagnostics).toEqual([]);
      const actual = await host.moduleGraph({ sessionId, sourceId: sources[1]!.sourceId });
      expect(actual).toEqual(await fresh.moduleGraph({ sessionId: opened.sessionId, sourceId: sources[1]!.sourceId }));
      if (source === "") expect(actual.diagnostics.length).toBeGreaterThan(0);
      else expect(actual.diagnostics).toEqual([]);
      const people = await host.moduleGraph({ sessionId, sourceId: sources[0]!.sourceId });
      expect(people).toEqual(await fresh.moduleGraph({ sessionId: opened.sessionId, sourceId: sources[0]!.sourceId }));
      await fresh.closeSession({ sessionId: opened.sessionId });
    }
    await host.closeSession({ sessionId });
  }, 20_000);

});

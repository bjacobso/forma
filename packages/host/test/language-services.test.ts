import { describe, expect, it } from "vitest";

import { TsLanguageHost } from "../src/index.js";

describe("structural editor services on the TypeScript host", () => {
  const host = new TsLanguageHost();

  it("advertises the services it implements", async () => {
    const version = await host.version();
    expect(version.capabilities).toEqual(expect.arrayContaining(["identifySyntax"]));
  });

  it("identifies syntax and carries ids across an edit", async () => {
    const source = "(define total 1)\n(+ total 2)";
    const first = await host.identifySyntax({ sourceId: "doc", source });
    expect(first.sourceId).toBe("doc");
    expect(first.diagnostics).toEqual([]);
    expect(first.identity.nodes.map((node) => node.kind)).toEqual([
      "List",
      "Symbol",
      "Symbol",
      "Number",
      "List",
      "Symbol",
      "Symbol",
      "Number",
    ]);
    // The identity is plain JSON and survives a round trip through the wire.
    const wire = JSON.parse(JSON.stringify(first.identity));

    const next = "(define total 10)\n(+ total 2)";
    const second = await host.identifySyntax({
      sourceId: "doc",
      source: next,
      previous: { source, identity: wire },
    });
    expect(second.identity.nodes.map((node) => node.id)).toEqual(
      first.identity.nodes.map((node) => node.id),
    );
  });

  it("reports parse errors as diagnostics without failing", async () => {
    const result = await host.identifySyntax({ sourceId: "broken", source: '(f "abc' });
    expect(result.identity.nodes.length).toBeGreaterThan(0);
    expect(result.diagnostics[0]).toMatchObject({
      phase: "parse",
      severity: "error",
      span: { sourceId: "broken" },
    });
  });
});

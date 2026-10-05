import { describe, expect, it } from "vitest";

import { TsLanguageHost } from "../src/index.js";

describe("structural editor services on the TypeScript host", () => {
  const host = new TsLanguageHost();

  it("advertises the services it implements", async () => {
    const version = await host.version();
    expect(version.capabilities).toEqual(expect.arrayContaining(["identifySyntax", "observe"]));
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

  it("observes one-shot evaluations within limits", async () => {
    const numbers = `[${Array.from({ length: 30 }, (_, index) => index).join(" ")}]`;
    const source = `(define xs ${numbers})\n(map (fn [x] (* x 2)) xs)`;
    const result = await host.evaluate({
      sourceId: "doc",
      source,
      observe: { maxItems: 3, maxStringLength: 10 },
    });
    expect(result.diagnostics).toEqual([]);
    const observations = result.observations!;
    expect(observations.limits).toEqual({
      maxRecords: 5000,
      maxItems: 3,
      maxDepth: 4,
      maxStringLength: 10,
    });
    const body = observations.records.find(
      (record) => source.slice(record.span.startOffset, record.span.endOffset) === "(* x 2)",
    )!;
    expect(body).toMatchObject({ count: 30, value: { kind: "int", value: 58 }, span: { sourceId: "doc" } });
    const xs = observations.records.find(
      (record) => source.slice(record.span.startOffset, record.span.endOffset) === numbers,
    )!;
    expect(xs.value).toEqual({
      kind: "list",
      items: [
        { kind: "int", value: 0 },
        { kind: "int", value: 1 },
        { kind: "int", value: 2 },
        { kind: "opaque", tag: "truncated", display: "… 27 more" },
      ],
    });
    expect(JSON.parse(JSON.stringify(observations))).toEqual(observations);
  });

  it("returns observations with a failed evaluation", async () => {
    const result = await host.evaluate({
      sourceId: "doc",
      source: '(define n 1)\n(+ n "x")',
      observe: {},
    });
    expect(result.diagnostics).toHaveLength(1);
    const failed = result.observations!.records.find((record) => record.failure);
    expect(failed).toMatchObject({ count: 0, failure: { phase: "evaluate" } });
    expect(result.observations!.records.some((record) => record.value?.kind === "int")).toBe(true);
  });

  it("retains observed values in a session", async () => {
    const { sessionId } = await host.openSession();
    const state = await host.evaluateInSession({
      sessionId,
      source: "(define m {:a [1 2]})\n(get m :a)",
      observe: {},
      retainValues: "all",
    });
    expect(state.status).toBe("completed");
    if (state.status !== "completed") return;
    const record = state.result.observations!.records.find(
      (candidate) => candidate.value?.kind === "map",
    )!;
    expect(record.value?.valueRef).toMatch(/^ts-value-/);
    const projected = await host.projectValue({
      sessionId,
      valueRef: record.value!.valueRef!,
      projections: ["plain-json"],
    });
    expect(projected.plainJson).toEqual({ ":a": [1, 2] });
    await host.closeSession({ sessionId });
  });

  it("observes session evaluations that call host builtins", async () => {
    const { sessionId } = await host.openSession();
    await host.configureSession({
      sessionId,
      hostBuiltins: [
        { name: "fetch-score", arity: 1, handler: { kind: "host-effect", effect: "score" } },
      ],
    });
    const first = await host.evaluateInSession({
      sessionId,
      source: "(+ 1 (fetch-score :alice))",
      observe: {},
    });
    expect(first.status).toBe("host-call");
    if (first.status !== "host-call") return;
    const done = await host.resumeHostCall({
      sessionId,
      evaluationId: first.call.evaluationId,
      callId: first.call.callId,
      result: { ok: true, value: { kind: "int", value: 41 } },
    });
    expect(done.status).toBe("completed");
    if (done.status !== "completed") return;
    expect(done.result.value).toEqual({ kind: "int", value: 42 });
    expect(done.result.observations!.records.map((record) => record.value)).toContainEqual({
      kind: "int",
      value: 41,
    });
    await host.closeSession({ sessionId });
  });
});

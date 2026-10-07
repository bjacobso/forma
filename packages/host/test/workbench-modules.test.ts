import { expect, test } from "vitest";
import { TsLanguageHost } from "../src/ts-host.js";

test("editor types imports and retains caller spans and types around a failing form", async () => {
  const host = new TsLanguageHost();
  const { sessionId } = await host.openSession();
  try {
    await host.loadSource({
      sessionId,
      sourceId: "lib/math.forma",
      source: "(export double) (define double [x] (+ x x))",
    });
    const source = '(import "./lib/math.forma" [double]) (double 21) (+ 1 "bad") (double 10)';
    const result = await host.analyzeEditor({ sessionId, sourceId: "main.forma", source });
    expect(result.success).toBe(false);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          span: expect.objectContaining({ sourceId: "main.forma" }),
        }),
      ]),
    );
    const calls = result.typedSpans.filter((typed) =>
      /^\(double \d+\)$/.test(source.slice(typed.span.startOffset, typed.span.endOffset)),
    );
    expect(calls.map((call) => call.display)).toEqual(["Number", "Number"]);
    expect(calls.every((call) => call.span.sourceId === "main.forma")).toBe(true);
  } finally {
    await host.closeSession({ sessionId });
  }
});

test("definition lookup respects exports, namespaces, barrels, and local shadowing", async () => {
  const host = new TsLanguageHost();
  const { sessionId } = await host.openSession();
  try {
    await host.loadSourceBundle({
      sessionId,
      sources: [
        {
          sourceId: "math.forma",
          source: "(export double) (define secret 99) (define double [x] (+ x x))",
        },
        { sourceId: "barrel.forma", source: '(export-from "./math.forma" [double])' },
        { sourceId: "other.forma", source: "(export double) (define double [x] x)" },
      ],
    });
    const source =
      '(import "./barrel.forma" [double]) (import "./other.forma" :as other) (double 1) (other/double 2) (let [double 3] double)';
    const index = await host.symbolIndex({ sessionId, sourceId: "main.forma", source });
    const lookup = async (text: string) =>
      (
        await host.findReferences({
          sessionId,
          sourceId: "main.forma",
          source,
          offset: source.indexOf(text) + 1,
        })
      ).definition;
    expect(await lookup("double 1")).toMatchObject({
      name: "double",
      span: { sourceId: "math.forma" },
    });
    expect(await lookup("other/double")).toMatchObject({
      name: "double",
      span: { sourceId: "other.forma" },
    });
    const local = await host.findReferences({
      sessionId,
      sourceId: "main.forma",
      source,
      offset: source.lastIndexOf("double") + 1,
    });
    expect(local.definition).toMatchObject({ scope: "local", span: { sourceId: "main.forma" } });
    expect(
      index.references.filter(
        (reference) =>
          reference.span.sourceId === "main.forma" && reference.name === "other/double",
      ),
    ).toHaveLength(1);
    const privateSource = '(import "./math.forma" [double]) secret';
    const privateIndex = await host.symbolIndex({
      sessionId,
      sourceId: "main.forma",
      source: privateSource,
    });
    expect(
      privateIndex.references.find(
        (reference) => reference.name === "secret" && reference.span.sourceId === "main.forma",
      ),
    ).toMatchObject({ resolution: "unresolved" });
  } finally {
    await host.closeSession({ sessionId });
  }
});

test("imported VM closures retain private globals through direct, tail, and higher-order calls", async () => {
  const host = new TsLanguageHost();
  const { sessionId } = await host.openSession();
  try {
    await host.loadSourceBundle({
      sessionId,
      sources: [
        {
          sourceId: "tax.forma",
          source: "(export total) (define tax 5) (define total [x] (+ x tax))",
        },
        { sourceId: "barrel.forma", source: '(export-from "./tax.forma" [total])' },
      ],
    });
    for (const source of [
      '(import "./barrel.forma" [total]) (total 10)',
      '(import "./barrel.forma" :as tax) (define amount [x] (tax/total x)) (amount 10)',
      '(import "./barrel.forma" [total]) (first (map total [10 20]))',
    ]) {
      expect(
        await host.evaluateInSession({ sessionId, sourceId: "main.forma", source }),
      ).toMatchObject({ status: "completed", result: { value: { kind: "int", value: 15 } } });
    }
  } finally {
    await host.closeSession({ sessionId });
  }
});

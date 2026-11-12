import { expect, test } from "vitest";
import { TsLanguageHost } from "../src/ts-host.js";

test("editor types imports and retains caller spans and types around a failing form", async () => {
  const host = new TsLanguageHost();
  const { sessionId } = await host.openSession();
  try {
    await host.loadSource({
      sessionId,
      sourceId: "lib/math.lisp",
      source: "(export double) (define double [x] (+ x x))",
    });
    const source = '(import "./lib/math.lisp" [double]) (double 21) (+ 1 "bad") (double 10)';
    const result = await host.analyzeEditor({ sessionId, sourceId: "main.lisp", source });
    expect(result.success).toBe(false);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          span: expect.objectContaining({ sourceId: "main.lisp" }),
        }),
      ]),
    );
    const calls = result.typedSpans.filter((typed) =>
      /^\(double \d+\)$/.test(source.slice(typed.span.startOffset, typed.span.endOffset)),
    );
    expect(calls.map((call) => call.display)).toEqual(["Int", "Int"]);
    expect(calls.every((call) => call.span.sourceId === "main.lisp")).toBe(true);
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
          sourceId: "math.lisp",
          source: "(export double) (define secret 99) (define double [x] (+ x x))",
        },
        { sourceId: "barrel.lisp", source: '(export-from "./math.lisp" [double])' },
        { sourceId: "other.lisp", source: "(export double) (define double [x] x)" },
      ],
    });
    const source =
      '(import "./barrel.lisp" [double]) (import "./other.lisp" :as other) (double 1) (other/double 2) (let [double 3] double)';
    const index = await host.symbolIndex({ sessionId, sourceId: "main.lisp", source });
    const lookup = async (text: string) =>
      (
        await host.findReferences({
          sessionId,
          sourceId: "main.lisp",
          source,
          offset: source.indexOf(text) + 1,
        })
      ).definition;
    expect(await lookup("double 1")).toMatchObject({
      name: "double",
      span: { sourceId: "math.lisp" },
    });
    expect(await lookup("other/double")).toMatchObject({
      name: "double",
      span: { sourceId: "other.lisp" },
    });
    const local = await host.findReferences({
      sessionId,
      sourceId: "main.lisp",
      source,
      offset: source.lastIndexOf("double") + 1,
    });
    expect(local.definition).toMatchObject({ scope: "local", span: { sourceId: "main.lisp" } });
    expect(
      index.references.filter(
        (reference) =>
          reference.span.sourceId === "main.lisp" && reference.name === "other/double",
      ),
    ).toHaveLength(1);
    const privateSource = '(import "./math.lisp" [double]) secret';
    const privateIndex = await host.symbolIndex({
      sessionId,
      sourceId: "main.lisp",
      source: privateSource,
    });
    expect(
      privateIndex.references.find(
        (reference) => reference.name === "secret" && reference.span.sourceId === "main.lisp",
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
          sourceId: "tax.lisp",
          source: "(export total) (define tax 5) (define total [x] (+ x tax))",
        },
        { sourceId: "barrel.lisp", source: '(export-from "./tax.lisp" [total])' },
      ],
    });
    for (const source of [
      '(import "./barrel.lisp" [total]) (total 10)',
      '(import "./barrel.lisp" :as tax) (define amount [x] (tax/total x)) (amount 10)',
      '(import "./barrel.lisp" [total]) (first (map total [10 20]))',
    ]) {
      expect(
        await host.evaluateInSession({ sessionId, sourceId: "main.lisp", source }),
      ).toMatchObject({ status: "completed", result: { value: { kind: "int", value: 15 } } });
    }
  } finally {
    await host.closeSession({ sessionId });
  }
});

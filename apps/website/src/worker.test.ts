import { describe, expect, test, vi } from "vitest";
import { typecheck } from "@formalang/ts/engine";
import { serializablePassResult, timeoutRunResult } from "./engine/protocol";
import { getPipeline, pipelines } from "./pipelines";
import worker from "./worker";

const indexHtml = `<!doctype html>
<html lang="en">
  <head>
    <title>Forma</title>
    <meta name="description" content="Original description" />
    <meta property="og:title" content="Forma" />
    <meta property="og:description" content="Original OG description" />
    <meta property="og:type" content="website" />
    <meta property="og:image" content="/og-image.svg" />
  </head>
  <body><div id="root"></div></body>
</html>`;

describe("forma website worker metadata", () => {
  test("injects pipeline metadata into cold shared demo routes", async () => {
    const env = mockEnv();

    const response = await worker.fetch(new Request("https://forma-lang.com/demo/types"), env);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(html).toContain("<title>Types Without Writing Types - Forma</title>");
    expect(html).toContain(
      '<meta name="description" content="Infer the shape of a function from how its body uses values." />',
    );
    expect(html).toContain(
      '<meta property="og:title" content="Types Without Writing Types - Forma" />',
    );
    expect(html).toContain('<meta property="og:url" content="https://forma-lang.com/demo/types" />');
    expect(env.ASSETS.fetch).toHaveBeenCalledWith(expect.objectContaining({ url: "https://forma-lang.com/index.html" }));
  });

  test("injects route metadata for /about", async () => {
    const response = await worker.fetch(new Request("https://forma-lang.com/about"), mockEnv());
    const html = await response.text();

    expect(html).toContain("<title>About Forma</title>");
    expect(html).toContain(
      '<meta property="og:description" content="Forma is a Lisp-shaped authoring surface for typed ontology, runtime, and deployment artifacts." />',
    );
  });

  test("passes non-document routes through to assets", async () => {
    const env = mockEnv(new Response("asset"));

    const response = await worker.fetch(new Request("https://forma-lang.com/assets/app.js"), env);

    expect(await response.text()).toBe("asset");
    expect(env.ASSETS.fetch).toHaveBeenCalledWith(expect.objectContaining({ url: "https://forma-lang.com/assets/app.js" }));
  });
});

describe("compiler worker protocol", () => {
  test("turns watchdog expiry into an evaluate diagnostic result", () => {
    const result = timeoutRunResult(
      {
        id: 7,
        sourceId: "demo",
        source: "(loop)",
        passes: ["parse", "expand", "typecheck", "evaluate"],
      },
      2_000,
    );

    expect(result.stoppedAt).toBe("evaluate");
    expect(result.diagnostics).toMatchObject([
      {
        code: "WorkerTimeout",
        severity: "error",
        phase: "evaluate",
        message: "evaluate timed out after 2 seconds.",
      },
    ]);
    expect(result.passResults).toMatchObject([
      {
        pass: "evaluate",
        sourceId: "demo",
        printed: "Evaluation timed out.",
        durationMs: 2_000,
      },
    ]);
  });

  test("attaches timeout diagnostics to the last requested pass", () => {
    const result = timeoutRunResult(
      {
        id: 8,
        sourceId: "types",
        source: "(fn [x] x)",
        passes: ["parse", "expand", "typecheck"],
      },
      2_000,
    );

    expect(result.stoppedAt).toBe("typecheck");
    expect(result.passResults[0]).toMatchObject({
      pass: "typecheck",
      display: "Timed out",
    });
    expect(result.diagnostics[0]).toMatchObject({
      code: "WorkerTimeout",
      phase: "typecheck",
    });
  });

  test("removes evaluator env before worker postMessage", () => {
    const result = serializablePassResult({
      pass: "evaluate",
      sourceId: "grades",
      diagnostics: [],
      durationMs: 1,
      value: ["A", "B"],
      printed: "[\"A\" \"B\"]",
      env: { builtin: () => "not cloneable" },
    } as never);

    expect("env" in result).toBe(false);
    expect(result).toMatchObject({
      pass: "evaluate",
      value: ["A", "B"],
      printed: "[\"A\" \"B\"]",
    });
    expect(() => structuredClone(result)).not.toThrow();
  });

  test("keeps printed output when evaluate value itself is not cloneable", () => {
    const result = serializablePassResult({
      pass: "evaluate",
      sourceId: "fn",
      diagnostics: [],
      durationMs: 1,
      value: () => "not cloneable",
      printed: "#<function>",
    } as never);

    expect(result).toMatchObject({
      pass: "evaluate",
      value: null,
      printed: "#<function>",
    });
    expect(() => structuredClone(result)).not.toThrow();
  });
});

describe("pipeline registry", () => {
  test("shows the actual thread-last prelude macro in the pipes demo", () => {
    const pipeline = getPipeline("pipes");

    expect(pipeline.context?.code).toContain("(define-macro ->> [x & forms]");
    expect(pipeline.context?.code).toContain("threaded");
  });

  test("generates the Effect Schema target from Forma schema declarations", () => {
    const pipeline = getPipeline("effect-schema");

    expect(pipeline.preview?.output).toContain('import { Schema } from "effect";');
    expect(pipeline.preview?.output).toContain("export const CheckoutLineSchema = Schema.Struct");
    expect(pipeline.preview?.output).toContain("cart-id");
    expect(pipeline.preview?.output).toContain("Schema.Array(CheckoutLineSchema)");
  });

  test("generates the Effect TypeScript target from mechanics service declarations", () => {
    const pipeline = getPipeline("effect-ts");

    expect(pipeline.source).toContain("(define-service CartRepo");
    expect(pipeline.source).toContain("(define-operation checkout [request]");
    expect(pipeline.preview?.output).toContain('import { Context, Effect } from "effect";');
    expect(pipeline.preview?.output).toContain('export type CartId = Brand<"CartId", string>;');
    expect(pipeline.preview?.output).toContain('export type CustomerId = Brand<"CustomerId", string>;');
    expect(pipeline.preview?.output).toContain("export interface CheckoutRequest");
    expect(pipeline.preview?.output).toContain('readonly "cart-id": CartId;');
    expect(pipeline.preview?.output).toContain("readonly coupon?: string;");
    expect(pipeline.preview?.output).toContain("export interface CheckoutRejected");
    expect(pipeline.preview?.output).toContain("export class CartRepo extends Context.Tag");
    expect(pipeline.preview?.output).toContain("const cart = yield* cartRepo.load(request);");
    expect(pipeline.preview?.output).toContain("Effect.gen(function* ()");
  });

  test("typechecks the Effect TypeScript pipeline without diagnostics", () => {
    const pipeline = getPipeline("effect-ts");
    const result = typecheck({
      sourceId: pipeline.id,
      source: pipeline.source,
      result: "per-expression",
    });

    expect(result.diagnostics).toEqual([]);
  });

  test("defers the Alchemy infrastructure preview", () => {
    expect(pipelines.map((pipeline) => pipeline.id)).not.toContain("alchemy");
  });
});

function mockEnv(response = new Response(indexHtml, {
  headers: { "content-type": "text/html" },
})) {
  return {
    ASSETS: {
      fetch: vi.fn(async () => response.clone()),
    },
  };
}

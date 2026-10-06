import { describe, expect, test, vi } from "vitest";
import { resolve } from "node:path";
import ts from "typescript";
import { typecheck } from "@formalang/ts/engine";
import { serializablePassResult, timeoutRunResult } from "./engine/protocol";
import { getPipeline, pipelines } from "./pipelines";
import { aboutDescription } from "./lib/siteCopy";
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
  test.each(["/", "/vision", "/language", "/playground/assets/app.js", "/missing"])("passes %s through to assets", async (path) => {
    const env = mockEnv(new Response("docs or asset"));
    const request = new Request(`https://forma-lang.com${path}`);
    expect(await (await worker.fetch(request, env)).text()).toBe("docs or asset");
    expect(env.ASSETS.fetch).toHaveBeenCalledWith(request);
  });

  test.each(["/playground", "/playground/"])("serves the playground at %s", async (path) => {
    const response = await worker.fetch(new Request(`https://forma-lang.com${path}`), mockEnv());
    expect(await response.text()).toContain("<title>Forma Playground</title>");
  });

  test("redirects old shared demo URLs without losing editor state", async () => {
    const response = await worker.fetch(new Request("https://forma-lang.com/demo/types?source=abc"), mockEnv());
    expect(response.status).toBe(301);
    expect(response.headers.get("location")).toBe("https://forma-lang.com/playground/demo/types?source=abc");
  });

  test("injects pipeline metadata into cold shared demo routes", async () => {
    const env = mockEnv();

    const response = await worker.fetch(new Request("https://forma-lang.com/playground/demo/types"), env);
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
    expect(html).toContain('<meta property="og:url" content="https://forma-lang.com/playground/demo/types" />');
    expect(env.ASSETS.fetch).toHaveBeenCalledWith(expect.objectContaining({ url: "https://forma-lang.com/playground/" }));
  });

  test("injects route metadata for /about", async () => {
    const response = await worker.fetch(new Request("https://forma-lang.com/playground/about"), mockEnv());
    const html = await response.text();

    expect(html).toContain("<title>About Forma</title>");
    expect(html).toContain(
      `<meta property="og:description" content="${aboutDescription}" />`,
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

    expect(pipeline.context?.code).toMatch(/\(macro\s+\(->> x forms \.\.\.\)/);
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

    expect(pipeline.source).toContain("(service CartRepo");
    expect(pipeline.source).toContain("(define checkout [request]");
    expect(pipeline.preview?.output).toContain('import { Context, Effect, Schema } from "effect";');
    expect(pipeline.preview?.output).toContain('export const CartId = Schema.String.pipe(Schema.brand("CartId"));');
    expect(pipeline.preview?.output).toContain("export type CustomerId = typeof CustomerId.Type;");
    expect(pipeline.preview?.output).toContain("export const CheckoutRequest = Schema.Struct({");
    expect(pipeline.preview?.output).toContain('"cart-id": CartId,');
    expect(pipeline.preview?.output).toContain("coupon: Schema.optionalKey(Schema.String),");
    expect(pipeline.preview?.output).toContain("export class CheckoutRejected extends Schema.TaggedError<CheckoutRejected>()");
    expect(pipeline.preview?.output).toContain("export class CartRepo extends Context.Service<");
    expect(pipeline.preview?.output).toContain("const cart = yield* cartRepo.load(request);");
    expect(pipeline.preview?.output).toContain("Effect.gen(function* ()");
  });

  test.each(["effect-schema", "effect-ts"])("emits %s code accepted by Effect 4", (id) => {
    const code = getPipeline(id).preview?.output;
    expect(code).toBeDefined();
    if (!code) return;

    const file = resolve(import.meta.dirname, `generated-${id}.ts`);
    const options: ts.CompilerOptions = {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      skipLibCheck: true,
      noEmit: true,
    };
    const host = ts.createCompilerHost(options);
    const originalGetSourceFile = host.getSourceFile;
    host.getSourceFile = (name, languageVersionOrOptions, onError, shouldCreateNewSourceFile) =>
      name === file
        ? ts.createSourceFile(name, code, ts.ScriptTarget.ESNext)
        : originalGetSourceFile(name, languageVersionOrOptions, onError, shouldCreateNewSourceFile);
    const diagnostics = ts.getPreEmitDiagnostics(ts.createProgram([file], options, host));
    expect(diagnostics.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"))).toEqual([]);
  }, 30_000);

  test("typechecks the Effect TypeScript pipeline without diagnostics", () => {
    const pipeline = getPipeline("effect-ts");
    const result = typecheck({
      sourceId: pipeline.id,
      source: pipeline.source,
      result: "per-expression",
    });

    expect(result.diagnostics).toEqual([]);
  });

  test("orders domain-language examples before the core language", () => {
    expect(pipelines.map((pipeline) => `${pipeline.group}:${pipeline.id}`)).toEqual([
      "domain:entities",
      "domain:contracts",
      "domain:effect-ts",
      "domain:effect-schema",
      "core:full-pipeline",
      "core:types",
      "core:pipes",
      "core:hello",
    ]);
  });

  test("keeps retired grades links on the complete pipeline", () => {
    expect(getPipeline("grades").id).toBe("full-pipeline");
  });

  test("strips inline code from pipeline metadata", async () => {
    const response = await worker.fetch(new Request("https://forma-lang.com/playground/demo/pipes"), mockEnv());
    const html = await response.text();

    expect(html).toContain(
      '<meta name="description" content="-&gt;&gt; is a prelude macro, not syntax, so it expands away before typechecking." />',
    );
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

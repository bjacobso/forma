import { describe, expect, test } from "vitest";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { Effect, Layer, Schema } from "effect";
import { RpcClient, RpcSerialization } from "effect/rpc";
import { FetchHttpClient } from "effect/http";
import ts from "typescript";
import { generateRpcProgram } from "../src/Rpc.js";

const domain = `
(type Amount (Int :min 1 :max 9))
(type Request {:amount Amount})
(error Rejected {:amount Amount})`;
const groups = `
(rpc-group Arithmetic
  (rpc "Double" :payload Request :success Int :error Rejected)
  (rpc "Label" :payload {:name String} :success String))
(rpc-group Health (rpc "Ping" :payload Unit :success String))`;

describe("RPC prelude", () => {
  test("emits checked native groups, schemas and handler types with no runtime interpreter", async () => {
    const generated = generateRpcProgram(domain + groups);
    expect(generated.diagnostics).toEqual([]);
    const consumer = `
const handlers = Arithmetic.toLayer({
  Double: request => request.amount === 9 ? Effect.fail(new Rejected({ amount: 9 })) : Effect.succeed(request.amount * 2),
  Label: request => Effect.succeed(request.name),
});
// @ts-expect-error Payload types are inferred by the native Effect contract.
Arithmetic.toLayer({ Double: (request: {amount: string}) => Effect.succeed(request.amount), Label: request => Effect.succeed(request.name) });
export const web = HttpRouter.toWebHandler(RpcServer.layerHttp({ group: Arithmetic, path: "/rpc", protocol: "http" }).pipe(
  Layer.provide(handlers), Layer.provide(RpcSerialization.layerNdjson), Layer.provide(HttpServer.layerServices)
), { disableLogger: true });
export const program = Effect.gen(function* () {
  const client = yield* RpcClient.make(Arithmetic);
  const doubled = yield* client.Double({ amount: 3 });
  const label = yield* client.Label({ name: "Ada" });
  const rejected = yield* client.Double({ amount: 9 }).pipe(Effect.catchTag("Rejected", error => Effect.succeed(error.amount)));
  return { doubled, label, rejected };
});`;
    const code = `${generated.code}\nimport { Effect, Layer } from "effect";\nimport { RpcServer, RpcClient, RpcSerialization } from "effect/rpc";\nimport { HttpRouter, HttpServer } from "effect/http";\n${consumer}`;
    const file = resolve("test/__rpc_consumer__.ts");
    const options: ts.CompilerOptions = { strict: true, noEmit: true, skipLibCheck: true, target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext };
    const host = ts.createCompilerHost(options);
    const original = host.getSourceFile.bind(host);
    host.getSourceFile = (path, version, onError, create) => path === file ? ts.createSourceFile(path, code, version, true) : original(path, version, onError, create);
    const checked = ts.createProgram([file], options, host);
    expect(ts.getPreEmitDiagnostics(checked).map(d => ts.flattenDiagnosticMessageText(d.messageText, "\n"))).toEqual([]);
    const exports: Record<string, unknown> = {};
    new Function("require", "exports", ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(createRequire(import.meta.url), exports);
    const web = exports["web"] as { handler: (request: Request) => Promise<Response>; dispose: () => Promise<void> };
    try {
      const protocol = RpcClient.layerProtocolHttp({ url: "http://rpc/rpc" }).pipe(
        Layer.provide(RpcSerialization.layerNdjson), Layer.provide(FetchHttpClient.layer),
      );
      const program = exports["program"] as Effect.Effect<unknown, unknown, RpcClient.Protocol>;
      expect(await Effect.runPromise(Effect.scoped(program).pipe(
        Effect.provide(protocol),
        Effect.provideService(FetchHttpClient.Fetch, (input, init) => web.handler(new Request(input, init))),
      ))).toEqual({ doubled: 6, label: "Ada", rejected: 9 });
    } finally { await web.dispose(); }
  }, 20_000);


  test.each([
    ['(rpc-group X (rpc "Same" :payload Int :success Int) (rpc "Same" :payload String :success String))', "rpc/duplicate-operation"],
    ['(rpc-group X (rpc "Bad" :payload Int))', "success"],
    ['(rpc-group X (rpc "Bad" :payload {:nested (List Missing)} :success String))', "Unknown type Missing"],
    ['(rpc-group X (rpc "Bad" :payload Int :success String :error Missing))', "Unknown type Missing"],
    ['(rpc-group X (rpc "Bad" :payload (String :min 1) :success String))', "Unknown type metadata"],
    ['(rpc-group X)\n(rpc-group X)', "duplicate"],
    ['(type X String)\n(rpc-group X)', "rpc/name-collision"],
    ['(type Rpc String)\n(rpc-group X)', "rpc/name-collision"],
    ['(rpc "Bad" :payload Int :success Int)', "rpc/top-level"],
    ['(rpc-group X (rpc "Bad" :payload Int :success Int)', "rpc/parse"],
  ])("rejects invalid contracts: %s", (source, error) => {
    const generated = generateRpcProgram(source, { sourceId: "invalid.lisp" });
    expect(generated.ok).toBe(false);
    expect(generated.code).toBeUndefined();
    expect(JSON.stringify(generated.diagnostics)).toContain(error);
  });

  test("uses the same refinement schema for untrusted payload decoding", () => {
    const generated = generateRpcProgram(domain + groups);
    const exports: Record<string, unknown> = {};
    new Function("require", "exports", ts.transpileModule(generated.code!, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(createRequire(import.meta.url), exports);
    const amount = exports["Amount"] as Schema.Codec<number>;
    expect(Schema.decodeUnknownSync(amount)(1)).toBe(1);
    expect(Schema.decodeUnknownSync(amount)(9)).toBe(9);
    expect(() => Schema.decodeUnknownSync(amount)(0)).toThrow();
    expect(() => Schema.decodeUnknownSync(amount)(10)).toThrow();
  });
});

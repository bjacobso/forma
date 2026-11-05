// Cross-host conformance for the http-api program (RFC 0023).
//
// 1. Differential: every request in wire-cases.json goes to the TypeScript
//    server generated from program.lisp (the effect-typescript golden) and
//    to the Go server generated from the same program; statuses and bodies
//    must agree with each other and with the case.
// 2. Client: Effect's HttpApiClient, derived from the generated TypeScript
//    API, calls the Go server, including a typed failure.
//
//   node_modules/.bin/tsx prototypes/effect-go/conformance/http-api/cross-host.ts
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { Effect, Layer } from "effect";
import { FetchHttpClient, HttpRouter, HttpServer } from "effect/http";
import { HttpApiBuilder, HttpApiClient } from "effect/http-api";
import {
  Shop,
  ShopSystemLive,
  ShopUsersLive,
  UserId,
  UserNotFound,
  UserRepo,
} from "../../../../conformance/effect-typescript/cases/http-api/expected.js";

interface WireCase {
  readonly name: string;
  readonly method: string;
  readonly path: string;
  readonly body?: string;
  readonly status: number;
  readonly json: unknown;
}

const moduleRoot = new URL("../../", import.meta.url);
const { cases } = JSON.parse(readFileSync(new URL("wire-cases.json", import.meta.url), "utf8")) as { readonly cases: readonly WireCase[] };

const repository = Layer.succeed(UserRepo, {
  find: (id) => (id === "missing" ? Effect.fail(new UserNotFound({ id })) : Effect.succeed({ id, name: "Ada" })),
});
const typescript = HttpRouter.toWebHandler(
  HttpApiBuilder.layer(Shop).pipe(
    Layer.provide([ShopUsersLive, ShopSystemLive]),
    HttpRouter.provideRequest(repository),
    Layer.provide(HttpServer.layerServices),
  ),
  { disableLogger: true },
);

// Build, then run the binary: killing `go run` would leave the server running.
// GOFLAGS (for example -overlay=…) applies, so the demo can test fresh output.
const binary = join(mkdtempSync(join(tmpdir(), "shop-server-")), "shop-server");
execFileSync("go", ["build", "-o", binary, "./cmd/shop-server"], { cwd: moduleRoot, stdio: "inherit" });
const go = spawn(binary, [], { stdio: ["ignore", "pipe", "inherit"] });
const baseUrl = await new Promise<string>((resolve, reject) => {
  go.once("exit", (code) => reject(new Error(`shop-server exited with ${code}`)));
  createInterface({ input: go.stdout! }).once("line", resolve);
});

interface Observed {
  readonly status: number;
  readonly body: unknown;
}

const observe = async (response: Response): Promise<Observed> => {
  const text = await response.text();
  return { status: response.status, body: text === "" ? null : JSON.parse(text) };
};

const request = (c: WireCase, origin: string): Request =>
  new Request(`${origin}${c.path}`, {
    method: c.method,
    ...(c.body === undefined ? {} : { body: c.body, headers: { "content-type": "application/json" } }),
  });

try {
  console.log(`Go server at ${baseUrl}\n`);
  console.log("Differential: TypeScript server vs Go server");
  for (const c of cases) {
    const ts = await observe(await typescript.handler(request(c, "http://localhost")));
    const goResponse = await observe(await fetch(request(c, baseUrl)));
    assert.deepEqual(goResponse, ts, `${c.name}: hosts differ`);
    assert.deepEqual(ts, { status: c.status, body: c.json }, `${c.name}: unexpected response`);
    console.log(`  ✓ ${c.name} (${c.status})`);
  }

  console.log("\nEffect HttpApiClient (TypeScript) → Go server");
  const program = Effect.gen(function* () {
    const client = yield* HttpApiClient.make(Shop, { baseUrl });
    const ada = yield* client.users["get-user"]({ params: { id: UserId.make("ada") } });
    assert.deepEqual(ada, { id: "ada", name: "Ada" });
    console.log("  ✓ get-user decodes a User");
    const missing = yield* Effect.flip(client.users["get-user"]({ params: { id: UserId.make("missing") } }));
    assert.ok(missing instanceof UserNotFound, `expected UserNotFound, got ${String(missing)}`);
    assert.equal(missing.id, "missing");
    console.log("  ✓ get-user fails with a decoded UserNotFound");
    const created = yield* client.users["create-user"]({ payload: { id: UserId.make("new"), name: "New User" } });
    assert.deepEqual(created, { id: "new", name: "New User" });
    console.log("  ✓ create-user round-trips a payload");
    assert.equal(yield* client.system.health(), "ok");
    console.log("  ✓ health decodes a string");
  });
  await Effect.runPromise(program.pipe(Effect.provide(FetchHttpClient.layer)));
  console.log(`\n${cases.length} wire cases agree on both hosts; the TypeScript client works against the Go server.`);
} finally {
  go.kill();
  await typescript.dispose();
}

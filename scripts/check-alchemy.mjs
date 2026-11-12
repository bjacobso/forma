import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { Effect, Redacted } from "effect";
import { makeOAuthClient } from "alchemy/Auth/OAuthFlow";
import { AlchemyContext } from "alchemy/AlchemyContext";
import * as Contributions from "alchemy/Contributions";
import { evalStack } from "alchemy/Stack";
import { PlatformServices } from "alchemy/Util/PlatformServices";

const spec = {
  clientId: "forma-compatibility-check",
  endpoints: {
    authorize: "https://provider.invalid/authorize",
    token: "https://provider.invalid/token",
  },
  redirectUri: "https://app.invalid/callback",
  localCallbackUri: "http://127.0.0.1/callback",
};
const run = effect => Effect.runPromise(effect.pipe(Effect.provide(PlatformServices), Effect.scoped));

// These checks import and construct effects only; they never run a deployment,
// authenticate, or exchange tokens. Authorization URL generation is offline.
test("the deploy command, Cloudflare provider, and Forma stack imports resolve", async () => {
  await import("alchemy/Cli/commands/deploy");
  await import("alchemy/Cli/commands/state");
  await import("@alchemy.run/cloudflare");
  const stack = await import("../alchemy.run.ts");
  assert(Effect.isEffect(stack.default));
});

test("production and PR stages preserve routes and isolate Workers and domains offline", async t => {
  const fetch = t.mock.method(globalThis, "fetch", () => { throw new Error("Unexpected network request"); });
  const { default: definition } = await import("../alchemy.run.ts");
  for (const stage of ["prod", "pr-123", "pr-456"]) {
    await Effect.runPromise(evalStack(definition, stack => Effect.sync(() => {
      assert.equal(stack.name, "forma-lang");
      assert.equal(stack.stage, stage);
      const worker = stack.resources.Website;
      assert.equal(worker.Type, "Cloudflare.Worker");
      assert.equal(worker.Props.name, stage === "prod" ? "forma-website" : `forma-website-${stage}`);
      assert.equal(worker.Props.domain, stage === "prod" ? "forma-lang.com" : undefined);
      assert.equal(worker.Props.workersDev, true);
      assert.equal(worker.Props.main, "apps/website/src/worker.ts");
      assert.equal(worker.Props.assets.notFoundHandling, "404-page");
      assert.deepEqual(worker.Props.assets.runWorkerFirst, ["/feed.xml", "/sitemap.xml", "/robots.txt", "/playground", "/playground/*", "/about", "/demo", "/demo/*", "/workbench/demo", "/workbench/demo/"]);
      assert.equal(worker.RemovalPolicy, "destroy");
      const playgrounds = stack.resources.Playgrounds;
      assert.equal(playgrounds.Type, "Cloudflare.R2.Bucket");
      assert.equal(playgrounds.Props.name, stage === "prod" ? "forma-playgrounds" : `forma-playgrounds-${stage}`);
      assert.equal(playgrounds.Props.forceDestroy, stage !== "prod");
      assert.equal(playgrounds.RemovalPolicy, stage === "prod" ? "retain" : "destroy");
      assert.equal(worker.Props.env.PLAYGROUNDS, playgrounds);
      assert.equal(worker.Props.env.PLAYGROUND_WRITES.simple.limit, 10);
    }), { stage }).pipe(
      Effect.provideService(AlchemyContext, { dotAlchemy: ".alchemy", dev: false, adopt: false }),
      Effect.provide(PlatformServices),
    ));
  }
  assert.equal(fetch.mock.callCount(), 0);
});

test("Cloudflare state-store and auth contributions load without remote state access", async t => {
  const fetch = t.mock.method(globalThis, "fetch", () => { throw new Error("Unexpected network request"); });
  await run(Effect.gen(function* () {
    const stores = yield* Contributions.stateStores();
    const { provider, store } = stores.get("cloudflare");
    assert.equal(provider.name, "cloudflare");
    const implementation = yield* store.load;
    assert.equal(typeof implementation.layer, "function");
    assert.equal(typeof implementation.lifecycle.bootstrap, "function");
    assert.equal(typeof implementation.lifecycle.teardown, "function");
    yield* provider.auth;
  }));
  assert.equal(fetch.mock.callCount(), 0);
});

test("OAuth produces fresh state and a valid S256 PKCE challenge without network access", async t => {
  const fetch = t.mock.method(globalThis, "fetch", () => { throw new Error("Unexpected network request"); });
  const client = makeOAuthClient({ ...spec, auth: { kind: "pkce" } });
  const [first, second] = await run(Effect.all([client.authorize(["read", "write"]), client.authorize()]));
  for (const authorization of [first, second]) {
    const url = new URL(authorization.url);
    assert.match(authorization.state, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(Buffer.from(authorization.state, "base64url").length, 32);
    assert.match(authorization.verifier, /^[A-Za-z0-9_-]{128}$/);
    assert.equal(url.searchParams.get("state"), authorization.state);
    assert.equal(url.searchParams.get("client_id"), spec.clientId);
    assert.equal(url.searchParams.get("redirect_uri"), spec.redirectUri);
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    assert.equal(url.searchParams.get("code_challenge"), createHash("sha256").update(authorization.verifier).digest("base64url"));
  }
  assert.equal(new URL(first.url).searchParams.get("scope"), "read write");
  assert.notEqual(first.state, second.state);
  assert.notEqual(first.verifier, second.verifier);
  assert.equal(fetch.mock.callCount(), 0);
});

test("client-secret authorization generates state without PKCE or exposing its secret", async () => {
  const client = makeOAuthClient({ ...spec, auth: { kind: "clientSecret", clientSecret: Redacted.make("test-only") } });
  const authorization = await run(client.authorize());
  const url = new URL(authorization.url);
  assert.match(authorization.state, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(authorization.verifier, undefined);
  assert.equal(url.searchParams.has("code_challenge"), false);
  assert.equal(url.searchParams.has("client_secret"), false);
});

test("random generation failures remain typed OAuth crypto failures", async t => {
  t.mock.method(globalThis.crypto, "getRandomValues", () => { throw new Error("random unavailable"); });
  const client = makeOAuthClient({ ...spec, auth: { kind: "pkce" } });
  const error = await run(Effect.flip(client.authorize()));
  assert.equal(error._tag, "OAuthCryptoError");
  assert.match(error.message, /Secure random generation failed/);
});

test("PKCE digest failures remain typed OAuth crypto failures", async t => {
  t.mock.method(globalThis.crypto.subtle, "digest", async () => { throw new Error("digest unavailable"); });
  const client = makeOAuthClient({ ...spec, auth: { kind: "pkce" } });
  const error = await run(Effect.flip(client.authorize()));
  assert.equal(error._tag, "OAuthCryptoError");
  assert.match(error.message, /PKCE digest failed/);
});

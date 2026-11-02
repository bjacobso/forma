import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { Effect, Redacted } from "effect";
import { makeOAuthClient } from "alchemy/Auth/OAuthFlow";
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
  await import("alchemy/Cloudflare");
  const stack = await import("../alchemy.run.ts");
  assert(Effect.isEffect(stack.default));
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

test("random generation failures remain OAuth crypto_error failures", async t => {
  t.mock.method(globalThis.crypto, "getRandomValues", () => { throw new Error("random unavailable"); });
  const client = makeOAuthClient({ ...spec, auth: { kind: "pkce" } });
  const error = await run(Effect.flip(client.authorize()));
  assert.equal(error._tag, "OAuthError");
  assert.equal(error.error, "crypto_error");
  assert.match(error.errorDescription, /Secure random generation failed/);
});

test("PKCE digest failures remain OAuth crypto_error failures", async t => {
  t.mock.method(globalThis.crypto.subtle, "digest", async () => { throw new Error("digest unavailable"); });
  const client = makeOAuthClient({ ...spec, auth: { kind: "pkce" } });
  const error = await run(Effect.flip(client.authorize()));
  assert.equal(error._tag, "OAuthError");
  assert.equal(error.error, "crypto_error");
  assert.match(error.errorDescription, /PKCE digest failed/);
});

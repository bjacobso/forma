import assert from "node:assert/strict";
import { Config, ConfigProvider, Effect } from "effect";
import { baseUrl, Misconfigured, settings, validatedSettings } from "./expected.js";

const withConfig = <A, E>(effect: Effect.Effect<A, E>, values: Readonly<Record<string, string>>) =>
  Effect.runPromise(Effect.provide(effect, ConfigProvider.layer(ConfigProvider.fromUnknown(values))));

export default async function check(): Promise<void> {
  assert.deepEqual(await withConfig(settings, { HOST: "example.com" }), {
    host: "example.com",
    port: 8080,
    debug: false,
    ratio: 0.5,
  });
  assert.deepEqual(
    await withConfig(settings, { HOST: "localhost", PORT: "3000", DEBUG: "true", SAMPLE_RATIO: "0.25" }),
    { host: "localhost", port: 3000, debug: true, ratio: 0.25 },
  );

  const missing = await withConfig(Effect.flip(settings), {});
  assert.ok(missing instanceof Config.ConfigError);
  const malformed = await withConfig(Effect.flip(settings), { HOST: "h", PORT: "eighty" });
  assert.ok(malformed instanceof Config.ConfigError);

  const required = await withConfig(Effect.flip(validatedSettings), {});
  assert.ok(required instanceof Misconfigured);
  assert.equal(required.reason, "HOST is required");
  const range = await withConfig(Effect.flip(validatedSettings), { HOST: "h", PORT: "70000" });
  assert.equal(range.reason, "port 70000 is out of range");

  assert.equal(await withConfig(baseUrl, { HOST: "api.local", DEBUG: "true" }), "http://api.local:8080");
  assert.equal(await withConfig(baseUrl, { HOST: "api.example.com", PORT: "443" }), "https://api.example.com:443");
}

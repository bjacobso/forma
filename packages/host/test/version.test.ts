import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { hostAbiVersion, TsLanguageHost } from "../src/index.js";

test("version reports the engine package version", async () => {
  const pkg = JSON.parse(readFileSync(new URL("../../ts/package.json", import.meta.url), "utf8"));
  const version = await new TsLanguageHost().version();
  expect(version.engineVersion).toBe(pkg.version);
  expect(version.hostAbiVersion).toBe(hostAbiVersion);
});

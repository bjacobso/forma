import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect } from "vitest";
import type { LanguageHost } from "../src/types.js";

export const updateModuleGoldens = process.env["FORMA_UPDATE_GOLDEN"] === "1";

// Capture only native results. Run native first during updates so TypeScript
// checks the newly captured reference in the same test invocation.
export function expectModuleGolden(
  host: LanguageHost,
  directory: string,
  name: string,
  actual: unknown,
) {
  const path = resolve(directory, `${name}.json`);
  if (updateModuleGoldens && host.name === "ocaml-native") {
    const sort = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(sort);
      if (value !== null && typeof value === "object")
        return Object.fromEntries(
          Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
            .map(([key, nested]) => [key, sort(nested)]),
        );
      return value;
    };
    writeFileSync(path, `${JSON.stringify(sort(actual), null, 2)}\n`);
  }
  expect(actual, `${host.name}: ${name} native golden`).toEqual(
    JSON.parse(readFileSync(path, "utf8")),
  );
}

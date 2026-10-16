import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect } from "vitest";
import type { LanguageHost } from "../src/types.js";

export const updateModuleGoldens = process.env["FORMA_UPDATE_GOLDEN"] === "1";

// FORMA_UPDATE_GOLDEN=1 rewrites the stored reference from the current result.
// Review the diff before committing it.
export function expectModuleGolden(
  host: LanguageHost,
  directory: string,
  name: string,
  actual: unknown,
) {
  const path = resolve(directory, `${name}.json`);
  if (updateModuleGoldens) {
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
  expect(actual, `${host.name}: ${name} golden`).toEqual(
    JSON.parse(readFileSync(path, "utf8")),
  );
}

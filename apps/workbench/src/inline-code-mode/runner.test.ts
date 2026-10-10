import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { evidence } from "./runner";

test("the browser catalog and Effect companion match the CLI contracts", () => {
  for (const name of ["catalog.forma", "summary-effect.forma"]) {
    const browser = readFileSync(new URL(`./${name}`, import.meta.url), "utf8");
    const cli = readFileSync(new URL(`../../../../packages/host/examples/inline-code-mode/${name}`, import.meta.url), "utf8");
    expect(browser).toBe(cli);
  }
  expect(evidence.requirements).toEqual(["Issues.list-open", "Accounts.list-active"]);
  expect(evidence.errors).toEqual(["Unavailable"]);
});

import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

test("serves generated llms.txt as text through the production assets configuration", async ({ request }) => {
  const source = await readFile(new URL("../../../docs/agents.md", import.meta.url), "utf8");
  const response = await request.get("/llms.txt");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toMatch(/^text\/(?:plain|markdown)(?:;|$)/);
  expect(await response.text()).toBe(source);

  // A missing text asset must not succeed via the playground's HTML fallback.
  const missing = await request.get("/missing-llms.txt");
  expect(missing.status()).toBe(404);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { parsePreviewOutput } from "./preview-output.mjs";

test("reads plain and progress-prefixed Alchemy stack outputs", () => {
  const url = "https://forma-website-pr-128.example.workers.dev/";
  for (const prefix of ["", "• Refreshing Cloudflare State Store credentials\n✓ Refreshing Cloudflare State Store credentials\n"]) {
    assert.deepEqual(parsePreviewOutput(prefix + JSON.stringify({ url, nested: { example: true } }, null, 2) + "\n"), { url });
  }
});

test("rejects missing, malformed, or non-preview output", () => {
  for (const value of ["progress only", "{}", '{"url":"https://forma-lang.com"}', '{"url":"http://preview.workers.dev"}', '{"url":"https://preview.workers.dev.evil.invalid"}', '{"url":"https://user:password@preview.workers.dev"}']) {
    assert.throws(() => parsePreviewOutput(value));
  }
});

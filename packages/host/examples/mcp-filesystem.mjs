import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { discoverMcpService, runMcpProgram } from "../dist/mcp-prototype.mjs";

const require = createRequire(import.meta.url);
const directory = await mkdtemp(join(tmpdir(), "forma-mcp-"));
const client = new Client({ name: "forma-mcp-prototype", version: "0.1.0" });
try {
  await writeFile(join(directory, "first.txt"), "first issue\n");
  await writeFile(join(directory, "second.txt"), "second issue\n");
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [require.resolve("@modelcontextprotocol/server-filesystem/dist/index.js"), directory],
    stderr: "pipe",
  }));
  const binding = await discoverMcpService(client, { service: "Filesystem", tools: ["read_text_file"] });
  const source = `
(: read-two (Effect (List Filesystem_read_text_file_Output)
  [Filesystem_read_text_file_Failed] [Filesystem.read_text_file]))
(define read-two
  (do! [first (Filesystem.read_text_file {:path ${JSON.stringify(join(directory, "first.txt"))}})
        second (Filesystem.read_text_file {:path ${JSON.stringify(join(directory, "second.txt"))}})]
    (succeed [first second])))
`;
  const result = await runMcpProgram(client, binding, {
    source, entry: "read-two", grants: ["Filesystem.read_text_file"], maxCalls: 2,
  });
  assert.equal(result.status, "completed");
  assert.deepEqual(result.value, [{ content: "first issue\n" }, { content: "second issue\n" }]);
  const rejected = await runMcpProgram(client, binding, {
    source: source.replace("[Filesystem.read_text_file]", "[]"),
    entry: "read-two", grants: ["Filesystem.read_text_file"],
  });
  assert.equal(rejected.status, "failed");
  assert.equal(rejected.calls.length, 0);
  assert(rejected.diagnostics.some((item) => item.code === "mechanics/undeclared-requirement"));
  console.log(JSON.stringify({ prelude: binding.prelude, source, result, rejected }, null, 2));
} finally {
  await client.close();
  await rm(directory, { recursive: true, force: true });
}

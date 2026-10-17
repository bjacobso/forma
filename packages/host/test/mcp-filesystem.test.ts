import { expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { discoverMcpService, runMcpProgram } from "../src/mcp-prototype.js";

it("runs a checked program against the official filesystem MCP server over stdio", async () => {
  const directory = await mkdtemp(join(tmpdir(), "forma-mcp-test-"));
  const client = new Client({ name: "forma-mcp-test", version: "0.1.0" });
  try {
    const path = join(directory, "issue.txt");
    await writeFile(path, "an issue to triage\n");
    await client.connect(new StdioClientTransport({
      command: process.execPath,
      args: [createRequire(import.meta.url).resolve("@modelcontextprotocol/server-filesystem/dist/index.js"), directory],
      stderr: "pipe",
    }));
    const binding = await discoverMcpService(client, { service: "Filesystem", tools: ["read_text_file", "list_directory"] });
    const source = `(: main (Effect Filesystem_read_text_file_Output
        [Filesystem_read_text_file_Failed] [Filesystem.read_text_file]))
      (define main (Filesystem.read_text_file {:path ${JSON.stringify(path)}}))`;
    const request = { source, entry: "main", grants: ["Filesystem.read_text_file"] };
    expect(await runMcpProgram(client, binding, request)).toMatchObject({
      status: "completed", value: { content: "an issue to triage\n" },
      calls: [{ capability: "Filesystem.read_text_file", outcome: { ok: true } }],
    });
    expect(await runMcpProgram(client, binding, { ...request, source: source.replace("[Filesystem.read_text_file]", "[]") })).toMatchObject({
      status: "failed", calls: [], diagnostics: expect.arrayContaining([expect.objectContaining({ code: "mechanics/undeclared-requirement" })]),
    });
    expect(await runMcpProgram(client, binding, { ...request, source: source.replace(path, join(directory, "missing.txt")) })).toMatchObject({
      status: "error", error: { _tag: "Filesystem_read_text_file_Failed" }, calls: [{ outcome: { ok: false } }],
    });
  } finally {
    await client.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 15_000);

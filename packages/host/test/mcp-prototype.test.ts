import { describe, expect, it, vi } from "vitest";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { compileMcpService, discoverMcpService, mcpSchemaType, runMcpProgram } from "../src/mcp-prototype.js";

const tool: Tool = {
  name: "echo", inputSchema: { type: "object", properties: { message: { type: "string", minLength: 1 } }, required: ["message"], additionalProperties: false },
  outputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
};
const binding = compileMcpService([tool], { service: "Demo", tools: ["echo"] });
const source = `(: main (Effect Demo_echo_Output [Demo_echo_Failed] [Demo.echo]))
(define main (Demo.echo {:message "hello"}))`;

function mockClient(result: unknown = { content: [], structuredContent: { text: "hello" } }) {
  const callTool = vi.fn(async () => result);
  return { callTool, client: { callTool } as unknown as Pick<Client, "callTool"> };
}

describe("MCP schema projection", () => {
  it("projects primitives, optional record fields, arrays and enums without erasing types", () => {
    expect(mcpSchemaType({ type: "object", properties: {
      required: { type: "integer" }, optional: { type: "number" },
      flags: { type: "array", items: { type: "boolean" } },
      mode: { enum: ["open", "closed"] },
    }, required: ["required", "flags", "mode"] })).toBe('{:required Int :optional (Option Float) :flags (List Bool) :mode (Union "open" "closed")}');
    expect(binding.prelude).toContain("(error Demo_echo_Failed {:message String})");
    expect(binding.prelude).toContain("(Effect Demo_echo_Output [Demo_echo_Failed] [])");
  });

  it("fails visibly on unsupported schemas, unsafe identifiers and ambiguous selection", () => {
    expect(() => mcpSchemaType({ $ref: "#/$defs/Unknown" })).toThrow("Unsupported MCP schema keyword");
    expect(() => mcpSchemaType({ type: "array" })).toThrow("Expected an MCP JSON Schema object");
    expect(() => compileMcpService([{ ...tool, name: "bad) (service Inject" }], { service: "Demo", tools: ["bad) (service Inject"] })).toThrow("identifier");
    expect(() => compileMcpService([tool, tool], { service: "Demo", tools: ["echo"] })).toThrow("exactly one");
    expect(() => compileMcpService([tool], { service: "Demo", tools: ["missing"] })).toThrow("exactly one");
    const fallback = compileMcpService([{ name: "echo", inputSchema: tool.inputSchema }], { service: "Demo", tools: ["echo"] });
    expect(fallback.tools[0]?.outputType).toBe("Json");
  });

  it("collects every discovery page and rejects cursor loops", async () => {
    const listTools = vi.fn().mockResolvedValueOnce({ tools: [], nextCursor: "page-2" }).mockResolvedValueOnce({ tools: [tool] });
    expect(await discoverMcpService({ listTools } as unknown as Client, { service: "Demo", tools: ["echo"] })).toEqual(binding);
    expect(listTools.mock.calls).toEqual([[{}], [{ cursor: "page-2" }]]);
    listTools.mockResolvedValue({ tools: [], nextCursor: "loop" });
    await expect(discoverMcpService({ listTools } as unknown as Client, { service: "Demo", tools: [] })).rejects.toThrow("repeated a cursor");
  });
});

describe("checked MCP execution", () => {
  it("executes through MCP and returns a JSON call record", async () => {
    const { client, callTool } = mockClient();
    expect(await runMcpProgram(client, binding, { source, entry: "main", grants: ["Demo.echo"] })).toEqual({
      status: "completed", value: { text: "hello" }, requirements: ["Demo.echo"],
      calls: [{ capability: "Demo.echo", arguments: { message: "hello" }, outcome: { ok: true, value: { text: "hello" } } }],
    });
    expect(callTool).toHaveBeenCalledExactlyOnceWith({ name: "echo", arguments: { message: "hello" } });
  });

  it.each([
    [source.replace("[Demo.echo]", "[]"), "mechanics/undeclared-requirement"],
    [source.replace("[Demo_echo_Failed]", "[]"), "mechanics/undeclared-error"],
    [source.replace('"hello"', "42"), "mechanics/type-mismatch"],
    [source.replace("(Demo.echo {:message", "(Demo.delete {:message"), undefined],
    ["(service Demo (: echo (-> Json (Effect Json))))\n" + source, undefined],
  ])("rejects invalid source before I/O (%s)", async (invalid, code) => {
    const { client, callTool } = mockClient();
    const result = await runMcpProgram(client, binding, { source: invalid, sourceId: "submitted.forma", entry: "main", grants: ["Demo.echo"] });
    expect(result.status).toBe("failed");
    if (result.status !== "failed") throw Error("Expected diagnostics");
    if (code) expect(result.diagnostics.some((item) => item.code === code)).toBe(true);
    expect(result.calls).toEqual([]);
    expect(callTool).not.toHaveBeenCalled();
    for (const diagnostic of result.diagnostics) {
      if (diagnostic.span) {
        expect(diagnostic.span.sourceId).toBe("submitted.forma");
        expect(diagnostic.span.endOffset).toBeLessThanOrEqual(invalid.length);
      }
    }
  });

  it("requires an independent host grant and bounds external calls", async () => {
    const { client, callTool } = mockClient();
    expect(await runMcpProgram(client, binding, { source, entry: "main", grants: [] })).toMatchObject({ status: "failed", diagnostics: [{ code: "mcp/ungranted-capability" }], calls: [] });
    expect(await runMcpProgram(client, binding, { source, entry: "main", grants: ["Demo.echo"], maxCalls: 0 })).toMatchObject({ status: "failed", diagnostics: [{ code: "mcp/call-budget" }], calls: [] });
    expect(callTool).not.toHaveBeenCalled();
  });

  it("rejects unsupported computation before an earlier service call can run", async () => {
    const { client, callTool } = mockClient();
    const unsupported = `(: main (Effect Int [Demo_echo_Failed] [Demo.echo]))
      (define main (do! [_ (Demo.echo {:message "hello"})] (succeed (+ 1 2))))`;
    expect(await runMcpProgram(client, binding, { source: unsupported, entry: "main", grants: ["Demo.echo"] })).toMatchObject({
      status: "failed", calls: [], diagnostics: [{ code: "mcp/unsupported-runtime-node" }],
    });
    expect(callTool).not.toHaveBeenCalled();
  });

  it("validates constraints before sending input to the server", async () => {
    const { client, callTool } = mockClient();
    expect(await runMcpProgram(client, binding, { source: source.replace('"hello"', '""'), entry: "main", grants: ["Demo.echo"] })).toMatchObject({ status: "error", error: { _tag: "Demo_echo_Failed", message: expect.stringContaining("input schema") } });
    expect(callTool).not.toHaveBeenCalled();
  });

  it.each([
    { content: [{ type: "text", text: "offline" }], isError: true },
    { content: [], structuredContent: { text: 42 } },
    { content: [] },
  ])("maps tool errors and invalid output to the declared tag", async (response) => {
    const { client } = mockClient(response);
    expect(await runMcpProgram(client, binding, { source, entry: "main", grants: ["Demo.echo"] })).toMatchObject({ status: "error", error: { _tag: "Demo_echo_Failed" }, calls: [{ outcome: { ok: false } }] });
  });

  it("supports typed recovery from transport errors", async () => {
    const { client, callTool } = mockClient();
    callTool.mockRejectedValue(new Error("connection closed"));
    const recover = `(: main (Effect Demo_echo_Output [] [Demo.echo]))
      (define main (catch (Demo.echo {:message "hello"})
        (Demo_echo_Failed error) (succeed {:text "recovered"})))`;
    expect(await runMcpProgram(client, binding, { source: recover, entry: "main", grants: ["Demo.echo"] })).toMatchObject({ status: "completed", value: { text: "recovered" }, calls: [{ outcome: { ok: false } }] });
  });

  it("rejects output integers outside Forma's safe range", async () => {
    const integers = compileMcpService([{ ...tool, outputSchema: {
      type: "object", properties: { count: { type: "integer" } }, required: ["count"],
    } }], { service: "Demo", tools: ["echo"] });
    const { client } = mockClient({ content: [], structuredContent: { count: Number.MAX_SAFE_INTEGER + 1 } });
    expect(await runMcpProgram(client, integers, { source, entry: "main", grants: ["Demo.echo"] })).toMatchObject({
      status: "error", error: { _tag: "Demo_echo_Failed", message: expect.stringContaining("safe integer range") },
      calls: [{ outcome: { ok: false } }],
    });
  });
});

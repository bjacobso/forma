import { describe, expect, test, vi } from "vitest";
import worker, { ReplSession } from "./worker";

/** Durable Object storage in memory; objects are recreated from it to simulate eviction. */
function storage() {
  const data = new Map<string, unknown>();
  return {
    data,
    async get<T>(key: string) { return structuredClone(data.get(key)) as T | undefined; },
    async put(key: string, value: unknown) { data.set(key, structuredClone(value)); },
    async delete(key: string) { return data.delete(key); },
    async deleteAll() { data.clear(); },
    async list<T>(options: { prefix: string }) { return new Map([...data].filter(([key]) => key.startsWith(options.prefix)).map(([k, v]) => [k, structuredClone(v) as T])); },
    async setAlarm() {},
  };
}

function env() {
  const stores = new Map<string, ReturnType<typeof storage>>();
  const objects = new Map<string, ReplSession>();
  const namespace = {
    idFromName: (name: string) => name,
    get: (id: unknown) => ({
      fetch: (input: string, init?: RequestInit) => {
        const name = String(id);
        if (!stores.has(name)) stores.set(name, storage());
        if (!objects.has(name)) objects.set(name, new ReplSession({ storage: stores.get(name)! }));
        return objects.get(name)!.fetch(new Request(input, init));
      },
    }),
  };
  return { ASSETS: { fetch: vi.fn(async () => new Response("MCP docs page")) }, REPL_SESSIONS: namespace, evict: () => objects.clear() };
}

async function rpc(e: ReturnType<typeof env>, method: string, params: unknown, session?: string) {
  const response = await worker.fetch(new Request("https://forma-lang.com/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18", ...(session ? { "mcp-session-id": session } : {}) },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  }), e);
  return { session: response.headers.get("mcp-session-id")!, body: await response.json() as { result: any } };
}
const repl = async (e: ReturnType<typeof env>, session: string, input: string) =>
  (await rpc(e, "tools/call", { name: "repl", arguments: { input } }, session)).body.result;

describe("forma-lang.com/mcp", () => {
  test("serves the docs page to browsers and refuses a server-to-client stream", async () => {
    const e = env();
    expect(await (await worker.fetch(new Request("https://forma-lang.com/mcp", { headers: { accept: "text/html" } }), e)).text()).toBe("MCP docs page");
    expect((await worker.fetch(new Request("https://forma-lang.com/mcp", { headers: { accept: "text/event-stream" } }), e)).status).toBe(405);
  });

  test("keeps a session's REPL across calls and rebuilds it after eviction", async () => {
    const e = env();
    const { session, body } = await rpc(e, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
    expect(body.result.serverInfo.name).toBe("forma");
    expect(session).toMatch(/^[0-9a-f-]{36}$/u);
    expect((await rpc(e, "tools/list", {}, session)).body.result.tools.map((tool: { name: string }) => tool.name)).toEqual(["repl"]);
    await repl(e, session, ":prelude lang (macro (twice x) `(+ ~x ~x))");
    await repl(e, session, "(define y (twice 5))");
    await repl(e, session, ":effect (error NotFound {:id String})");
    e.evict();
    expect(await repl(e, session, "y")).toMatchObject({ structuredContent: { ok: true, printed: "10" } });
    expect((await repl(e, session, ":program")).structuredContent.source).toBe("(error NotFound {:id String})");
    // Another MCP session sees none of it.
    const other = (await rpc(e, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } })).session;
    expect(await repl(e, other, "y")).toMatchObject({ isError: true });
  });

  test("checks and generates Effect programs but does not run them", async () => {
    const e = env();
    const session = (await rpc(e, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } })).session;
    expect(await repl(e, session, ":run (succeed 1)")).toMatchObject({ isError: true, structuredContent: { diagnostics: [{ code: "repl/run-unavailable" }] } });
    expect((await rpc(e, "tools/call", { name: "repl", arguments: { input: "x".repeat(20_001) } }, session)).body.result).toMatchObject({ isError: true });
  });
});

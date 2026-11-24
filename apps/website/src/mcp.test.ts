import { describe, expect, test, vi } from "vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  McpRateLimit,
  makeMemoryReplSessions,
} from "./mcp";
import { IDLE_MS } from "./mcpSchema";
import {
  PlaygroundService,
  StaticAssets,
  runWebsiteRequest,
} from "./worker";

function makeTestEnv(options?: { readonly allowRateLimit?: (key: string) => boolean }) {
  const sessions = makeMemoryReplSessions();
  const assetsFetch = vi.fn(async (_request: Request) => new Response("MCP docs page"));
  const rateLimitAllow = vi.fn((key: string) => options?.allowRateLimit?.(key) ?? true);

  const layer = Layer.mergeAll(
    Layer.succeed(StaticAssets, { fetch: (req) => Effect.promise(() => assetsFetch(req)) }),
    PlaygroundService.Empty,
    Layer.succeed(McpRateLimit, { allow: (key) => Effect.sync(() => rateLimitAllow(key)) }),
    sessions.layer,
  );

  return {
    layer,
    sessions,
    assetsFetch,
    rateLimitAllow,
    fetch: (request: Request) => runWebsiteRequest(request, layer),
  };
}

async function rpc(
  env: ReturnType<typeof makeTestEnv>,
  method: string,
  params: unknown,
  session?: string,
  extraHeaders?: Record<string, string>,
) {
  const response = await env.fetch(
    new Request("https://forma-lang.com/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2025-06-18",
        ...(session ? { "mcp-session-id": session } : {}),
        ...extraHeaders,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    }),
  );
  return {
    status: response.status,
    headers: response.headers,
    session: response.headers.get("mcp-session-id")!,
    body: (await response.json()) as { result?: any; error?: any },
  };
}

const repl = async (env: ReturnType<typeof makeTestEnv>, session: string, input: string) =>
  (await rpc(env, "tools/call", { name: "repl", arguments: { input } }, session)).body.result;

describe("forma-lang.com/mcp (Effect-native)", () => {
  test("serves the docs page to browsers and refuses a server-to-client stream", async () => {
    const env = makeTestEnv();
    const docs = await env.fetch(
      new Request("https://forma-lang.com/mcp", { headers: { accept: "text/html" } }),
    );
    expect(await docs.text()).toBe("MCP docs page");
    const sse = await env.fetch(
      new Request("https://forma-lang.com/mcp", { headers: { accept: "text/event-stream" } }),
    );
    expect(sse.status).toBe(405);
    expect(sse.headers.get("allow")).toBe("POST, DELETE, OPTIONS");
    const preflight = await env.fetch(
      new Request("https://forma-lang.com/mcp", { method: "OPTIONS" }),
    );
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-expose-headers")).toBe("mcp-session-id");
  });

  test("keeps a session's REPL across calls and rebuilds it after eviction", async () => {
    const env = makeTestEnv();
    const { session, body } = await rpc(env, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "1" },
    });
    expect(body.result.serverInfo.name).toBe("forma");
    expect(body.result.protocolVersion).toBe("2025-06-18");
    expect(session).toMatch(/^[0-9a-f-]{36}$/u);
    expect(
      (await rpc(env, "tools/list", {}, session)).body.result.tools.map(
        (tool: { name: string }) => tool.name,
      ),
    ).toEqual(["repl"]);

    await repl(env, session, ":prelude lang (macro (twice x) `(+ ~x ~x))");
    await repl(env, session, "(define y (twice 5))");
    await repl(env, session, ":effect (error NotFound {:id String})");

    // Verify 24h idle alarm was scheduled.
    const alarmAt = env.sessions.stores.get(session)?.getAlarm();
    expect(alarmAt).toBeDefined();
    expect(alarmAt! - Date.now()).toBeGreaterThan(IDLE_MS - 10_000);

    // Simulate Durable Object eviction: drop live instances, keep persisted snapshots.
    env.sessions.evictAll();
    expect(await repl(env, session, "y")).toMatchObject({
      structuredContent: { ok: true, printed: "10" },
    });
    expect((await repl(env, session, ":program")).structuredContent.source).toBe(
      "(error NotFound {:id String})",
    );

    // Another MCP session sees none of it.
    const other = (
      await rpc(env, "initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "test", version: "1" },
      })
    ).session;
    expect(await repl(env, other, "y")).toMatchObject({ isError: true });
  });

  test("checks and generates Effect programs but does not run them", async () => {
    const env = makeTestEnv();
    const session = (
      await rpc(env, "initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "test", version: "1" },
      })
    ).session;

    const first = await repl(env, session, "(+ 1 2)");
    expect(first.content[0].text).toMatch(
      /^This server cannot run programs: :run is unavailable\. The hosted server/u,
    );
    expect(first.structuredContent).toMatchObject({
      ok: true,
      printed: "3",
      notice: expect.stringContaining("forma mcp"),
    });
    expect((await repl(env, session, "(+ 1 2)")).structuredContent.notice).toBeUndefined();
    expect(
      (await repl(env, session, ":help")).content[0].text.split("\n").slice(0, 4).join("\n"),
    ).toContain("This server cannot run programs");
    expect(await repl(env, session, ':run (find-user "u-1")')).toMatchObject({
      isError: true,
      structuredContent: { diagnostics: [{ code: "repl/run-unavailable" }] },
    });
    expect(
      (
        await rpc(
          env,
          "tools/call",
          { name: "repl", arguments: { input: "x".repeat(20_001) } },
          session,
        )
      ).body.result,
    ).toMatchObject({ isError: true });
  });

  test("enforces rate limiting, session DELETE, idle alarm expiry, and corrupted snapshot recovery", async () => {
    const denied = makeTestEnv({ allowRateLimit: () => false });
    const limited = await rpc(denied, "tools/list", {}, undefined, {
      "cf-connecting-ip": "203.0.113.10",
    });
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe(-32000);
    expect(denied.rateLimitAllow).toHaveBeenCalledWith("203.0.113.10");

    const env = makeTestEnv();
    const session = (
      await rpc(env, "initialize", {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "test", version: "1" },
      })
    ).session;
    await repl(env, session, "(define x 42)");

    // Inject a corrupted snapshot entry alongside valid storage and evict; session still recovers.
    env.sessions.stores.get(session)!.data.set("session:corrupt", { bad: "shape" });
    env.sessions.evictAll();
    expect(await repl(env, session, "x")).toMatchObject({
      structuredContent: { ok: true, printed: "42" },
    });

    // Firing the idle alarm clears storage and resets memory.
    await Effect.runPromise(env.sessions.fireAlarm(session));
    expect(await repl(env, session, "x")).toMatchObject({ isError: true });

    // DELETE clears a recreated session.
    await repl(env, session, "(define z 99)");
    const del = await env.fetch(
      new Request("https://forma-lang.com/mcp", {
        method: "DELETE",
        headers: { "mcp-session-id": session },
      }),
    );
    expect(del.status).toBe(204);
    expect(await repl(env, session, "z")).toMatchObject({ isError: true });
  });

  test("interoperates with the official MCP SDK StreamableHTTPClientTransport", async () => {
    const env = makeTestEnv();
    const transport = new StreamableHTTPClientTransport(new URL("https://forma-lang.com/mcp"), {
      fetch: (input, init) => env.fetch(new Request(input, init)),
    });
    const client = new Client({ name: "sdk-interop-test", version: "1.0.0" });
    await client.connect(transport);

    expect(transport.sessionId).toMatch(/^[0-9a-f-]{36}$/u);
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual(["repl"]);

    await client.callTool({ name: "repl", arguments: { input: "(define answer 42)" } });
    // Evict Durable Object in-memory state mid-session and keep using the same SDK client.
    env.sessions.evictAll();
    const reply = await client.callTool({ name: "repl", arguments: { input: "answer" } });
    expect(reply.structuredContent).toMatchObject({ ok: true, printed: "42" });

    await transport.terminateSession();
    await client.close();
  });
});

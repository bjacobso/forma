/**
 * The hosted MCP server at forma-lang.com/mcp: the `repl` tool of `forma mcp`,
 * over Streamable HTTP. Each MCP session's REPL lives in a Durable Object, which
 * saves what the session accepted and rebuilds it after eviction.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema, type Tool } from "@modelcontextprotocol/sdk/types.js";
import { JsonAbi } from "@formalang/host/json-abi";
import { createRepl, replTool, type ReplReply, type ReplSnapshot } from "@formalang/host/repl";
import { engineVersion } from "@formalang/ts/engine";

const MAX_INPUT = 20_000;
const MAX_SNAPSHOT = 1_000_000;
const IDLE_MS = 24 * 60 * 60 * 1000;
const RUN_UNAVAILABLE = "The hosted server at forma-lang.com/mcp checks, infers, expands and generates Effect programs but does not run them. Run `forma mcp` locally to use :run; see https://forma-lang.com/mcp.";

interface DurableObjectStub { fetch(input: string, init?: RequestInit): Promise<Response> }
interface DurableObjectNamespace { idFromName(name: string): unknown; get(id: unknown): DurableObjectStub }
interface DurableObjectStorage {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<boolean>;
  deleteAll(): Promise<void>;
  list<T>(options: { prefix: string }): Promise<Map<string, T>>;
  setAlarm(time: number): Promise<void>;
}
interface RateLimit { limit(options: { key: string }): Promise<{ success: boolean }> }

export interface McpEnv {
  readonly REPL_SESSIONS?: DurableObjectNamespace;
  readonly MCP_CALLS?: RateLimit;
}

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, DELETE, OPTIONS",
  "access-control-allow-headers": "content-type, accept, mcp-session-id, mcp-protocol-version, authorization",
  "access-control-expose-headers": "mcp-session-id",
};
const withHeaders = (response: Response, extra: Record<string, string>) => {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(extra)) headers.set(name, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
};
const rpcError = (status: number, message: string) =>
  Response.json({ jsonrpc: "2.0", error: { code: -32000, message }, id: null }, { status, headers: corsHeaders });

/** True when a request to /mcp is for the MCP server rather than the docs page. */
export function isMcpRequest(request: Request): boolean {
  if (request.method === "GET" || request.method === "HEAD") return request.headers.get("accept")?.includes("text/event-stream") === true;
  return true;
}

export async function handleMcp(request: Request, env: McpEnv): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  // The server answers each POST with JSON; it does not offer a server-to-client stream.
  if (request.method === "GET" || request.method === "HEAD") return new Response(null, { status: 405, headers: { ...corsHeaders, allow: "POST, DELETE, OPTIONS" } });
  if (env.MCP_CALLS && !(await env.MCP_CALLS.limit({ key: request.headers.get("cf-connecting-ip") ?? "anonymous" })).success)
    return rpcError(429, "Too many requests to forma-lang.com/mcp; wait a minute and try again.");
  // Sessions are named by the server and kept in a Durable Object, so the MCP
  // transport itself is stateless and any Worker instance can answer.
  if (!env.REPL_SESSIONS) return rpcError(503, "MCP sessions are not configured on this deployment.");
  const sessionId = request.headers.get("mcp-session-id") ?? crypto.randomUUID();
  const session = env.REPL_SESSIONS.get(env.REPL_SESSIONS.idFromName(sessionId));
  if (request.method === "DELETE") {
    await session.fetch("https://repl/delete", { method: "POST" });
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (request.method !== "POST") return rpcError(405, "Use POST.");

  const server = new Server({ name: "forma", version: engineVersion }, {
    capabilities: { tools: {} },
    instructions: "Explore the Forma language with the repl tool: send :help first, then :outline and :doc <name>. Sessions keep definitions between calls. This server checks, infers and generates Effect programs but cannot run them (:run is unavailable).",
  });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [replTool as unknown as Tool] }));
  server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
    const args = (params.arguments ?? {}) as Record<string, unknown>;
    const invalid = params.name !== "repl" ? `Unknown tool ${params.name}.`
      : typeof args.input !== "string" ? "repl needs a string input."
      : args.input.length > MAX_INPUT ? `Input is limited to ${MAX_INPUT} characters.`
      : args.session !== undefined && (typeof args.session !== "string" || args.session.length > 64) ? "session must be a name of at most 64 characters."
      : Object.keys(args).some(key => key !== "input" && key !== "session") ? "repl accepts only input and session." : undefined;
    if (invalid) {
      const result = { ok: false, diagnostics: [{ code: "abi/invalid-request", severity: "error", message: invalid }] };
      return { content: [{ type: "text" as const, text: invalid }], structuredContent: result, isError: true };
    }
    const response = await session.fetch("https://repl/call", { method: "POST", body: JSON.stringify(args) });
    const reply = await response.json() as ReplReply;
    return { content: [{ type: "text" as const, text: reply.text }], structuredContent: reply.result, ...(reply.result.ok ? {} : { isError: true }) };
  });
  const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
  await server.connect(transport);
  const response = await transport.handleRequest(request);
  return withHeaders(response, { ...corsHeaders, "mcp-session-id": sessionId });
}

/** One MCP session's REPL. It saves each named REPL session after every call and forgets them after a day idle. */
export class ReplSession {
  readonly #storage: DurableObjectStorage;
  #repl: ReturnType<typeof createRepl> | undefined;
  #ready: Promise<void> | undefined;
  #queue: Promise<unknown> = Promise.resolve();

  constructor(state: { readonly storage: DurableObjectStorage }) {
    this.#storage = state.storage;
  }

  async #load(): Promise<void> {
    this.#repl = createRepl(new JsonAbi(), { runUnavailable: RUN_UNAVAILABLE, runNote: RUN_UNAVAILABLE });
    for (const [key, saved] of await this.#storage.list<ReplSnapshot>({ prefix: "session:" })) {
      await this.#repl.restore(key.slice("session:".length), saved);
    }
  }

  fetch(request: Request): Promise<Response> {
    // Calls for one session run one at a time; the REPL awaits between steps.
    const next = this.#queue.then(() => this.#handle(request));
    this.#queue = next.catch(() => undefined);
    return next;
  }

  async #handle(request: Request): Promise<Response> {
    if (new URL(request.url).pathname === "/delete") {
      await this.#storage.deleteAll();
      this.#repl = undefined;
      this.#ready = undefined;
      return new Response(null, { status: 204 });
    }
    this.#ready ??= this.#load();
    await this.#ready;
    const args = await request.json() as { input: string; session?: string };
    const name = args.session ?? "default";
    const reply = await this.#repl!.call(args);
    const saved = this.#repl!.snapshot(name);
    let text = reply.text;
    if (!saved) await this.#storage.delete(`session:${name}`);
    else if (JSON.stringify(saved).length > MAX_SNAPSHOT) text += "\n(This session is too large to save; it lasts only while the server keeps it in memory. :reset starts over.)";
    else await this.#storage.put(`session:${name}`, saved);
    await this.#storage.setAlarm(Date.now() + IDLE_MS);
    return Response.json({ ...reply, text });
  }

  async alarm(): Promise<void> {
    await this.#storage.deleteAll();
    this.#repl = undefined;
    this.#ready = undefined;
  }
}

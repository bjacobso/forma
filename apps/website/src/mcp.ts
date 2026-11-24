/**
 * Effect-native hosted MCP Streamable HTTP handler for forma-lang.com/mcp.
 *
 * Uses Effect `Context.Service` for rate limiting and Durable Object session
 * access, Effect `Schema` + `effect/ai/McpSchema` for wire validation, and
 * typed errors mapped cleanly at the HTTP boundary — with no dependency on
 * `@modelcontextprotocol/sdk`.
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import { replTool, type ReplReply } from "@formalang/host/repl";
import { engineVersion } from "@formalang/ts/engine";
import {
  CallToolParamsSchema,
  InitializeParamsSchema,
  JsonRpcInboundSchema,
  MAX_INPUT,
  MAX_SESSION_NAME,
  MCP_INSTRUCTIONS,
  McpMethodNotAllowed,
  McpRateLimited,
  McpRpcError,
  McpSchema,
  McpSessionUnavailable,
  ReplCallArgsSchema,
  ReplSessionError,
  SERVER_ERROR_CODE,
  negotiateProtocolVersion,
  type ReplCallArgs,
} from "./mcpSchema";
import {
  makeMemorySessionStorage,
  makeReplSessionRuntime,
  type MemorySessionStore,
  type ReplSessionRuntime,
} from "./replSession";

// ---------------------------------------------------------------------------
// Effect services
// ---------------------------------------------------------------------------

/** Per-client rate limiter for `/mcp` requests. */
export class McpRateLimit extends Context.Service<
  McpRateLimit,
  {
    readonly allow: (key: string) => Effect.Effect<boolean>;
  }
>()("forma/McpRateLimit") {
  static readonly Unlimited = Layer.succeed(McpRateLimit, {
    allow: () => Effect.succeed(true),
  });
}

/** Client for routing MCP session calls to a `ReplSession` Durable Object. */
export class ReplSessionClient extends Context.Service<
  ReplSessionClient,
  {
    readonly call: (
      sessionId: string,
      args: ReplCallArgs,
    ) => Effect.Effect<ReplReply, ReplSessionError | McpSessionUnavailable>;
    readonly clear: (sessionId: string) => Effect.Effect<void, McpSessionUnavailable>;
  }
>()("forma/ReplSessionClient") {}

export interface MemoryReplSessionsHarness {
  readonly layer: Layer.Layer<ReplSessionClient>;
  readonly stores: Map<string, MemorySessionStore>;
  readonly evictAll: () => void;
  readonly fireAlarm: (sessionId: string) => Effect.Effect<void>;
}

/**
 * In-memory `ReplSessionClient` harness backed by `makeReplSessionRuntime` and
 * `makeMemorySessionStorage`. Calling `evictAll()` drops live REPL instances
 * while preserving stored snapshots, simulating Durable Object eviction.
 */
export function makeMemoryReplSessions(): MemoryReplSessionsHarness {
  const stores = new Map<string, MemorySessionStore>();
  const instances = new Map<string, ReplSessionRuntime>();

  const getInstance = (sessionId: string): Effect.Effect<ReplSessionRuntime> =>
    Effect.gen(function* () {
      const existing = instances.get(sessionId);
      if (existing !== undefined) return existing;
      let store = stores.get(sessionId);
      if (store === undefined) {
        store = makeMemorySessionStorage();
        stores.set(sessionId, store);
      }
      const runtime = yield* makeReplSessionRuntime(store.storage);
      instances.set(sessionId, runtime);
      return runtime;
    });

  const layer = Layer.succeed(ReplSessionClient, {
    call: (sessionId, args) =>
      getInstance(sessionId).pipe(Effect.flatMap((runtime) => runtime.call(args))),
    clear: (sessionId) =>
      getInstance(sessionId).pipe(Effect.flatMap((runtime) => runtime.clear())),
  });

  return {
    layer,
    stores,
    evictAll: () => {
      instances.clear();
    },
    fireAlarm: (sessionId) =>
      getInstance(sessionId).pipe(Effect.flatMap((runtime) => runtime.alarm())),
  };
}

// ---------------------------------------------------------------------------
// HTTP & JSON-RPC helpers
// ---------------------------------------------------------------------------

export const mcpCorsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, DELETE, OPTIONS",
  "access-control-allow-headers":
    "content-type, accept, mcp-session-id, mcp-protocol-version, authorization",
  "access-control-expose-headers": "mcp-session-id",
} as const;

const decodeInbound = Schema.decodeUnknownEffect(JsonRpcInboundSchema);
const decodeInitParams = Schema.decodeUnknownEffect(InitializeParamsSchema);
const decodeCallToolParams = Schema.decodeUnknownEffect(CallToolParamsSchema);
const decodeReplArgs = Schema.decodeUnknownEffect(ReplCallArgsSchema, {
  onExcessProperty: "error",
});

function jsonResponse(
  body: unknown,
  status = 200,
  extraHeaders?: Record<string, string>,
): HttpServerResponse.HttpServerResponse {
  return HttpServerResponse.jsonUnsafe(body, {
    status,
    headers: { ...mcpCorsHeaders, ...extraHeaders },
  });
}

function rpcSuccess(
  id: McpSchema.RequestId,
  result: unknown,
  sessionId: string,
): HttpServerResponse.HttpServerResponse {
  return jsonResponse(
    { jsonrpc: "2.0", id, result },
    200,
    { "mcp-session-id": sessionId },
  );
}

function rpcErrorResponse(
  status: number,
  code: number,
  message: string,
  id: McpSchema.RequestId | null = null,
  extraHeaders?: Record<string, string>,
): HttpServerResponse.HttpServerResponse {
  return jsonResponse(
    { jsonrpc: "2.0", error: { code, message }, id },
    status,
    extraHeaders,
  );
}

/**
 * True when a request to `/mcp` targets the MCP Streamable HTTP server rather
 * than the VitePress browser documentation page.
 */
export function isMcpRequest(request: {
  readonly method: string;
  readonly headers: Readonly<Record<string, string | undefined>> | Headers;
}): boolean {
  if (request.method === "GET" || request.method === "HEAD") {
    const accept =
      request.headers instanceof Headers
        ? request.headers.get("accept")
        : request.headers["accept"];
    return accept?.includes("text/event-stream") === true;
  }
  return true;
}

function invalidToolResult(message: string) {
  const result = {
    ok: false,
    diagnostics: [{ code: "abi/invalid-request", severity: "error", message }],
  };
  return {
    content: [{ type: "text" as const, text: message }],
    structuredContent: result,
    isError: true,
  };
}

/**
 * Validates `tools/call` arguments through `ReplCallArgsSchema` and produces
 * concise, actionable diagnostics when validation fails.
 */
const validateReplArguments = (
  toolName: string,
  rawArgs: Record<string, unknown>,
): Effect.Effect<ReplCallArgs, string> =>
  Effect.gen(function* () {
    if (toolName !== "repl") {
      return yield* Effect.fail(`Unknown tool ${toolName}.`);
    }
    const decoded = yield* Effect.result(decodeReplArgs(rawArgs));
    if (decoded._tag === "Success") return decoded.success;

    if (typeof rawArgs["input"] !== "string") {
      return yield* Effect.fail("repl needs a string input.");
    }
    if (rawArgs["input"].length > MAX_INPUT) {
      return yield* Effect.fail(`Input is limited to ${MAX_INPUT} characters.`);
    }
    if (
      rawArgs["session"] !== undefined &&
      (typeof rawArgs["session"] !== "string" || rawArgs["session"].length > MAX_SESSION_NAME)
    ) {
      return yield* Effect.fail(
        `session must be a name of at most ${MAX_SESSION_NAME} characters.`,
      );
    }
    if (Object.keys(rawArgs).some((key) => key !== "input" && key !== "session")) {
      return yield* Effect.fail("repl accepts only input and session.");
    }
    return yield* Effect.fail(decoded.failure.message);
  });

// ---------------------------------------------------------------------------
// Core Effect handler
// ---------------------------------------------------------------------------

const handleMcpCore: Effect.Effect<
  HttpServerResponse.HttpServerResponse,
  McpRateLimited | McpMethodNotAllowed | McpRpcError | McpSessionUnavailable | ReplSessionError,
  HttpServerRequest.HttpServerRequest | McpRateLimit | ReplSessionClient
> = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;

  if (request.method === "OPTIONS") {
    return HttpServerResponse.empty({ status: 204, headers: mcpCorsHeaders });
  }

  // The server answers each POST with JSON; it does not offer a server-to-client SSE stream.
  if (request.method === "GET" || request.method === "HEAD") {
    return yield* new McpMethodNotAllowed({
      method: request.method,
      allow: "POST, DELETE, OPTIONS",
      jsonRpc: false,
    });
  }

  const rateLimit = yield* McpRateLimit;
  const clientKey = request.headers["cf-connecting-ip"] ?? "anonymous";
  const allowed = yield* rateLimit.allow(clientKey);
  if (!allowed) {
    return yield* new McpRateLimited({ key: clientKey });
  }

  const sessions = yield* ReplSessionClient;
  const sessionId = request.headers["mcp-session-id"] ?? crypto.randomUUID();

  if (request.method === "DELETE") {
    yield* sessions.clear(sessionId);
    return HttpServerResponse.empty({ status: 204, headers: mcpCorsHeaders });
  }

  if (request.method !== "POST") {
    return yield* new McpMethodNotAllowed({
      method: request.method,
      allow: "POST, DELETE, OPTIONS",
      jsonRpc: true,
    });
  }

  const bodyText = yield* request.text.pipe(
    Effect.mapError(
      () =>
        new McpRpcError({
          status: 400,
          code: McpSchema.PARSE_ERROR_CODE,
          message: "Could not read request body.",
          id: null,
        }),
    ),
  );

  const parsedJson = yield* Effect.try({
    try: () => JSON.parse(bodyText) as unknown,
    catch: () =>
      new McpRpcError({
        status: 400,
        code: McpSchema.PARSE_ERROR_CODE,
        message: "Parse error: invalid JSON.",
        id: null,
      }),
  });

  const message = yield* decodeInbound(parsedJson).pipe(
    Effect.mapError(
      () =>
        new McpRpcError({
          status: 400,
          code: McpSchema.INVALID_REQUEST_ERROR_CODE,
          message: "Invalid JSON-RPC 2.0 request.",
          id: null,
        }),
    ),
  );

  // Notifications have no `id` and are acknowledged with 202 Accepted.
  if (!("id" in message)) {
    return HttpServerResponse.empty({
      status: 202,
      headers: { ...mcpCorsHeaders, "mcp-session-id": sessionId },
    });
  }

  const { id, method, params } = message;

  switch (method) {
    case "initialize": {
      const init = yield* decodeInitParams(params ?? {}).pipe(
        Effect.mapError(
          () =>
            new McpRpcError({
              status: 400,
              code: McpSchema.INVALID_PARAMS_ERROR_CODE,
              message: "initialize requires a string protocolVersion.",
              id,
            }),
        ),
      );
      return rpcSuccess(
        id,
        {
          protocolVersion: negotiateProtocolVersion(init.protocolVersion),
          capabilities: { tools: {} },
          serverInfo: { name: "forma", version: engineVersion },
          instructions: MCP_INSTRUCTIONS,
        },
        sessionId,
      );
    }

    case "ping":
      return rpcSuccess(id, {}, sessionId);

    case "tools/list":
      return rpcSuccess(id, { tools: [replTool] }, sessionId);

    case "tools/call": {
      const callParams = yield* decodeCallToolParams(params ?? {}).pipe(
        Effect.mapError(
          () =>
            new McpRpcError({
              status: 400,
              code: McpSchema.INVALID_PARAMS_ERROR_CODE,
              message: "tools/call requires a tool name.",
              id,
            }),
        ),
      );
      const validated = yield* Effect.result(
        validateReplArguments(callParams.name, callParams.arguments ?? {}),
      );
      if (validated._tag === "Failure") {
        return rpcSuccess(id, invalidToolResult(validated.failure), sessionId);
      }
      const reply = yield* sessions.call(sessionId, validated.success);
      return rpcSuccess(
        id,
        {
          content: [{ type: "text" as const, text: reply.text }],
          structuredContent: reply.result,
          ...(reply.result.ok ? {} : { isError: true }),
        },
        sessionId,
      );
    }

    default:
      return yield* new McpRpcError({
        status: 200,
        code: McpSchema.METHOD_NOT_FOUND_ERROR_CODE,
        message: `Method not found: ${method}`,
        id,
      });
  }
});

/**
 * Effect-native MCP HTTP handler. Maps every typed error to the appropriate
 * HTTP status and JSON-RPC error payload with CORS headers.
 */
export const handleMcp: Effect.Effect<
  HttpServerResponse.HttpServerResponse,
  never,
  HttpServerRequest.HttpServerRequest | McpRateLimit | ReplSessionClient
> = handleMcpCore.pipe(
  Effect.catchTags({
    McpRateLimited: () =>
      Effect.succeed(
        rpcErrorResponse(
          429,
          SERVER_ERROR_CODE,
          "Too many requests to forma-lang.com/mcp; wait a minute and try again.",
        ),
      ),
    McpMethodNotAllowed: (err) =>
      Effect.succeed(
        err.jsonRpc
          ? rpcErrorResponse(405, SERVER_ERROR_CODE, "Use POST.")
          : HttpServerResponse.empty({
              status: 405,
              headers: { ...mcpCorsHeaders, allow: err.allow },
            }),
      ),
    McpRpcError: (err) =>
      Effect.succeed(rpcErrorResponse(err.status, err.code, err.message, err.id)),
    McpSessionUnavailable: (err) =>
      Effect.succeed(rpcErrorResponse(503, SERVER_ERROR_CODE, err.reason)),
    ReplSessionError: (err) =>
      Effect.succeed(
        rpcErrorResponse(500, McpSchema.INTERNAL_ERROR_CODE, `REPL session failed: ${err.message}`),
      ),
  }),
);

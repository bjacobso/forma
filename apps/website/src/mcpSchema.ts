/**
 * Effect Schemas and typed errors for the hosted Forma MCP endpoint and its
 * ReplSession Durable Object storage.
 */
import * as Data from "effect/Data";
import * as Schema from "effect/Schema";
import * as McpSchema from "effect/ai/McpSchema";
import type { ReplSnapshot } from "@formalang/host/repl";

export const MAX_INPUT = 20_000;
export const MAX_SESSION_NAME = 64;
export const MAX_SNAPSHOT = 1_000_000;
export const IDLE_MS = 24 * 60 * 60 * 1000;

export const SERVER_ERROR_CODE = -32000;

export const SUPPORTED_PROTOCOL_VERSIONS = [
  "2025-11-25",
  "2025-06-18",
  "2025-03-26",
  "2024-11-05",
] as const;

export const LATEST_PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0];

export const RUN_UNAVAILABLE =
  "The hosted server at forma-lang.com/mcp checks, infers, expands and generates Effect programs but does not run them. Run `forma mcp` locally to use :run; see https://forma-lang.com/mcp.";

export const MCP_INSTRUCTIONS =
  "Explore the Forma language with the repl tool: send :help first, then :outline and :doc <name>. Sessions keep definitions between calls. This server checks, infers and generates Effect programs but cannot run them (:run is unavailable).";

// ---------------------------------------------------------------------------
// Durable Object stored state schemas
// ---------------------------------------------------------------------------

export const EffectFormSchema = Schema.Struct({
  key: Schema.String,
  sourceId: Schema.String,
  cell: Schema.String,
  start: Schema.Int,
  end: Schema.Int,
});

export const ReplSnapshotSchema = Schema.Struct({
  inputs: Schema.Int,
  preludes: Schema.Array(Schema.Tuple([Schema.String, Schema.String])),
  history: Schema.Array(
    Schema.Struct({
      sourceId: Schema.String,
      source: Schema.String,
    }),
  ),
  effect: Schema.Array(EffectFormSchema),
  declarations: Schema.Array(EffectFormSchema),
});

export type StoredReplSnapshot = typeof ReplSnapshotSchema.Type;

// Compile-time check that StoredReplSnapshot stays structurally assignable to ReplSnapshot.
const _assertSnapshotMatchesHost = (snapshot: StoredReplSnapshot): ReplSnapshot => snapshot;
void _assertSnapshotMatchesHost;

// ---------------------------------------------------------------------------
// Tool call & MCP Streamable HTTP JSON-RPC schemas
// ---------------------------------------------------------------------------

export const ReplCallArgsSchema = Schema.Struct({
  input: Schema.String.check(Schema.isMaxLength(MAX_INPUT)),
  session: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(MAX_SESSION_NAME))),
});

export type ReplCallArgs = typeof ReplCallArgsSchema.Type;

export const JsonRpcRequestEnvelope = Schema.Struct({
  jsonrpc: Schema.Literal("2.0"),
  id: McpSchema.RequestId,
  method: Schema.String,
  params: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
});

export type JsonRpcRequestEnvelope = typeof JsonRpcRequestEnvelope.Type;

export const JsonRpcNotificationEnvelope = Schema.Struct({
  jsonrpc: Schema.Literal("2.0"),
  method: Schema.String,
  params: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
});

export type JsonRpcNotificationEnvelope = typeof JsonRpcNotificationEnvelope.Type;

export const JsonRpcInboundSchema = Schema.Union([
  JsonRpcRequestEnvelope,
  JsonRpcNotificationEnvelope,
]);

export type JsonRpcInbound = typeof JsonRpcInboundSchema.Type;

export const InitializeParamsSchema = Schema.Struct({
  protocolVersion: Schema.String,
  capabilities: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
  clientInfo: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
});

export const CallToolParamsSchema = Schema.Struct({
  name: Schema.String,
  arguments: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
});

export function negotiateProtocolVersion(requested: string): string {
  return (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(requested)
    ? requested
    : LATEST_PROTOCOL_VERSION;
}

// ---------------------------------------------------------------------------
// Typed errors
// ---------------------------------------------------------------------------

/**
 * Serializable RPC error that crosses the Worker <-> ReplSession Durable Object boundary.
 * Registered on `ReplSession`'s `errors` option so callers can match it with `Effect.catchTag`.
 */
export class ReplSessionError extends Schema.TaggedError<ReplSessionError>()(
  "ReplSessionError",
  {
    message: Schema.String,
  },
) {}

export class McpRateLimited extends Data.TaggedError("McpRateLimited")<{
  readonly key: string;
}> {}

export class McpMethodNotAllowed extends Data.TaggedError("McpMethodNotAllowed")<{
  readonly method: string;
  readonly allow: string;
  readonly jsonRpc: boolean;
}> {}

export class McpSessionUnavailable extends Data.TaggedError("McpSessionUnavailable")<{
  readonly reason: string;
}> {}

export class McpRpcError extends Data.TaggedError("McpRpcError")<{
  readonly status: number;
  readonly code: number;
  readonly message: string;
  readonly id: McpSchema.RequestId | null;
}> {}

export { McpSchema };

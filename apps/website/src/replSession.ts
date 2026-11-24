/**
 * Effect-native `ReplSession` Durable Object.
 *
 * Each MCP session maps to one Durable Object instance addressed by
 * `mcp-session-id`. Calls are serialized with an Effect `Semaphore`, snapshots
 * are validated with `ReplSnapshotSchema`, and idle sessions are cleared after
 * 24 hours via a Durable Object alarm driven by Effect's `Clock`.
 */
import * as Cloudflare from "@alchemy.run/cloudflare";
import type { DurableObjectStorage as CfDurableObjectStorage } from "@alchemy.run/cloudflare/Workers";
import type { RuntimeContext } from "alchemy/RuntimeContext";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import type { ReplReply, createRepl } from "@formalang/host/repl";
import {
  IDLE_MS,
  MAX_SNAPSHOT,
  RUN_UNAVAILABLE,
  ReplSessionError,
  ReplSnapshotSchema,
  type ReplCallArgs,
} from "./mcpSchema";

const SESSION_PREFIX = "session:";
const decodeSnapshot = Schema.decodeUnknownEffect(ReplSnapshotSchema);
const encodeSnapshot = Schema.encodeEffect(ReplSnapshotSchema);

/**
 * Storage contract for a single ReplSession instance. Backed by Cloudflare
 * Durable Object storage in production / `alchemy dev`, and by an in-memory
 * map in unit tests.
 */
export interface SessionStorageService {
  readonly list: (prefix: string) => Effect.Effect<ReadonlyMap<string, unknown>, never, RuntimeContext>;
  readonly put: (key: string, value: unknown) => Effect.Effect<void, never, RuntimeContext>;
  readonly delete: (key: string) => Effect.Effect<boolean, never, RuntimeContext>;
  readonly deleteAll: () => Effect.Effect<void, never, RuntimeContext>;
  readonly setAlarm: (scheduledTime: number) => Effect.Effect<void, never, RuntimeContext>;
}

/**
 * Storage contract without `RuntimeContext` for pure unit tests.
 */
export interface PureSessionStorageService {
  readonly list: (prefix: string) => Effect.Effect<ReadonlyMap<string, unknown>>;
  readonly put: (key: string, value: unknown) => Effect.Effect<void>;
  readonly delete: (key: string) => Effect.Effect<boolean>;
  readonly deleteAll: () => Effect.Effect<void>;
  readonly setAlarm: (scheduledTime: number) => Effect.Effect<void>;
}

export class SessionStorage extends Context.Service<
  SessionStorage,
  SessionStorageService | PureSessionStorageService
>()("forma/SessionStorage") {}

export const fromDurableObjectStorage = (
  storage: CfDurableObjectStorage,
): SessionStorageService => ({
  list: (prefix) => storage.list({ prefix }),
  put: (key, value) => storage.put(key, value),
  delete: (key) => storage.delete(key),
  deleteAll: () => storage.deleteAll(),
  setAlarm: (scheduledTime) => storage.setAlarm(scheduledTime),
});

export interface MemorySessionStore {
  readonly data: Map<string, unknown>;
  readonly getAlarm: () => number | undefined;
  readonly storage: PureSessionStorageService;
}

export function makeMemorySessionStorage(): MemorySessionStore {
  const data = new Map<string, unknown>();
  let alarmAt: number | undefined;
  const storage: PureSessionStorageService = {
    list: (prefix) =>
      Effect.sync(
        () =>
          new Map(
            [...data]
              .filter(([key]) => key.startsWith(prefix))
              .map(([key, value]) => [key, structuredClone(value)]),
          ),
      ),
    put: (key, value) =>
      Effect.sync(() => {
        data.set(key, structuredClone(value));
      }),
    delete: (key) => Effect.sync(() => data.delete(key)),
    deleteAll: () =>
      Effect.sync(() => {
        data.clear();
        alarmAt = undefined;
      }),
    setAlarm: (scheduledTime) =>
      Effect.sync(() => {
        alarmAt = scheduledTime;
      }),
  };
  return {
    data,
    getAlarm: () => alarmAt,
    storage,
  };
}

export interface ReplSessionRuntime<R = never> {
  readonly call: (args: ReplCallArgs) => Effect.Effect<ReplReply, ReplSessionError, R>;
  readonly clear: () => Effect.Effect<void, never, R>;
  readonly alarm: () => Effect.Effect<void, never, R>;
}

/**
 * Pure Effect implementation of one `ReplSession` instance's lifecycle:
 * lazy restore from validated snapshots, serialized execution via `Semaphore`,
 * snapshot persistence with 1 MB guard, and 24-hour idle alarm scheduling.
 */
export function makeReplSessionRuntime<R>(
  storage: {
    readonly list: (prefix: string) => Effect.Effect<ReadonlyMap<string, unknown>, never, R>;
    readonly put: (key: string, value: unknown) => Effect.Effect<void, never, R>;
    readonly delete: (key: string) => Effect.Effect<boolean, never, R>;
    readonly deleteAll: () => Effect.Effect<void, never, R>;
    readonly setAlarm: (scheduledTime: number) => Effect.Effect<void, never, R>;
  },
): Effect.Effect<ReplSessionRuntime<R>> {
  return Effect.gen(function* () {
    const mutex = yield* Semaphore.make(1);
    let repl: ReturnType<typeof createRepl> | undefined;

    const ensureLoaded: Effect.Effect<ReturnType<typeof createRepl>, ReplSessionError, R> =
      Effect.gen(function* () {
        if (repl !== undefined) return repl;
        const [{ JsonAbi }, { createRepl: makeRepl }] = yield* Effect.tryPromise({
          try: () =>
            Promise.all([
              import("@formalang/host/json-abi"),
              import("@formalang/host/repl"),
            ]),
          catch: (cause) =>
            new ReplSessionError({
              message: cause instanceof Error ? cause.message : String(cause),
            }),
        });
        const instance = makeRepl(new JsonAbi(), {
          runUnavailable: RUN_UNAVAILABLE,
          runNote: RUN_UNAVAILABLE,
        });
        const entries = yield* storage.list(SESSION_PREFIX);
        for (const [key, raw] of entries) {
          const decoded = yield* decodeSnapshot(raw).pipe(
            Effect.catchTag("SchemaError", (error) =>
              Effect.logWarning(`Skipping invalid stored REPL snapshot for ${key}: ${error.message}`).pipe(
                Effect.as(undefined),
              ),
            ),
          );
          if (decoded === undefined) continue;
          const name = key.slice(SESSION_PREFIX.length);
          yield* Effect.tryPromise({
            try: () => instance.restore(name, decoded),
            catch: (cause) =>
              new ReplSessionError({
                message: cause instanceof Error ? cause.message : String(cause),
              }),
          });
        }
        repl = instance;
        return instance;
      });

    const reset: Effect.Effect<void, never, R> = mutex.withPermits(1)(
      Effect.gen(function* () {
        yield* storage.deleteAll();
        repl = undefined;
      }),
    );

    const call = (args: ReplCallArgs): Effect.Effect<ReplReply, ReplSessionError, R> =>
      mutex.withPermits(1)(
        Effect.gen(function* () {
          const instance = yield* ensureLoaded;
          const name = args.session ?? "default";
          const reply = yield* Effect.tryPromise({
            try: () => instance.call(args),
            catch: (cause) =>
              new ReplSessionError({
                message: cause instanceof Error ? cause.message : String(cause),
              }),
          });

          const saved = instance.snapshot(name);
          let text = reply.text;
          if (!saved) {
            yield* storage.delete(`${SESSION_PREFIX}${name}`);
          } else {
            const encoded = yield* encodeSnapshot(saved).pipe(
              Effect.mapError((error) => new ReplSessionError({ message: error.message })),
            );
            if (JSON.stringify(encoded).length > MAX_SNAPSHOT) {
              text +=
                "\n(This session is too large to save; it lasts only while the server keeps it in memory. :reset starts over.)";
            } else {
              yield* storage.put(`${SESSION_PREFIX}${name}`, encoded);
            }
          }

          const now = yield* Clock.currentTimeMillis;
          yield* storage.setAlarm(now + IDLE_MS);
          return { result: reply.result, text };
        }),
      );

    return {
      call,
      clear: () => reset,
      alarm: () => reset,
    };
  });
}

// ---------------------------------------------------------------------------
// Alchemy Effect-native Durable Object
// ---------------------------------------------------------------------------

export interface ReplSessionRpc {
  readonly call: (
    args: ReplCallArgs,
  ) => Effect.Effect<ReplReply, ReplSessionError, RuntimeContext>;
  readonly clear: () => Effect.Effect<void, never, RuntimeContext>;
  readonly alarm: () => Effect.Effect<void, never, RuntimeContext>;
}

/**
 * Cloudflare Durable Object class managed by Alchemy.
 *
 * Exposes typed Effect RPC methods (`call`, `clear`) and a 24-hour idle `alarm`
 * — no internal HTTP routing or JSON serialization glue needed between the
 * Worker and the Durable Object.
 */
export class ReplSession extends Cloudflare.DurableObject<ReplSession, ReplSessionRpc>()(
  "ReplSession",
  { errors: [ReplSessionError] },
) {}

export const ReplSessionLive = ReplSession.make(
  Effect.gen(function* () {
    const state = yield* Cloudflare.DurableObjectState;
    return Effect.gen(function* () {
      return yield* makeReplSessionRuntime(fromDurableObjectStorage(state.storage));
    });
  }),
);

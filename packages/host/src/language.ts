import { normalizeModuleId } from "@formalang/ts/modules";
import type { LanguageDescription } from "./description.js";
export type { LanguageDescription } from "./description.js";
import { TsLanguageHost } from "./ts-host.js";
import { plainJsonFromValue } from "./value-projections.js";
import type {
  Diagnostic, EmitRequest, HostBuiltinDescriptor, LanguageHost,
  TypeProjection, ValueProjection,
} from "./types.js";

export type LanguageJson = null | boolean | number | string | readonly LanguageJson[] | { readonly [key: string]: LanguageJson };

export type CapabilityResult =
  | { readonly ok: true; readonly value: LanguageJson }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] };

export interface LanguageCapability {
  readonly arity: HostBuiltinDescriptor["arity"];
  /** Omitted schemes use the host's permissive any scheme, with the declared arity. */
  readonly typeScheme?: HostBuiltinDescriptor["typeScheme"];
  readonly handler: (...args: readonly unknown[]) => CapabilityResult | Promise<CapabilityResult>;
}

export interface LanguageOptions {
  readonly preludes?: readonly { readonly id: string; readonly source: string }[];
  /** In-memory file modules. Only their exports become automatic imports. IDs are bundle-relative paths. */
  readonly modules?: readonly { readonly id: string; readonly source: string }[];
  readonly capabilities?: Readonly<Record<string, LanguageCapability>>;
}

export interface LanguageSourceOptions {
  readonly sourceId?: string;
}

export interface LanguageRunOptions extends LanguageSourceOptions {
  readonly limits?: {
    readonly steps?: number;
    /** Cooperative wall-clock deadline; aborts suspended host calls, not synchronous JS. */
    readonly timeoutMs?: number;
  };
}

export interface LanguageCheckResult {
  readonly ok: boolean;
  readonly type?: TypeProjection;
  readonly diagnostics: readonly Diagnostic[];
}

export interface LanguageRunResult extends LanguageCheckResult {
  /** The existing plain-json projection (keywords keep their colon). */
  readonly value?: unknown;
  readonly printed?: string;
}

export interface Language {
  check(source: string, options?: LanguageSourceOptions): Promise<LanguageCheckResult>;
  run(source: string, options?: LanguageRunOptions): Promise<LanguageRunResult>;
  describe(): LanguageDescription;
  emit(source: string, options?: LanguageSourceOptions & { readonly backend?: string }): Promise<Awaited<ReturnType<NonNullable<LanguageHost["emit"]>>>>;
  close(): Promise<void>;
}

/** A prelude failed validation; no language instance or session is retained. */
export class LanguageInitializationError extends Error {
  constructor(readonly diagnostics: readonly Diagnostic[]) {
    super("Could not initialize Forma preludes. Inspect diagnostics for details.");
    this.name = "LanguageInitializationError";
  }
}

/**
 * Experimental promise-based embedding facade over TsLanguageHost.
 * Checks never evaluate. Runs check first and do not retain program definitions.
 * Handlers receive plain-json projections and return { ok: true, value: JSON }
 * or { ok: false, diagnostics }. Thrown/rejected handlers become host-effect/failed
 * diagnostics. Ungranted names fail checking; unexpected calls fail with a diagnostic.
 * timeoutMs covers evaluation and handler waits, calling abortEvaluation for a
 * suspended call. It cannot preempt synchronous engine work: also set steps.
 * close releases the session; await active operations before closing it.
 */
export async function createLanguage(options: LanguageOptions = {}): Promise<Language> {
  const host = new TsLanguageHost();
  const { sessionId } = await host.openSession();
  const capabilities = new Map(Object.entries(options.capabilities ?? {}));
  let description: LanguageDescription;
  let modulePrelude: string | undefined;
  const moduleIds = new Set((options.modules ?? []).map(module => normalizeModuleId(module.id)));
  let defaultSourceId = "main.lisp";
  while (moduleIds.has(defaultSourceId)) defaultSourceId = `_${defaultSourceId}`;
  const programIds = new Set<string>();
  const prepare = async (sourceId: string) => {
    if (moduleIds.has(normalizeModuleId(sourceId)) || sourceId === modulePrelude) {
      throw new TypeError("Program sourceId collides with a vocabulary module ID.");
    }
    if (modulePrelude && !programIds.has(normalizeModuleId(sourceId))) {
      programIds.add(normalizeModuleId(sourceId));
      await host.configureSession({ sessionId, projects: [{ id: "language", base: "main.lisp", prelude: `./${modulePrelude}`, modules: [...programIds] }] });
    }
  };
  let closed = false;
  const assertOpen = () => { if (closed) throw new Error("Forma language is closed."); };
  const failure = (code: string, message: string): LanguageRunResult => ({
    ok: false, diagnostics: [{ code, severity: "error", message, phase: "evaluate" }],
  });
  try {
    await host.configureSession({ sessionId, hostBuiltins: [...capabilities].map(([name, capability]) => ({
      name, arity: capability.arity, typeScheme: capability.typeScheme ?? {
        kind: typeof capability.arity === "number" ? "function" : "variadic-function",
        params: Array.from({ length: typeof capability.arity === "number" ? capability.arity : capability.arity.min }, () => ({ kind: "any" as const })),
        rest: { kind: "any" }, result: { kind: "any" },
      },
      handler: { kind: "host-effect", effect: name },
    })) });
    for (const prelude of options.preludes ?? []) {
      const loaded = await host.loadSource({ sessionId, sourceId: prelude.id, source: prelude.source, kind: "prelude" });
      if (loaded.diagnostics.some(d => d.severity === "error")) throw new LanguageInitializationError(loaded.diagnostics);
    }
    if (options.modules?.some(module => module.id.startsWith("/") || module.id.includes("\\") || normalizeModuleId(module.id).startsWith("../"))) {
      throw new TypeError("Module IDs must be bundle-relative paths.");
    }
    if (options.modules?.length) {
      const loaded = await host.loadSourceBundle({ sessionId, sources: options.modules.map(module => ({ sourceId: module.id, source: module.source })) });
      if (loaded.diagnostics.some(d => d.severity === "error")) throw new LanguageInitializationError(loaded.diagnostics);
      modulePrelude = "__language_prelude__.lisp";
      while (options.modules.some(module => normalizeModuleId(module.id) === modulePrelude)) modulePrelude = `_${modulePrelude}`;
      const reexports: string[] = [];
      const exported = new Map<string, string>();
      for (const module of options.modules) {
        const checked = await host.moduleGraph({ sessionId, sourceId: module.id });
        if (checked.diagnostics.some(d => d.severity === "error")) throw new LanguageInitializationError(checked.diagnostics);
        const names = checked.interfaces.find(entry => entry.moduleId === normalizeModuleId(module.id))!.exports.flatMap(binding => {
          const identity = JSON.stringify(binding.identity);
          if (exported.get(binding.name) === identity) return [];
          exported.set(binding.name, identity);
          return [binding.name];
        });
        if (names.length) reexports.push(`(export-from ${JSON.stringify(`./${normalizeModuleId(module.id)}`)} [${names.join(" ")}])`);
      }
      const barrel = await host.loadSource({ sessionId, sourceId: modulePrelude, source: reexports.join("\n") });
      if (barrel.diagnostics.some(d => d.severity === "error")) throw new LanguageInitializationError(barrel.diagnostics);
    }
    description = await host.describe({ sessionId, ...(modulePrelude ? { sourceId: modulePrelude } : {}) });
    if (description.diagnostics.some(d => d.severity === "error")) throw new LanguageInitializationError(description.diagnostics);
  } catch (error) {
    await host.closeSession({ sessionId });
    throw error;
  }

  const check: Language["check"] = async (source, request = {}) => {
    assertOpen();
    await prepare(request.sourceId ?? defaultSourceId);
    const checked = await host.typecheck({ sessionId, source, sourceId: request.sourceId ?? defaultSourceId });
    return { ok: !checked.diagnostics.some(d => d.severity === "error"),
      ...(checked.type ? { type: checked.type } : {}), diagnostics: checked.diagnostics };
  };
  return {
    check,
    describe() { assertOpen(); return description; },
    async emit(source, request = {}) {
      assertOpen();
      await prepare(request.sourceId ?? defaultSourceId);
      const emitRequest: EmitRequest = { sessionId, source, sourceId: request.sourceId ?? defaultSourceId, ...request };
      return host.emit!(emitRequest);
    },
    async run(source, request = {}) {
      const timeoutMs = request.limits?.timeoutMs;
      if (timeoutMs !== undefined && (!Number.isFinite(timeoutMs) || timeoutMs < 0 || timeoutMs > 2_147_483_647)) {
        throw new RangeError("timeoutMs must be between 0 and 2147483647 milliseconds.");
      }
      const checked = await check(source, request);
      if (!checked.ok) return checked;
      const deadline = timeoutMs === undefined ? Infinity : Date.now() + Math.max(0, timeoutMs);
      const timedOut = () => Date.now() >= deadline;
      const timeout = () => failure("evaluation/aborted", "Evaluation exceeded timeoutMs.");
      if (timedOut()) return timeout();
      let state = await host.evaluateInSession({ sessionId, source, sourceId: request.sourceId ?? defaultSourceId,
        stepLimit: request.limits?.steps });
      while (state.status === "host-call") {
        const call = state.call;
        const abort = async () => {
          await host.abortEvaluation({ sessionId, evaluationId: call.evaluationId, reason: "Evaluation exceeded timeoutMs." });
          return timeout();
        };
        if (timedOut()) return abort();
        const capability = capabilities.get(call.name);
        const handled = Promise.resolve().then(async (): Promise<CapabilityResult> => {
          if (!capability) return { ok: false, diagnostics: failure("host-effect/failed", "No capability granted for this host call.").diagnostics };
          try {
            const result = await capability.handler(...call.args.map(plainJsonFromValue));
            if (result.ok) return { ok: true, value: result.value };
            return { ok: false, diagnostics: result.diagnostics.some(d => d.severity === "error")
              ? result.diagnostics : failure("host-effect/failed", "Capability failed without an error diagnostic.").diagnostics };
          } catch {
            return { ok: false, diagnostics: failure("host-effect/failed", "Capability handler threw or rejected.").diagnostics };
          }
        });
        let timer: ReturnType<typeof setTimeout> | undefined;
        const expired = Symbol("timeout");
        const answer = await Promise.race([handled, new Promise<typeof expired>(resolve => {
          if (deadline !== Infinity) timer = setTimeout(() => resolve(expired), Math.min(2_147_483_647, Math.max(0, deadline - Date.now())));
        })]);
        if (timer !== undefined) clearTimeout(timer);
        if (answer === expired || timedOut()) return abort();
        let result;
        try {
          result = answer.ok ? { ok: true as const, value: jsonProjection(answer.value) } : answer;
        } catch {
          result = { ok: false as const, diagnostics: failure("host-effect/failed", "Capability returned an invalid JSON value.").diagnostics };
        }
        state = await host.resumeHostCall({ sessionId, evaluationId: call.evaluationId, callId: call.callId, result });
      }
      if (timedOut()) return timeout();
      if (state.status === "failed") return { ok: false, diagnostics: [...checked.diagnostics, ...state.diagnostics] };
      return { ok: true, value: plainJsonFromValue(state.result.value),
        ...(state.result.printed !== undefined ? { printed: state.result.printed } : {}),
        ...(checked.type ? { type: checked.type } : {}), diagnostics: [...checked.diagnostics, ...state.result.diagnostics] };
    },
    async close() {
      if (!closed) { closed = true; await host.closeSession({ sessionId }); }
    },
  };
}

function jsonProjection(value: LanguageJson): ValueProjection {
  if (value === null) return { kind: "nil" };
  if (typeof value === "boolean") return { kind: "bool", value };
  if (typeof value === "string") return { kind: "string", value };
  if (typeof value === "number" && Number.isFinite(value)) return { kind: Number.isSafeInteger(value) && !Object.is(value, -0) ? "int" : "float", value };
  if (Array.isArray(value)) return { kind: "vector", items: value.map(jsonProjection) };
  if (typeof value === "object" && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) {
    return { kind: "map", entries: Object.entries(value).map(([key, item]) => ({ key: { kind: "string", value: key }, value: jsonProjection(item) })) };
  }
  throw new Error("Expected a JSON value.");
}

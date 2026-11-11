import { TsLanguageHost } from "./ts-host.js";
import { plainJsonFromValue } from "./value-projections.js";
import type {
  Diagnostic, EmitRequest, FormSlotsResult, HostBuiltinDescriptor, LanguageHost,
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

export interface LanguageDescription {
  readonly forms: readonly {
    readonly name: string;
    readonly identifiers: FormSlotsResult["identifiers"];
    readonly slots: FormSlotsResult["slots"];
  }[];
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
  const host: LanguageHost = new TsLanguageHost();
  const { sessionId } = await host.openSession();
  const capabilities = new Map(Object.entries(options.capabilities ?? {}));
  const forms = new Map<string, LanguageDescription["forms"][number]>();
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
    // Discover authored form heads through the host, and get slot metadata from
    // the session's descriptor registry rather than interpreting slot syntax here.
    for (const prelude of options.preludes ?? []) {
      const parsed = await host.parse({ sourceId: prelude.id, source: prelude.source });
      for (const node of parsed.ast) {
        if (node.kind !== "list" || node.items[0]?.kind !== "symbol" || node.items[0].value !== "form") continue;
        const signature = node.items[1];
        const head = signature?.kind === "list" ? signature.items[0] : signature;
        if (head?.kind !== "symbol") continue;
        const slots = await host.formSlots!({ sessionId, source: `(${head.value})`, offset: 1 });
        if (slots.form) forms.set(head.value, { name: head.value, identifiers: slots.identifiers, slots: slots.slots });
      }
    }
  } catch (error) {
    await host.closeSession({ sessionId });
    throw error;
  }

  const check: Language["check"] = async (source, request = {}) => {
    assertOpen();
    const checked = await host.typecheck({ sessionId, source, sourceId: request.sourceId ?? "main.lisp" });
    return { ok: !checked.diagnostics.some(d => d.severity === "error"),
      ...(checked.type ? { type: checked.type } : {}), diagnostics: checked.diagnostics };
  };
  return {
    check,
    describe() { assertOpen(); return { forms: [...forms.values()] }; },
    async emit(source, request = {}) {
      assertOpen();
      const emitRequest: EmitRequest = { sessionId, source, sourceId: request.sourceId ?? "main.lisp", ...request };
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
      let state = await host.evaluateInSession({ sessionId, source, sourceId: request.sourceId ?? "main.lisp",
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

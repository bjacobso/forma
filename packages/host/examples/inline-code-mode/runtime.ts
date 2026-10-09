import { readFileSync } from "node:fs";
import { Schema } from "effect";
import { TsLanguageHost } from "@formalang/host/ts-host";
import type { Diagnostic, HostBuiltinDescriptor, TypeSchemeExpr, ValueProjection } from "@formalang/host";
import { elaborateEffectProgram, showMechanicsType } from "@formalang/ts/mechanics";
import type { MechanicsType } from "@formalang/ts/mechanics";
import type { Executable } from "./protocol.ts";

export type Bindings = Readonly<Record<string, (...args: readonly unknown[]) => unknown | Promise<unknown>>>;
export interface Budgets {
  readonly steps: number;
  readonly calls: number;
  readonly output: number;
  readonly source: number;
}
export const defaults: Budgets = { steps: 2_000, calls: 8, output: 4_096, source: 8_192 };
export interface ExecutionResult {
  readonly invocationId: string;
  readonly ok: boolean;
  readonly type?: string;
  readonly value?: unknown;
  readonly diagnostics: readonly Diagnostic[];
  readonly calls: readonly { invocationId: string; operation: string; decision: string }[];
}

const catalog = readFileSync(new URL("./catalog.forma", import.meta.url), "utf8");
const checked = elaborateEffectProgram(catalog, { sourceId: "catalog.forma" });
if (!checked.ok || !checked.check) throw new Error(JSON.stringify(checked.diagnostics));
const info = checked.check;

// Adapt only the catalog's small contract subset to existing Effect Schema.
// Unsupported types fail closed; this is not a general schema compiler.
function schema(type: MechanicsType): Schema.ConstraintDecoder<unknown, never> {
  if (type.kind === "array") return Schema.Array(schema(type.item));
  if (type.kind === "prim") {
    switch (type.name) {
      case "String": return Schema.String;
      case "Bool": return Schema.Boolean;
      case "Int": return Schema.Int;
    }
  }
  throw new Error(`Unsupported catalog schema: ${showMechanicsType(type)}`);
}

function scheme(type: MechanicsType): TypeSchemeExpr {
  if (type.kind === "array") return { kind: "list", item: scheme(type.item) };
  if (type.kind === "prim" && ["String", "Bool", "Int"].includes(type.name))
    return { kind: "type", name: type.name };
  throw new Error(`Unsupported ABI scheme: ${showMechanicsType(type)}`);
}

export const contracts = [...info.services].flatMap(([service, methods]) =>
  [...methods].map(([method, signature]) => {
    const name = `${service}.${method}`;
    const failures = [...signature.effect.errors.keys()].map((tag) => {
      const fields = info.errorFields.get(tag);
      if (!fields) throw new Error(`Unknown failure ${tag}`);
      return Schema.Struct({ _tag: Schema.Literal(tag), ...Object.fromEntries(
        fields.map((field) => [field.name, schema(field.type)]),
      ) });
    });
    const descriptor: HostBuiltinDescriptor = {
      name, arity: signature.params.length,
      typeScheme: { kind: "function", params: signature.params.map((param) => scheme(param.type)),
        result: scheme(signature.effect.success) },
      handler: { kind: "host-effect", effect: name },
      purity: name === "Issues.close" ? "write" : "read",
    };
    return {
      name, descriptor,
      args: Schema.Tuple(signature.params.map((param) => schema(param.type))),
      outcome: Schema.Union([
        Schema.Struct({ ok: Schema.Literal(true), value: schema(signature.effect.success) }),
        ...failures.map((failure) => Schema.Struct({ ok: Schema.Literal(false), error: failure })),
      ]),
    };
  }),
);

export function effectEvidence() {
  const source = catalog + "\n" + readFileSync(new URL("./summary-effect.forma", import.meta.url), "utf8");
  const result = elaborateEffectProgram(source, { sourceId: "summary-effect.forma" });
  if (!result.ok || !result.check) throw new Error(JSON.stringify(result.diagnostics));
  const operation = result.declarations.find((item) => item.summary.name === "summary");
  const body = (operation?.payload as { body: object }).body;
  const inferred = result.check.effectTypes.get(body);
  if (!inferred) throw new Error("No inferred body effect");
  return { type: showMechanicsType(inferred), errors: [...inferred.errors.keys()],
    requirements: [...inferred.requirements.keys()] };
}

function project(value: unknown): ValueProjection {
  if (value === null) return { kind: "nil" };
  if (typeof value === "string") return { kind: "string", value };
  if (typeof value === "boolean") return { kind: "bool", value };
  if (typeof value === "number" && Number.isFinite(value)) return { kind: Number.isInteger(value) ? "int" : "float", value };
  if (Array.isArray(value)) return { kind: "list", items: value.map(project) };
  throw new Error("Unsupported host projection");
}

export class ExecutionSession {
  #seen = new Map<string, { source: string; result: Promise<ExecutionResult> }>();
  readonly bindings: Bindings;
  readonly allow: ReadonlySet<string>;
  readonly budgets: Budgets;
  constructor(
    bindings: Bindings,
    allow: ReadonlySet<string> = new Set(["Issues.list-open", "Accounts.list-active"]),
    budgets: Budgets = defaults,
  ) {
    this.bindings = { ...bindings };
    this.allow = new Set(allow);
    this.budgets = { ...budgets };
  }

  execute(segment: Executable): Promise<ExecutionResult> {
    const previous = this.#seen.get(segment.invocationId);
    if (previous) {
      if (previous.source !== segment.source) return Promise.reject(new Error("protocol/identity-conflict: source changed"));
      return previous.result;
    }
    const result = this.#run(segment);
    this.#seen.set(segment.invocationId, { source: segment.source, result });
    return result;
  }

  async #run(segment: Executable): Promise<ExecutionResult> {
    const host = new TsLanguageHost();
    const { sessionId } = await host.openSession({ defaultStepLimit: this.budgets.steps });
    const sourceId = `${segment.invocationId}.forma`;
    const calls: { invocationId: string; operation: string; decision: string }[] = [];
    const diagnostic = (code: string, message: string, details?: Record<string, unknown>): Diagnostic => ({
      code, message, severity: "error", phase: "host-effect",
      span: { sourceId, startOffset: 0, endOffset: segment.source.length },
      ...(details ? { details } : {}),
    });
    const fail = (diagnostics: readonly Diagnostic[]): ExecutionResult => ({ invocationId: segment.invocationId, ok: false, diagnostics, calls });
    try {
      if (segment.source.length > this.budgets.source) return fail([diagnostic("limit/source", "Source exceeds budget")]);
      await host.configureSession({ sessionId, hostBuiltins: contracts.map((item) => item.descriptor) });
      const typed = await host.typecheck({ sessionId, sourceId, source: segment.source });
      if (typed.diagnostics.some((item) => item.severity === "error")) return fail(typed.diagnostics);
      let state = await host.evaluateInSession({ sessionId, sourceId, source: segment.source, stepLimit: this.budgets.steps });
      let boundaryFailure: readonly Diagnostic[] | undefined;
      while (state.status === "host-call") {
        const call = state.call;
        const contract = contracts.find((item) => item.name === call.name);
        const implementation = this.bindings[call.name];
        let outcome: Parameters<typeof host.resumeHostCall>[0]["result"];
        let decision = "allowed";
        if (calls.length >= this.budgets.calls) {
          decision = "limit";
          outcome = { ok: false, diagnostics: [diagnostic("limit/host-calls", "Host-call budget exceeded")] };
        } else if (!this.allow.has(call.name)) {
          decision = "denied";
          outcome = { ok: false, diagnostics: [diagnostic("capability/denied", `Operation denied: ${call.name}`)] };
        } else if (!contract || typeof implementation !== "function") {
          decision = "missing-binding";
          outcome = { ok: false, diagnostics: [diagnostic("binding/missing", `No implementation for ${call.name}`)] };
        } else {
          try {
            const args = await Promise.all(call.args.map(async (value) => {
              const projected = await host.projectValue({ sessionId, value, projections: ["plain-json"] });
              if (projected.diagnostics.length) throw new Error("Invalid argument projection");
              return projected.plainJson;
            }));
            const decodedArgs = Schema.decodeUnknownSync(contract.args)(args) as readonly unknown[];
            // No generated JS, imports, credentials, or ambient capabilities.
            const raw = await implementation(...decodedArgs);
            const decoded = Schema.decodeUnknownSync(contract.outcome)(raw) as
              { ok: true; value: unknown } | { ok: false; error: { _tag: string; message: string } };
            if (JSON.stringify(decoded).length > this.budgets.output) {
              decision = "limit";
              outcome = { ok: false, diagnostics: [diagnostic("limit/output", "Host output exceeds budget")] };
            } else if (decoded.ok) {
              outcome = { ok: true, value: project(decoded.value) };
            } else {
              decision = "typed-failure";
              outcome = { ok: false, diagnostics: [diagnostic(`binding/failure/${decoded.error._tag}`,
                decoded.error.message, { error: decoded.error })] };
            }
          } catch {
            decision = "invalid-binding";
            outcome = { ok: false, diagnostics: [diagnostic("binding/invalid", `Binding threw or violated ${call.name}'s contract`)] };
          }
        }
        calls.push({ invocationId: `${segment.invocationId}/call-${calls.length + 1}`, operation: call.name, decision });
        if (!outcome.ok) boundaryFailure = outcome.diagnostics;
        state = await host.resumeHostCall({ sessionId, evaluationId: call.evaluationId, callId: call.callId, result: outcome });
      }
      // This TS snapshot's kernel wrapper can erase diagnostic codes/details on
      // a rejected resume. Keep the host's original checked boundary evidence.
      if (state.status === "failed") return fail(boundaryFailure ?? state.diagnostics.map((item) =>
        item.code === "StepLimitExceeded" && !item.message
          ? { ...item, message: `Evaluation exceeded the ${this.budgets.steps}-step budget` } : item));
      const result = await host.projectValue({ sessionId, value: state.result.value, projections: ["plain-json"] });
      if (result.diagnostics.length) return fail(result.diagnostics);
      if (JSON.stringify(result.plainJson)?.length > this.budgets.output)
        return fail([diagnostic("limit/output", "Result exceeds output budget")]);
      return { invocationId: segment.invocationId, ok: true, ...(typed.display ? { type: typed.display } : {}), value: result.plainJson, diagnostics: [], calls };
    } finally { await host.closeSession({ sessionId }); }
  }
}

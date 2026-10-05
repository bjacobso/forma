import { Effect, Schema as S } from "effect";
import type { ValueProjection, EvaluationState, Diagnostic } from "@formalang/host/types";
import type { ValueTree } from "@foldworks/ui";
type ValueNode = ValueTree.ValueNode;
import { FormaHost, call, configureSession } from "./host.js";
import type { Document } from "./document.js";

/** The host ABI's serializable projections, including retained handles. */
export const Projection: S.Codec<ValueProjection> = S.Union([
  S.Struct({ kind: S.Literal("nil"), valueRef: S.optional(S.String) }),
  S.Struct({ kind: S.Literal("bool"), value: S.Boolean, valueRef: S.optional(S.String) }),
  S.Struct({ kind: S.Literals(["int", "float"]), value: S.Number, valueRef: S.optional(S.String) }),
  S.Struct({ kind: S.Literals(["string", "keyword", "symbol"]), value: S.String, valueRef: S.optional(S.String) }),
  S.Struct({ kind: S.Literals(["list", "vector"]), items: S.Array(S.suspend(() => Projection)), valueRef: S.optional(S.String) }),
  S.Struct({ kind: S.Literal("map"), entries: S.Array(S.Struct({ key: S.suspend(() => Projection), value: S.suspend(() => Projection) })), valueRef: S.optional(S.String) }),
  S.Struct({ kind: S.Literal("function"), valueRef: S.String, display: S.optional(S.String) }),
  S.Struct({ kind: S.Literal("opaque"), tag: S.String, display: S.optional(S.String), valueRef: S.optional(S.String) }),
]);
export const Observed = S.Struct({ count: S.Number, value: S.NullOr(Projection), failure: S.NullOr(S.String) });
export type Observed = typeof Observed.Type;

/** Short previews never include an opaque handle's internal id. */
export const preview = (value: ValueProjection, depth = 0): string => {
  if (depth > 2) return "…";
  switch (value.kind) {
    case "nil": return "nil";
    case "bool": case "int": case "float": return String(value.value);
    case "string": return JSON.stringify(value.value);
    case "keyword": case "symbol": return value.value;
    case "function": return value.display ?? "ƒ";
    case "opaque": return value.display ?? value.tag;
    case "list": case "vector": {
      const parts = value.items.slice(0, 6).map((item) => preview(item, depth + 1));
      if (value.items.length > 6) parts.push("…");
      return `${value.kind === "vector" ? "[" : "("}${parts.join(" ")}${value.kind === "vector" ? "]" : ")"}`;
    }
    case "map": return `{${value.entries.slice(0, 3).map(({ key, value }) => `${preview(key, depth + 1)} ${preview(value, depth + 1)}`).join(", ")}${value.entries.length > 3 ? ", …" : ""}}`;
  }
};

export const ValueNodeSchema: S.Codec<ValueNode> = S.Struct({
  id: S.String, key: S.optionalKey(S.String), preview: S.String, kind: S.optionalKey(S.String),
  children: S.optionalKey(S.Array(S.suspend(() => ValueNodeSchema))),
  expandable: S.optionalKey(S.Boolean), more: S.optionalKey(S.Number),
});

/** A root is deliberately unloaded: expanding it projects its retained handle. */
export const valueRoot = (value: ValueProjection): ValueNode => ({
  id: value.valueRef ?? "value", preview: preview(value), kind: value.kind,
  ...(["list", "vector", "map"].includes(value.kind) ? { expandable: true } : {}),
});

export const valueChildren = (value: ValueProjection, rootId: string): ReadonlyArray<ValueNode> => {
  const node = (value: ValueProjection, id: string, key: string): ValueNode => ({
    id, key, preview: preview(value), kind: value.kind,
    ...(["list", "vector", "map"].includes(value.kind) ? { children: valueChildren(value, id) } : {}),
  });
  if (value.kind === "list" || value.kind === "vector")
    return value.items.map((value, index) => node(value, `${rootId}/${index}`, String(index)));
  if (value.kind === "map")
    return value.entries.map(({ key, value }, index) => node(value, `${rootId}/${index}`, preview(key)));
  return [];
};

/** Isolated sessions prevent removed definitions leaking into the next evaluation. */
export const observeProgram = (document: Document, code: string) => Effect.gen(function* () {
  const { host, config } = yield* FormaHost;
  const { sessionId } = yield* call(() => host.openSession({ defaultStepLimit: config.stepLimit ?? 200_000 }));
  return yield* Effect.gen(function* () {
    yield* call(() => configureSession(host, sessionId, config));
    let state = yield* call(() => host.evaluateInSession({
      sessionId, sourceId: config.sourceId, source: code,
      observe: { identity: document.identity, maxDepth: 2, maxItems: 8 }, retainValues: "all",
    }));
    // Live analysis never executes capabilities. A run owns the approval loop.
    while (state.status === "host-call") {
      const pending = state.call;
      state = yield* call(() => host.resumeHostCall({ sessionId,
        evaluationId: pending.evaluationId, callId: pending.callId,
        result: { ok: false, diagnostics: [{ code: "capability/approval", severity: "info", message: `Requires approval: ${pending.name}`, phase: "evaluate" }] },
      }));
    }
    return { sessionId, state };
  }).pipe(Effect.onError(() => call(() => host.closeSession({ sessionId })).pipe(Effect.ignore)));
});

export const observationsOf = (state: EvaluationState): Readonly<Record<string, Observed>> => {
  const observations = state.status === "completed" ? state.result.observations : state.status === "failed" ? state.observations : undefined;
  return Object.fromEntries((observations?.records ?? []).map((record) => [record.nodeId, {
    count: record.count, value: record.value ?? null, failure: record.failure?.message ?? null,
  }]));
};

export const evaluationDiagnostics = (state: EvaluationState): ReadonlyArray<Diagnostic> =>
  (state.status === "completed" ? state.result.diagnostics : state.status === "failed" ? state.diagnostics : [])
    .filter((diagnostic) => diagnostic.code !== "capability/approval");

import { Command, type Update } from "foldkit";
import { defineMessageUnion } from "foldkit/message";
import { defineView } from "foldkit/submodel";
import { Effect, Schema as S } from "effect";
import { initial, write } from "@formalang/host/inline-code-mode";
import type { TranscriptSegment } from "@formalang/host/inline-code-mode";
import { catalog, evidence, runTranscript } from "./runner";

const Call = S.Struct({ invocationId: S.String, operation: S.String, decision: S.String });
const Entry = S.Struct({
  kind: S.Literals(["prose", "code", "result", "continuation"]),
  id: S.String, text: S.String, ok: S.NullOr(S.Boolean), calls: S.Array(Call),
});
type Entry = typeof Entry.Type;
export const Model = S.Struct({
  text: S.String, streamed: S.String, variant: S.Literals(["primary", "alternate"]),
  allowWrite: S.Boolean, token: S.Number,
  phase: S.Literals(["ready", "streaming", "executing", "complete", "failed"]),
  entries: S.Array(Entry), failure: S.NullOr(S.String),
});
export type Model = typeof Model.Type;
const Message = defineMessageUnion({
  Edit: { text: S.String }, ChooseBindings: { variant: S.Literals(["primary", "alternate"]) },
  ReadExample: {}, WriteExample: {}, ToggleWrite: {}, Run: {}, Reset: {},
  Chunk: { token: S.Number, end: S.Number },
  Finished: { token: S.Number, entries: S.Array(Entry) },
  Failed: { token: S.Number, reason: S.String },
});
type Message = typeof Message.Type;
type Return = Update.Return<Model, Message>;
const busy = (model: Model) => model.phase === "streaming" || model.phase === "executing";

export const init = (): Return => ({ model: {
  text: initial, streamed: "", variant: "primary", allowWrite: false, token: 0,
  phase: "ready", entries: [], failure: null,
} });

const nextChunk = Command.define("PlayCodeModeFixtureChunk", {
  args: { token: S.Number, end: S.Number }, messages: [Message.Chunk],
  execute: ({ token, end }) => Effect.sleep(35).pipe(Effect.as(Message.Chunk({ token, end }))),
});

const entry = (segment: TranscriptSegment): Entry => {
  if (segment.kind === "code") return { kind: "code", id: segment.invocationId, text: segment.source, ok: null, calls: [] };
  if (segment.kind === "result") return {
    kind: "result", id: segment.result.invocationId, ok: segment.result.ok,
    text: segment.result.ok ? JSON.stringify(segment.result.value, null, 2)
      : segment.result.diagnostics.map((item) => `${item.code}: ${item.message}`).join("\n"),
    calls: segment.result.calls,
  };
  return { kind: segment.kind, id: segment.responseId, text: segment.text, ok: null, calls: [] };
};

const execute = Command.define("RunCodeModeTranscript", {
  args: { text: S.String, variant: S.Literals(["primary", "alternate"]), allowWrite: S.Boolean, token: S.Number },
  messages: [Message.Finished, Message.Failed],
  execute: ({ text, variant, allowWrite, token }) => Effect.tryPromise({
    try: () => runTranscript(text, variant, allowWrite, token),
    catch: (error) => error instanceof Error ? error.message : String(error),
  }).pipe(
    Effect.map((segments) => Message.Finished({ token, entries: segments.map(entry) })),
    Effect.catch((reason) => Effect.succeed(Message.Failed({ token, reason }))),
  ),
});

export const update = (model: Model, message: Message): Return => {
  switch (message._tag) {
    case "Edit": return busy(model) ? { model } : { model: { ...model, text: message.text, phase: "ready", failure: null } };
    case "ChooseBindings": return busy(model) ? { model } : { model: { ...model, variant: message.variant, phase: "ready" } };
    case "ToggleWrite": return busy(model) ? { model } : { model: { ...model, allowWrite: !model.allowWrite, phase: "ready" } };
    case "ReadExample": case "WriteExample": return busy(model) ? { model } : {
      model: { ...model, text: message._tag === "ReadExample" ? initial : write, entries: [],
        streamed: "", allowWrite: false, phase: "ready", failure: null },
    };
    case "Reset": return busy(model) ? { model } : { model: { ...init().model, token: model.token + 1 } };
    case "Run": {
      if (busy(model)) return { model };
      const token = model.token + 1;
      return { model: { ...model, token, phase: "streaming", streamed: "", entries: [], failure: null },
        commands: [nextChunk({ token, end: 80 })] };
    }
    case "Chunk": {
      if (message.token !== model.token || model.phase !== "streaming") return { model };
      const streamed = model.text.slice(0, message.end);
      if (message.end < model.text.length) return { model: { ...model, streamed },
        commands: [nextChunk({ token: model.token, end: message.end + 80 })] };
      return { model: { ...model, streamed, phase: "executing" },
        commands: [execute({ text: model.text, variant: model.variant, allowWrite: model.allowWrite, token: model.token })] };
    }
    case "Finished": return message.token !== model.token ? { model } : {
      model: { ...model, phase: message.entries.some((item) => item.ok === false) ? "failed" : "complete", entries: message.entries },
    };
    case "Failed": return message.token !== model.token ? { model } : {
      model: { ...model, phase: "failed", failure: message.reason },
    };
  }
};

export const view = defineView<Model, Message>((model, h) => {
  const disabled = busy(model);
  const status = { ready: "Ready to run", streaming: "Playing fixture chunks…", executing: "Checking and executing…",
    complete: "Run complete", failed: "Run failed" }[model.phase];
  const button = (label: string, message: Message, className = "cm-button") => h.button([
    h.Type("button"), h.Class(className), h.Disabled(disabled), h.OnClick(message),
  ], [label]);
  return h.main([h.Class("cm")], [
    h.header([h.Class("cm-heading")], [
      h.div([], [h.p([h.Class("cm-eyebrow")], ["FORMA LAB / 01"]), h.h1([], ["Lisp, inline." ]),
        h.p([h.Class("cm-intro")], ["A chat response that can do a little work. Prose, executable Forma, a checked result, then a continuation."])]),
      h.div([h.Class("cm-badge")], ["Interactive experiment"]),
    ]),
    h.div([h.Class("cm-grid")], [
      h.section([h.Class("cm-editor"), h.AriaLabel("Response editor")], [
        h.div([h.Class("cm-panel-heading")], [h.div([], [h.h2([], ["Compose a response"]), h.p([], ["Edit the Lisp or load an example."])]),
          h.span([h.Class("cm-step")], ["01"])]),
        h.div([h.Class("cm-toolbar")], [button("Read example", Message.ReadExample()), button("Write example", Message.WriteExample())]),
        h.label([h.For("cm-response"), h.Class("cm-label")], ["Assistant response"]),
        h.textarea([h.Id("cm-response"), h.AriaLabel("Assistant response"), h.Value(model.text), h.Disabled(disabled),
          h.Spellcheck(false), h.OnInput((text) => Message.Edit({ text })), h.Class("cm-source")]),
        h.div([h.Class("cm-editor-note")], [h.code([], ["forma-run"]), " executes after its closing fence. ", h.code([], ["forma"]), " examples stay inert."]),
        h.div([h.Class("cm-bindings")], [h.span([h.Class("cm-label")], ["Runtime bindings"]),
          h.div([h.Class("cm-switch"), h.Role("group"), h.AriaLabel("Runtime bindings")], [
            h.button([h.Type("button"), h.Disabled(disabled), h.AriaPressed(String(model.variant === "primary")),
              h.OnClick(Message.ChooseBindings({ variant: "primary" }))], ["Primary mocks"]),
            h.button([h.Type("button"), h.Disabled(disabled), h.AriaPressed(String(model.variant === "alternate")),
              h.OnClick(Message.ChooseBindings({ variant: "alternate" }))], ["Alternate mocks"]),
          ]), h.p([], [model.variant === "primary" ? "Ada has 2 open issues; Lin has 1." : "Ada has 0 open issues; Lin has 1. The Lisp stays the same."]),
        ]),
        h.div([h.Class("cm-authority")], [
          h.div([], [h.strong([], ["Mock write access"]), h.p([], ["A declaration grants no permission. Reads are allowed; writes start denied."])]),
          h.button([h.Type("button"), h.Class("cm-button"), h.Disabled(disabled), h.AriaPressed(String(model.allowWrite)),
            h.OnClick(Message.ToggleWrite())], [model.allowWrite ? "Revoke mock write" : "Allow mock write"]),
        ]),
        h.div([h.Class("cm-actions")], [button(disabled ? "Running…" : "Run response →", Message.Run(), "cm-button cm-button--primary"),
          button("Reset", Message.Reset()), h.span([h.Class("cm-local")], ["Local mocks · no model or credentials"])]),
      ]),
      h.section([h.Class("cm-transcript"), h.AriaLabel("Execution transcript")], [
        h.div([h.Class("cm-panel-heading")], [h.div([], [h.h2([], ["The conversation"]), h.p([], ["Each continuation follows the actual host result."])]),
          h.span([h.Class("cm-status"), h.Role("status")], [status])]),
        h.div([h.Class("cm-thread"), h.Role("log"), h.AriaLabel("Transcript segments")], [
          ...(model.entries.length === 0 && !disabled && !model.failure ? [h.div([h.Class("cm-empty")], [
            h.span([h.Class("cm-empty-symbol")], ["( )"]), h.h3([], ["From words to work"]),
            h.p([], ["Run the response to see a complete code segment execute, its result arrive, and a fresh continuation follow."]),
            h.div([h.Class("cm-flow")], ["Prose", h.span([], ["→"]), "Forma", h.span([], ["→"]), "Result", h.span([], ["→"]), "Continue"]),
          ])] : []),
          ...(disabled ? [h.article([h.Class("cm-entry")], [h.small([], ["FIXTURE PLAYBACK"]),
            h.pre([h.Class("cm-playback")], [model.streamed || "Waiting for the first chunk…"])])] : []),
          ...model.entries.map((item) => h.article([h.Class(`cm-entry cm-entry--${item.kind}${item.ok === false ? " cm-entry--failed" : ""}`), h.Key(`${item.kind}/${item.id}`)], [
            h.div([h.Class("cm-entry-label")], [h.strong([], [{ prose: "Assistant", code: "Executable Forma", result: item.ok ? "Host result" : "Host refusal", continuation: "Assistant · continuation" }[item.kind]]),
              h.small([], [item.id])]),
            h.pre([], [item.text]),
            ...(item.calls.length ? [h.div([h.Class("cm-calls")], item.calls.map((call) => h.div([], [
              h.code([], [call.operation]), h.span([], [call.decision]),
            ])))] : []),
          ])),
          ...(model.failure ? [h.div([h.Class("cm-error"), h.Role("alert")], [model.failure])] : []),
        ]),
        h.footer([h.Class("cm-thread-note")], ["Deterministic continuation from real results. This demo does not contact an LLM."]),
      ]),
    ]),
    h.details([h.Class("cm-contract")], [h.summary([], ["Inspect the checked Effect contract and execution limits"]),
      h.div([h.Class("cm-contract-grid")], [h.pre([], [catalog.source]), h.div([], [
        h.h3([], ["Inferred companion requirements"]),
        h.p([], [evidence.requirements.join(" + ")]), h.p([], [`Typed failure: ${evidence.errors.join(", ")}`]),
        h.pre([], [evidence.type]),
        h.p([], ["The runnable segment uses kernel Forma. The Effect companion is checked separately; full Effect execution and catchable typed failures remain follow-up work."]),
        h.p([], ["2,000 evaluation steps · 8 calls · 4 KB result budget. Fresh Forma sessions; session-local deduplication. This is an experiment, not a process sandbox."]),
      ])]),
    ]),
  ]);
});

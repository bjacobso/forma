import { Context, Effect, Schema } from "effect";

export const Model = Schema.Struct({
  count: Schema.Int,
  status: Schema.Literals(["idle", "loading", "failed"]),
  reason: Schema.String,
});
export type Model = typeof Model.Type;

export const Msg = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal("Increment") }),
  Schema.Struct({ _tag: Schema.Literal("Decrement") }),
  Schema.Struct({ _tag: Schema.Literal("Load") }),
  Schema.Struct({ _tag: Schema.Literal("GotCount"), count: Schema.Int }),
  Schema.Struct({ _tag: Schema.Literal("LoadFailed"), reason: Schema.String }),
]);
export type Msg = typeof Msg.Type;

export const ElmTransition = Schema.Struct({
  model: Model,
  commands: Schema.Array(Schema.Literal("load-count")),
});
export type ElmTransition = typeof ElmTransition.Type;

export class CounterUnavailable extends Schema.TaggedError<CounterUnavailable>()("CounterUnavailable", {
  reason: Schema.String,
}) {}

export class CounterStore extends Context.Service<
  CounterStore,
  {
    readonly get: () => Effect.Effect<number, CounterUnavailable>;
  }
>()("CounterStore") {}

export const elmUpdate = (model: Model, message: Msg): ElmTransition =>
  message._tag === "Increment"
    ? { model: { ...model, count: model.count + 1 }, commands: [] }
    : message._tag === "Decrement"
      ? { model: { ...model, count: model.count - 1 }, commands: [] }
      : message._tag === "Load"
        ? { model: { ...model, status: "loading" }, commands: ["load-count"] }
        : message._tag === "GotCount"
          ? (() => { const n = message.count; return { model: { ...{ ...model, count: n }, status: "idle" }, commands: [] } satisfies ElmTransition; })()
          : (() => { const reason = message.reason; return {
    model: { ...{ ...model, status: "failed" } satisfies Model, reason },
    commands: [],
  }; })();

export const elmView0 = (_model: Model): string => "counter";

export const elmView1 = (_model: Model): Msg => ({ _tag: "Decrement" });

export const elmView2 = (_model: Model): string => "−";

export const elmView3 = (model: Model): string => `${model.count}`;

export const elmView4 = (_model: Model): Msg => ({ _tag: "Increment" });

export const elmView5 = (_model: Model): string => "+";

export const elmView6 = (_model: Model): Msg => ({ _tag: "Load" });

export const elmView7 = (_model: Model): string => "Load";

export const elmView8 = (model: Model): string => `${model.status} ${model.reason}`;

export const fetchCount: Effect.Effect<number, CounterUnavailable, CounterStore> =
  Effect.gen(function* () {
    const counterStore = yield* CounterStore;
    return yield* counterStore.get();
  });

export const elmCommandLoadCount: Effect.Effect<Msg, never, CounterStore> =
  Effect.gen(function* () {
    return yield* Effect.catchTag(
      Effect.gen(function* () {
        const n = yield* fetchCount;
        return { _tag: "GotCount", count: n } satisfies Msg;
      }),
      "CounterUnavailable",
      (e) => Effect.succeed({ _tag: "LoadFailed", reason: e.reason } satisfies Msg),
    );
  });

export const elmInitial: ElmTransition = { model: { count: 0, status: "idle", reason: "" }, commands: [] } satisfies ElmTransition;
import * as Command from "foldkit/command";
import type { Html, HtmlBuilder } from "foldkit/html";

const elmLoadCount = Command.define("load-count", { "messages": [Msg], "execute": elmCommandLoadCount });

const elmCommands = (names: ElmTransition["commands"]): ReadonlyArray<Command.Command<Msg, never, CounterStore>> => names.map(name => {
  switch (name) {
    case "load-count": return elmLoadCount();
    default: throw new Error("Invalid checked command name");
  }
});

export const init = () => ({ model: elmInitial.model, commands: elmCommands(elmInitial.commands) });
export const update = (model: Model, message: Msg) => {
  const next = elmUpdate(model, message);
  return { model: next.model, commands: elmCommands(next.commands) };
};

export const view = (elmModel: Model, elmHtml: HtmlBuilder<Msg>): Html => elmHtml.div([elmHtml.Class(elmView0(elmModel))], [elmHtml.button([elmHtml.OnClick(elmView1(elmModel)), elmHtml.Type("button")], [elmView2(elmModel)]), elmHtml.span([], [elmView3(elmModel)]), elmHtml.button([elmHtml.OnClick(elmView4(elmModel)), elmHtml.Type("button")], [elmView5(elmModel)]), elmHtml.button([elmHtml.OnClick(elmView6(elmModel)), elmHtml.Type("button")], [elmView7(elmModel)]), elmHtml.span([], [elmView8(elmModel)])]);

export const Counter = { "Model": Model, "init": init, "update": update, "view": view };

import { Schema } from "effect";

const __formaInt = (value: number): number => {
  if (!Number.isSafeInteger(value)) throw new RangeError("Int outside the safe integer range");
  return value === 0 ? 0 : value;
};

export const Model = Schema.Struct({
  count: Schema.Int,
});
export type Model = typeof Model.Type;

export const Msg = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal("Bump") }),
  Schema.Struct({ _tag: Schema.Literal("Reset") }),
]);
export type Msg = typeof Msg.Type;

export const ElmTransition = Schema.Struct({
  model: Model,
});
export type ElmTransition = typeof ElmTransition.Type;

export const elmUpdate = (state: Model, event: Msg): ElmTransition =>
  event._tag === "Bump"
    ? (() => { const next = { model: { ...state, count: __formaInt(state.count + 1) } }; return next; })()
    : state.count === 0 ? { model: state } : { model: { count: 0 } };

export const elmInitial: ElmTransition = { model: { count: 0 } };
import * as Command from "foldkit/command";
import type { Html, HtmlBuilder } from "foldkit/html";


const elmCommands = (): ReadonlyArray<Command.Command<Msg>> => [];

export const init = () => ({ model: elmInitial.model, commands: elmCommands() });
export const update = (model: Model, message: Msg) => {
  const next = elmUpdate(model, message);
  return { model: next.model, commands: elmCommands() };
};

export const view = (_elmModel: Model, elmHtml: HtmlBuilder<Msg>): Html => elmHtml.div([], []);

export const PureCounter = { "Model": Model, "init": init, "update": update, "view": view };

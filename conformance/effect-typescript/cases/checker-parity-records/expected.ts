import { Option, Schema } from "effect";

export const Ev = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal("Placed"), id: Schema.String }),
  Schema.Struct({ _tag: Schema.Literal("Billed"), amount: Schema.Int }),
  Schema.Struct({ _tag: Schema.Literal("Acked"), to: Schema.String }),
]);
export type Ev = typeof Ev.Type;

export const Stage = Schema.Struct({
  note: Schema.optionalKey(Schema.String),
  n: Schema.Int,
});
export type Stage = typeof Stage.Type;

export const Status = Schema.Literals(["ready", "waiting"]);
export type Status = typeof Status.Type;

export const WithStatus = Schema.Struct({
  status: Schema.optionalKey(Status),
});
export type WithStatus = typeof WithStatus.Type;

export const Signal = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("Off") }),
  Schema.Struct({ kind: Schema.Literal("On"), value: Schema.Int }),
]);
export type Signal = typeof Signal.Type;

export const Choice = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal("Has"), note: Schema.optionalKey(Schema.String) }),
  Schema.Struct({ _tag: Schema.Literal("Empty") }),
]);
export type Choice = typeof Choice.Type;

export const events = (id: string, acked: boolean): ReadonlyArray<Ev> => {
  const placed = { _tag: "Placed", id } satisfies Ev;
  return [...([placed, { _tag: "Billed", amount: 37 }] as const), ...(acked ? [{ _tag: "Acked", to: "buyer" } satisfies Ev] : [])];
};

export const copyStage = (stage: Stage): Stage => ({
  ...((option) => Option.isSome(option) ? { note: option.value } : {})(Option.fromUndefinedOr(stage.note)),
  n: 2,
});

export const copyAnonymous = (stage: Stage): { readonly note?: string } => ({
  ...((option) => Option.isSome(option) ? { note: option.value } : {})(Option.fromUndefinedOr(stage.note)),
});

export const fromComputed = (fetch: (arg0: number) => Option.Option<string>): Stage => ({
  ...((option) => Option.isSome(option) ? { note: option.value } : {})(fetch(7)),
  n: 6,
});

export const nestedPlain = (
  note: Option.Option<string>,
): { readonly note?: Option.Option<string> } =>
  ({ note });

export const someStage: Stage = {
  ...((option) => Option.isSome(option) ? { note: option.value } : {})(Option.some("present")),
  n: 3,
};

export const noneStage: Stage = {
  ...((option) => Option.isSome(option) ? { note: option.value } : {})(Option.none()),
  n: 4,
};

export const plainStage: Stage = { note: "plain", n: 5 };

export const ready: WithStatus = {
  ...((option) => Option.isSome(option) ? { status: option.value } : {})(Option.some("ready" as const)),
};

export const signals: ReadonlyArray<Signal> = (() => { const off = { kind: "Off" } satisfies Signal; return [off, { kind: "On", value: 9 }] as const; })();

export const chosen: Choice = {
  _tag: "Has",
  ...((option) => Option.isSome(option) ? { note: option.value } : {})(Option.some("inside union")),
} satisfies Choice;

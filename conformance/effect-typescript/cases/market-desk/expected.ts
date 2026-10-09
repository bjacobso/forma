import { Context, Effect, Layer, Schema } from "effect";

export const AskBody = Schema.Struct({
  question: Schema.String,
});
export type AskBody = typeof AskBody.Type;

export const MarketSnapshot = Schema.Struct({
  symbol: Schema.String,
  changePct: Schema.Number,
});
export type MarketSnapshot = typeof MarketSnapshot.Type;

export const MarketBrief = Schema.Struct({
  headline: Schema.String,
  changePct: Schema.Number,
  summary: Schema.String,
});
export type MarketBrief = typeof MarketBrief.Type;

export class MarketApiError extends Schema.TaggedError<MarketApiError>()("MarketApiError", {
  message: Schema.String,
}) {}

export class MarketHttp extends Context.Service<
  MarketHttp,
  {
    readonly snapshot: Effect.Effect<MarketSnapshot, MarketApiError>;
  }
>()("MarketHttp") {}

export class LanguageModel extends Context.Service<
  LanguageModel,
  {
    readonly generate: (arg0: string, arg1: MarketSnapshot) => Effect.Effect<MarketBrief, MarketApiError>;
  }
>()("LanguageModel") {}

export class MarketFeed extends Context.Service<
  MarketFeed,
  {
    readonly snapshot: Effect.Effect<MarketSnapshot, MarketApiError>;
  }
>()("MarketFeed") {}

export class MarketDesk extends Context.Service<
  MarketDesk,
  {
    readonly brief: (arg0: string) => Effect.Effect<MarketBrief, MarketApiError>;
  }
>()("MarketDesk") {}

export const askMarket = (
  payload: AskBody,
): Effect.Effect<MarketBrief, MarketApiError, LanguageModel | MarketHttp> =>
  Effect.gen(function* () {
    return yield* Effect.provide(
      Effect.gen(function* () {
        const marketDesk = yield* MarketDesk;
        return yield* marketDesk.brief(payload.question);
      }),
      AppLive,
    );
  });

export const MarketFeedLive: Layer.Layer<MarketFeed, never, MarketHttp> = Layer.effect(
  MarketFeed,
  Effect.gen(function* () {
    const marketHttp = yield* MarketHttp;
    return MarketFeed.of({
      snapshot: marketHttp.snapshot,
    });
  }),
);

export const MarketDeskLive: Layer.Layer<MarketDesk, never, LanguageModel | MarketFeed> = Layer.effect(
  MarketDesk,
  Effect.gen(function* () {
    const languageModel = yield* LanguageModel;
    const marketFeed = yield* MarketFeed;
    return MarketDesk.of({
      brief: (question) =>
        Effect.gen(function* () {
          const snapshot = yield* marketFeed.snapshot;
          const brief = yield* languageModel.generate(question, snapshot);
          return brief;
        }),
    });
  }),
);

export const AppLive: Layer.Layer<MarketDesk, never, LanguageModel | MarketHttp> =
  Layer.provide(MarketDeskLive, MarketFeedLive);

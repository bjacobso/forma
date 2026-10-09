// Hand-written HTTP boundary around the generated Forma module (Effect 4).
import { Effect, Layer } from "effect";
import { HttpServer } from "effect/unstable/http";
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/unstable/httpapi";
import { AppLive, AskBody, LanguageModel, MarketApiError, MarketBrief, MarketDesk, MarketHttp } from "./expected.js";

export const Api = HttpApi.make("MarketApi").add(
  HttpApiGroup.make("market").add(
    HttpApiEndpoint.post("ask", "/market/ask", {
      payload: AskBody,
      success: MarketBrief,
      error: MarketApiError.pipe(HttpApiSchema.status(502)),
    }),
  ),
);

export const MarketHandlers = HttpApiBuilder.group(Api, "market", (handlers) =>
  Effect.gen(function* () {
    const desk = yield* MarketDesk;
    return handlers.handle("ask", ({ payload }) => desk.brief(payload.question));
  }),
);

export const makeMarketApi = (adapters: Layer.Layer<MarketHttp | LanguageModel>) =>
  HttpApiBuilder.layer(Api).pipe(
    Layer.provide(MarketHandlers),
    Layer.provide(AppLive),
    Layer.provide(adapters),
    Layer.provide(HttpServer.layerServices),
  );

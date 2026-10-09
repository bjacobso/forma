import assert from "node:assert/strict";
import { Effect, Layer } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { askMarket, LanguageModel, MarketApiError, MarketHttp, type MarketSnapshot } from "./expected.js";
import { makeMarketApi } from "./http.js";

export default async function check(): Promise<void> {
  const snapshot: MarketSnapshot = { symbol: "FORMA", changePct: 1.25 };
  const calls: string[] = [];
  const feed = Layer.succeed(MarketHttp, MarketHttp.of({
    snapshot: Effect.sync(() => { calls.push("snapshot"); return snapshot; }),
  }));
  const model = Layer.succeed(LanguageModel, LanguageModel.of({
    generate: (question, market) => Effect.sync(() => {
      calls.push("model");
      assert.equal(question, "What moved today?");
      assert.deepEqual(market, snapshot);
      return { headline: `${market.symbol} update`, changePct: market.changePct, summary: question };
    }),
  }));
  const payload = { question: "What moved today?" };
  const brief = await Effect.runPromise(askMarket(payload).pipe(Effect.provide(Layer.mergeAll(feed, model))));
  assert.deepEqual(brief, { headline: "FORMA update", changePct: 1.25, summary: payload.question });
  assert.deepEqual(calls, ["snapshot", "model"]);

  const feedFailure = new MarketApiError({ message: "market feed unavailable" });
  const failingFeed = Layer.succeed(MarketHttp, MarketHttp.of({ snapshot: Effect.fail(feedFailure) }));
  calls.length = 0;
  const failure = await Effect.runPromise(askMarket(payload).pipe(
    Effect.provide(Layer.mergeAll(failingFeed, model)), Effect.flip,
  ));
  assert.equal(failure, feedFailure);
  assert.deepEqual(calls, []);

  const modelFailure = new MarketApiError({ message: "model unavailable" });
  const failingModel = Layer.succeed(LanguageModel, LanguageModel.of({
    generate: () => Effect.fail(modelFailure),
  }));
  const failedBrief = await Effect.runPromise(askMarket(payload).pipe(
    Effect.provide(Layer.mergeAll(feed, failingModel)), Effect.flip,
  ));
  assert.equal(failedBrief, modelFailure);

  const http = HttpRouter.toWebHandler(makeMarketApi(Layer.mergeAll(feed, model)), { disableLogger: true });
  try {
    calls.length = 0;
    const response = await http.handler(new Request("http://localhost/market/ask", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
    }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), brief);
    assert.deepEqual(calls, ["snapshot", "model"]);

    calls.length = 0;
    const invalid = await http.handler(new Request("http://localhost/market/ask", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: 42 }),
    }));
    assert.equal(invalid.status, 400);
    assert.deepEqual(calls, []);
  } finally {
    await http.dispose();
  }

  const failedHttp = HttpRouter.toWebHandler(makeMarketApi(Layer.mergeAll(failingFeed, model)), { disableLogger: true });
  try {
    const response = await failedHttp.handler(new Request("http://localhost/market/ask", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
    }));
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { _tag: "MarketApiError", message: feedFailure.message });
  } finally {
    await failedHttp.dispose();
  }
}

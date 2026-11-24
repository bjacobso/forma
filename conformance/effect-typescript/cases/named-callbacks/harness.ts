import assert from "node:assert/strict";
import { Effect, Layer, Option } from "effect";
import { Catalog, priceAll, priceAllConcurrently, shoutAll, UnknownSku } from "./expected.js";

const CatalogTest = Layer.succeed(
  Catalog,
  Catalog.of({ price: (sku) => Effect.succeed(sku.startsWith("BEAN") ? Option.some(sku.length * 100) : Option.none()) }),
);

export default async function check(): Promise<void> {
  assert.deepEqual(await Effect.runPromise(Effect.provide(priceAll(["BEAN-1", "BEAN-22"]), CatalogTest)), [600, 700]);
  assert.deepEqual(await Effect.runPromise(Effect.provide(priceAllConcurrently(["BEAN-1", "BEAN-2"]), CatalogTest)), [600, 600]);
  const unknown = await Effect.runPromise(Effect.flip(Effect.provide(priceAll(["BEAN-1", "GEAR-1"]), CatalogTest)));
  assert.ok(unknown instanceof UnknownSku);
  assert.equal(unknown.sku, "GEAR-1");
  assert.deepEqual(await Effect.runPromise(shoutAll(["a", "b"])), ["a!", "b!"]);
}

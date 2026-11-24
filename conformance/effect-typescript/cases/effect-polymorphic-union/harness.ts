import assert from "node:assert/strict";
import { Effect, Layer } from "effect";
import { both, Cache, constants, NotFound, storeAndConstant, Store, Timeout } from "./expected.js";

const StoreTest = Layer.succeed(
  Store,
  Store.of({ get: (key) => (key === "missing" ? Effect.fail(new NotFound({ key })) : Effect.succeed(`stored ${key}`)) }),
);
const CacheTest = Layer.succeed(
  Cache,
  Cache.of({ peek: (key) => (key === "cold" ? Effect.fail(new Timeout()) : Effect.succeed(`cached ${key}`)) }),
);

// Each instantiation lists exactly what its callbacks bring.
const bothIsClosed: (key: string) => Effect.Effect<string, NotFound | Timeout, Store | Cache> = both;
const oneIsClosed: (key: string) => Effect.Effect<string, NotFound, Store> = storeAndConstant;
const noneIsClosed: (key: string) => Effect.Effect<string> = constants;
void bothIsClosed;
void oneIsClosed;
void noneIsClosed;

export default async function check(): Promise<void> {
  const layers = Layer.mergeAll(StoreTest, CacheTest);
  assert.equal(await Effect.runPromise(Effect.provide(both("a"), layers)), "stored a");
  assert.ok((await Effect.runPromise(Effect.flip(Effect.provide(both("missing"), layers)))) instanceof NotFound);
  assert.ok((await Effect.runPromise(Effect.flip(Effect.provide(both("cold"), layers)))) instanceof Timeout);

  assert.equal(await Effect.runPromise(Effect.provide(storeAndConstant("b"), StoreTest)), "stored b");
  assert.equal(await Effect.runPromise(constants("c")), "const-c");
}

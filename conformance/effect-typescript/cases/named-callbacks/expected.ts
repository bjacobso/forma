import { Context, Effect, Option, Schema } from "effect";

export class UnknownSku extends Schema.TaggedError<UnknownSku>()("UnknownSku", {
  sku: Schema.String,
}) {}

export class Catalog extends Context.Service<
  Catalog,
  {
    readonly price: (arg0: string) => Effect.Effect<Option.Option<number>>;
  }
>()("Catalog") {}

export const priceLine = (sku: string): Effect.Effect<number, UnknownSku, Catalog> =>
  Effect.gen(function* () {
    const catalog = yield* Catalog;
    const found = yield* catalog.price(sku);
    if (Option.isSome(found)) {
      const cents = found.value;
      return cents;
    } else {
      return yield* Effect.fail(new UnknownSku({ sku }));
    }
  });

export const priceAll = (
  skus: ReadonlyArray<string>,
): Effect.Effect<ReadonlyArray<number>, UnknownSku, Catalog> =>
  Effect.gen(function* () {
    return yield* Effect.forEach(skus, priceLine);
  });

export const priceAllConcurrently = (
  skus: ReadonlyArray<string>,
): Effect.Effect<ReadonlyArray<number>, UnknownSku, Catalog> =>
  Effect.gen(function* () {
    return yield* Effect.forEach(skus, priceLine, { concurrency: 2 });
  });

export const shout = (word: string): Effect.Effect<string> =>
  Effect.gen(function* () {
    return `${word}!`;
  });

export const shoutAll = (words: ReadonlyArray<string>): Effect.Effect<ReadonlyArray<string>> =>
  Effect.gen(function* () {
    return yield* Effect.forEach(words, shout);
  });

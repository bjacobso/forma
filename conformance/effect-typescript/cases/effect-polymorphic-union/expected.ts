import { Context, Effect, Schema } from "effect";

export class NotFound extends Schema.TaggedError<NotFound>()("NotFound", {
  key: Schema.String,
}) {}

export class Timeout extends Schema.TaggedError<Timeout>()("Timeout", {}) {}

export class Store extends Context.Service<
  Store,
  {
    readonly get: (arg0: string) => Effect.Effect<string, NotFound>;
  }
>()("Store") {}

export class Cache extends Context.Service<
  Cache,
  {
    readonly peek: (arg0: string) => Effect.Effect<string, Timeout>;
  }
>()("Cache") {}

export const fromStore = (key: string): Effect.Effect<string, NotFound, Store> =>
  Effect.gen(function* () {
    const store = yield* Store;
    return yield* store.get(key);
  });

export const fromCache = (key: string): Effect.Effect<string, Timeout, Cache> =>
  Effect.gen(function* () {
    const cache = yield* Cache;
    return yield* cache.peek(key);
  });

export const constant = (key: string): Effect.Effect<string> =>
  Effect.gen(function* () {
    return `const-${key}`;
  });

export const firstOf = <A0, E1, E2, R1, R2>(
  left: (arg0: string) => Effect.Effect<A0, E1, R1>,
  right: (arg0: string) => Effect.Effect<A0, E2, R2>,
  key: string,
): Effect.Effect<A0, E1 | E2, R1 | R2> =>
  Effect.gen(function* () {
    const l = yield* left(key);
    yield* right(key);
    return l;
  });

export const both = (key: string): Effect.Effect<string, NotFound | Timeout, Cache | Store> =>
  Effect.gen(function* () {
    return yield* firstOf(fromStore, fromCache, key);
  });

export const storeAndConstant = (key: string): Effect.Effect<string, NotFound, Store> =>
  Effect.gen(function* () {
    return yield* firstOf(fromStore, constant, key);
  });

export const constants = (key: string): Effect.Effect<string> =>
  Effect.gen(function* () {
    return yield* firstOf(constant, constant, key);
  });

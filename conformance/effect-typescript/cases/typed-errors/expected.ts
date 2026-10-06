import { Context, Effect, Option, Result, Schema } from "effect";

export class NotFound extends Schema.TaggedError<NotFound>()("NotFound", {
  key: Schema.String,
}) {}

export class Forbidden extends Schema.TaggedError<Forbidden>()("Forbidden", {
  user: Schema.String,
}) {}

export class RateLimited extends Schema.TaggedError<RateLimited>()("RateLimited", {
  "retry-after": Schema.Int,
}) {}

export class StorageError extends Schema.TaggedError<StorageError>()("StorageError", {
  detail: Schema.String,
}) {}

export class Storage extends Context.Service<
  Storage,
  {
    readonly read: (arg0: string, arg1: string) => Effect.Effect<string, NotFound | Forbidden | RateLimited>;
  }
>()("Storage") {}

export const readOrExplain = (
  user: string,
  key: string,
): Effect.Effect<string, RateLimited, Storage> =>
  Effect.gen(function* () {
    const storage = yield* Storage;
    return yield* Effect.catchTags(storage.read(user, key), {
      NotFound: (missing) => Effect.succeed(`no ${missing.key}`),
      Forbidden: (denied) => Effect.succeed(`${denied.user} may not read ${key}`),
    });
  });

export const readAnything = (user: string, key: string): Effect.Effect<string, never, Storage> =>
  Effect.gen(function* () {
    const storage = yield* Storage;
    return yield* Effect.catch(storage.read(user, key), (error) => Effect.succeed(`failed with ${error._tag}`));
  });

export const readWrapped = (
  user: string,
  key: string,
): Effect.Effect<string, StorageError, Storage> =>
  Effect.gen(function* () {
    const storage = yield* Storage;
    return yield* Effect.mapError(
      storage.read(user, key),
      (_error) => new StorageError({ detail: `read ${key} failed` }),
    );
  });

export const readWithDefault = (user: string, key: string): Effect.Effect<string, never, Storage> =>
  Effect.gen(function* () {
    const storage = yield* Storage;
    return yield* Effect.orElseSucceed(storage.read(user, key), (): string => "default");
  });

export const readOption = (
  user: string,
  key: string,
): Effect.Effect<Option.Option<string>, never, Storage> =>
  Effect.gen(function* () {
    const storage = yield* Storage;
    return yield* Effect.option(storage.read(user, key));
  });

export const describeRead = (user: string, key: string): Effect.Effect<string, never, Storage> =>
  Effect.gen(function* () {
    const storage = yield* Storage;
    const outcome = yield* Effect.result(storage.read(user, key));
    if (Result.isSuccess(outcome)) {
      const value = outcome.success;
      return `ok: ${value}`;
    } else {
      const error = outcome.failure;
      return `error: ${error._tag}`;
    }
  });

export const readOrDie = (user: string, key: string): Effect.Effect<string, never, Storage> =>
  Effect.gen(function* () {
    const storage = yield* Storage;
    return yield* Effect.orDie(storage.read(user, key));
  });

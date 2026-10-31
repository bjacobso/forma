import { Context, Effect, Layer, Ref, Schema } from "effect";

export class NotFound extends Schema.TaggedError<NotFound>()("NotFound", {
  key: Schema.String,
}) {}

export class Store extends Context.Service<
  Store,
  {
    readonly get: (arg0: string) => Effect.Effect<string, NotFound>;
    readonly set: (arg0: string, arg1: string) => Effect.Effect<void>;
  }
>()("Store") {}

export class Audit extends Context.Service<
  Audit,
  {
    readonly record: (arg0: string) => Effect.Effect<void>;
  }
>()("Audit") {}

export const saveUser = (name: string): Effect.Effect<string, NotFound, Store> =>
  Effect.gen(function* () {
    const store = yield* Store;
    yield* store.set("user", name);
    return yield* store.get("user");
  });

export const audited = (entry: string): Effect.Effect<void, never, Audit> =>
  Effect.gen(function* () {
    const audit = yield* Audit;
    return yield* audit.record(entry);
  });

export const recordedWrites = (name: string): Effect.Effect<ReadonlyArray<string>, NotFound> =>
  Effect.gen(function* () {
    const writes = yield* Ref.make<ReadonlyArray<string>>([]);
    yield* Effect.provide(saveUser(name), Layer.succeed(Store, Store.of({
      get: (_key) => Effect.succeed(name),
      set: (_key, value) => Ref.update(writes, (xs) => [...xs, value]),
    })));
    return yield* Ref.get(writes);
  });

export const layered = (fallback: string): Effect.Effect<ReadonlyArray<string>, NotFound> =>
  Effect.gen(function* () {
    return yield* Effect.provide(
      Effect.gen(function* () {
        const store = yield* Store;
        const outer = yield* store.get("a");
        const inner = yield* Effect.provide(
          Effect.gen(function* () {
            const storeService = yield* Store;
            return yield* storeService.get("b");
          }),
          Layer.succeed(Store, Store.of({
            get: (key) => Effect.succeed(`inner ${key}`),
            set: (_key, _value) => Effect.void,
          })),
        );
        return [outer, inner];
      }),
      Layer.succeed(Store, Store.of({
        get: (key) => Effect.succeed(`${fallback} ${key}`),
        set: (_key, _value) => Effect.void,
      })),
    );
  });

export const lookup = (key: string): Effect.Effect<string> =>
  Effect.gen(function* () {
    return yield* Effect.catchTag(
      Effect.gen(function* () {
        const store = yield* Store;
        return yield* store.get(key);
      }).pipe(Effect.provide(Layer.succeed(Store, Store.of({
        get: (missing) => Effect.fail(new NotFound({ key: missing })),
        set: (_k, _v) => Effect.void,
      })))),
      "NotFound",
      (error) => Effect.succeed(`missing ${error.key}`),
    );
  });

export const forwardReads = (name: string): Effect.Effect<string, NotFound, Audit | Store> =>
  Effect.gen(function* () {
    const audit = yield* Audit;
    const store = yield* Store;
    return yield* Effect.provide(saveUser(name), Layer.succeed(
      Store,
      Store.of({ ...store, set: (key, value) => audit.record(`${key}=${value}`) }),
    ));
  });

export const auditedWrites = (name: string): Effect.Effect<string, NotFound, Audit> =>
  Effect.gen(function* () {
    return yield* Effect.provide(saveUser(name), Layer.effect(Store, Effect.gen(function* () {
      const context = yield* Effect.context<Audit>();
      return Store.of({
        get: (_key) => Effect.succeed(name),
        set: (key, value) => Effect.provideContext(audited(`audited ${key}=${value}`), context),
      });
    })));
  });

export const stacked = (name: string): Effect.Effect<ReadonlyArray<string>, NotFound> =>
  Effect.gen(function* () {
    const entries = yield* Ref.make<ReadonlyArray<string>>([]);
    yield* Effect.provide(
      Effect.gen(function* () {
        const audit = yield* Audit;
        return yield* Effect.provide(saveUser(name), Layer.succeed(Store, Store.of({
          get: (_key) => Effect.succeed(name),
          set: (key, value) => audit.record(`${key}=${value}`),
        })));
      }),
      Layer.succeed(
        Audit,
        Audit.of({ record: (entry) => Ref.update(entries, (xs) => [...xs, entry]) }),
      ),
    );
    return yield* Ref.get(entries);
  });

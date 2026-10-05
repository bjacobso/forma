import { Context, Effect, Layer, Option, Record, Schema } from "effect";

export const Role = Schema.Literals(["admin", "member"]);
export type Role = typeof Role.Type;

export const Member = Schema.Struct({
  name: Schema.String,
  role: Role,
});
export type Member = typeof Member.Type;

export class NotFound extends Schema.TaggedError<NotFound>()("NotFound", {
  key: Schema.String,
}) {}

export class Forbidden extends Schema.TaggedError<Forbidden>()("Forbidden", {
  user: Schema.String,
}) {}

export class Store extends Context.Service<
  Store,
  {
    readonly read: (key: string) => Effect.Effect<string, NotFound | Forbidden>;
    readonly save: (member: Member) => Effect.Effect<void>;
  }
>()("Store") {}

export class Clock extends Context.Service<
  Clock,
  {
    readonly now: () => Effect.Effect<number>;
  }
>()("Clock") {}

export class Greeter extends Context.Service<
  Greeter,
  {
    readonly greet: (name: string) => Effect.Effect<string>;
  }
>()("Greeter") {}

export const negNeg = (x: number): number => -(-x);

export const priceTag = (amount: string): string => `cost: \${amount} \`${amount}\``;

export const resetKey = (
  counts: { readonly [key: string]: number },
  key: string,
): { readonly [key: string]: number } =>
  ({ ...Record.remove(counts, key), [key]: 0 });

export const lookup = (
  counts: { readonly [key: string]: number },
  key: string,
): Option.Option<number> =>
  Record.get(counts, key);

export const rebound = (x: number): number => {
  const x2 = x + 1;
  const x3 = x2 * 10;
  return x3;
};

export const shoutAll = (names: ReadonlyArray<string>): ReadonlyArray<string> =>
  names.map((value) => value.toUpperCase());

export const statusText = (code: number): string =>
  code === 200 ? "ok" : code === 404 ? "missing" : "other";

export const yesNo = (flag: boolean): string => flag === true ? "yes" : "no";

export const invite = (name: string): Effect.Effect<Member, never, Store> =>
  Effect.gen(function* () {
    const store = yield* Store;
    const member = { name, role: "member" } satisfies Member;
    yield* store.save(member);
    return member;
  });

export const explain = (key: string): Effect.Effect<string, never, Store> =>
  Effect.gen(function* () {
    const store = yield* Store;
    return yield* Effect.catch(
      store.read(key),
      (error) => Effect.succeed(error._tag === "NotFound" ? `missing ${error.key}` : `denied ${error.user}`),
    );
  });

export const exclaim = (key: string): Effect.Effect<string, NotFound | Forbidden, Store> =>
  Effect.gen(function* () {
    const store = yield* Store;
    const value = yield* store.read(key);
    const value2 = `${value}!`;
    return value2;
  });

export const stamp = (name: string): Effect.Effect<string, never, Clock> =>
  Effect.gen(function* () {
    const clock = yield* Clock;
    const time = yield* clock.now();
    return `${name}@${time}`;
  });

export const negLiteral: number = -(-1);

export const answer: number = negNeg(42);

export const ClockFixed: Layer.Layer<Clock> = Layer.succeed(
  Clock,
  Clock.of({
    now: () => Effect.succeed(7),
  }),
);

export const GreeterLive: Layer.Layer<Greeter> = Layer.succeed(
  Greeter,
  Greeter.of({
    greet: (name) => Effect.provide(stamp(name), ClockFixed),
  }),
);

import { Context, Effect, Layer, Option, Record, Schema, Stream } from "effect";

export const Role = Schema.Literals(["admin", "member"]);
export type Role = typeof Role.Type;

export const Member = Schema.Struct({
  name: Schema.String,
  role: Role,
});
export type Member = typeof Member.Type;

export const Shape = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("circle"), radius: Schema.Number }),
  Schema.Struct({ kind: Schema.Literal("square"), side: Schema.Number }),
]);
export type Shape = typeof Shape.Type;

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

export const yesNo = (flag: boolean): string => flag ? "yes" : "no";

export const roles = (): ReadonlyArray<Role> => {
  const rs = ["admin", "member"] as const;
  return rs;
};

export const byName = (
  members: { readonly [key: string]: Member },
): { readonly [key: string]: Member } => {
  const next = { ...members, ["b"]: { name: "b", role: "member" } satisfies Member };
  return next;
};

export const lowerAll = (names: ReadonlyArray<string>): ReadonlyArray<string> => {
  const f = (value: string) => value.toLowerCase();
  return names.map(f);
};

export const scale = (x: number): number => x * factor;

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

export const defaultRole = (): Effect.Effect<Role> =>
  Effect.gen(function* () {
    return "admin" as const;
  });

export const circles = (radii: ReadonlyArray<number>): Effect.Effect<ReadonlyArray<Shape>> =>
  Effect.gen(function* () {
    return yield* Effect.forEach(radii, (r) => Effect.gen(function* () {
      if (r > 1) {
        return { kind: "circle", radius: r } satisfies Shape;
      } else {
        return { kind: "square", side: r } satisfies Shape;
      }
    }));
  });

export const pair = (): Effect.Effect<readonly [Shape, Role]> =>
  Effect.gen(function* () {
    return yield* Effect.all([
      Effect.succeed({ kind: "circle", radius: 1 } satisfies Shape),
      Effect.succeed("member" as const),
    ]);
  });

export const largest = (sizes: ReadonlyArray<number>): Effect.Effect<Shape> =>
  Effect.gen(function* () {
    return yield* Stream.runFold(
      Stream.fromIterable(sizes),
      (): Shape => ({ kind: "square", side: 0 }),
      (_acc, size) => ({ kind: "circle", radius: size } satisfies Shape),
    );
  });

export const negLiteral: number = -(-1);

export const answer: number = negNeg(42);

export const factor: number = 2;

export const scaled: number = scale(3);

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

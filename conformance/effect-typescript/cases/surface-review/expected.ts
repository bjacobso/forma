import { Context, Effect, Layer, Option, Schema } from "effect";

export const Shape = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal("Circle"), value: Schema.Int }),
  Schema.Struct({ _tag: Schema.Literal("None") }),
]);
export type Shape = typeof Shape.Type;

export const Other = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal("Circle"), value: Schema.String }),
  Schema.Struct({ _tag: Schema.Literal("Empty") }),
]);
export type Other = typeof Other.Type;

export const Role = Schema.Literals(["admin", "member"]);
export type Role = typeof Role.Type;

export const Roles = Schema.Record(Role, Schema.optionalKey(Schema.Int));
export type Roles = typeof Roles.Type;

export const MaybeName = Schema.Option(Schema.String);
export type MaybeName = typeof MaybeName.Type;

export class FirstError extends Schema.TaggedError<FirstError>()("FirstError", {}) {}

export class SecondError extends Schema.TaggedError<SecondError>()("SecondError", {}) {}

export class Counter extends Context.Service<
  Counter,
  {
    readonly next: Effect.Effect<number>;
  }
>()("Counter") {}

export const radius = (shape: Shape): number =>
  shape._tag === "Circle" ? (() => { const value = shape.value; return value; })() : 0;

export const circle: Effect.Effect<Shape> =
  Effect.gen(function* () {
    return { _tag: "Circle", value: 7 } satisfies Shape;
  });

export const recover = (first: boolean): Effect.Effect<string> =>
  Effect.gen(function* () {
    return yield* Effect.catch(
      Effect.gen(function* () {
        if (first) {
          return yield* Effect.fail(new FirstError({}));
        } else {
          return yield* Effect.fail(new SecondError({}));
        }
      }),
      (error) => {
        switch (error._tag) {
          case "FirstError": {
            return Effect.succeed("first");
          }
          default: {
            return Effect.succeed("fallback");
          }
        }
      },
    );
  });

export const handlerError: Effect.Effect<string, SecondError> =
  Effect.gen(function* () {
    return yield* Effect.catch(
      Effect.gen(function* () {
        if (true) {
          return yield* Effect.fail(new FirstError({}));
        } else {
          return yield* Effect.fail(new SecondError({}));
        }
      }),
      (error) => {
        switch (error._tag) {
          case "FirstError": {
            return Effect.fail(new SecondError({}));
          }
          default: {
            return Effect.succeed("fallback");
          }
        }
      },
    );
  });

export const roles: Roles = { admin: 1 };

export const other: Other = { _tag: "Circle", value: "x" } satisfies Other;

export const missing: Option.Option<number> = Option.none();

export const CounterLive: Layer.Layer<Counter> = Layer.effect(
  Counter,
  Effect.gen(function* () {
    const cfg = { inner: { port: 8 } };
    return Counter.of({
      next:
        Effect.gen(function* () {
          const base = () => 1;
          return base() + cfg.inner.port;
        }),
    });
  }),
);

import { Context, Effect, Schema } from "effect";

export class ConsoleUnavailable extends Schema.TaggedError<ConsoleUnavailable>()("ConsoleUnavailable", {
  message: Schema.String,
}) {}

export class Console extends Context.Service<
  Console,
  {
    readonly print: (arg0: string) => Effect.Effect<void, ConsoleUnavailable>;
  }
>()("Console") {}

export const alwaysFail = (message: string): Effect.Effect<void, ConsoleUnavailable> =>
  Effect.gen(function* () {
    return yield* Effect.fail(new ConsoleUnavailable({ message }));
  });

export const recover = (message: string): Effect.Effect<void> =>
  Effect.gen(function* () {
    return yield* Effect.catchTag(alwaysFail(message), "ConsoleUnavailable", () => Effect.void);
  });

export const log = (message: string): Effect.Effect<void, ConsoleUnavailable, Console> =>
  Effect.gen(function* () {
    const consoleService = yield* Console;
    yield* consoleService.print(message);
    return;
  });

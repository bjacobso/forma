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

export const log = (message: string): Effect.Effect<void, ConsoleUnavailable, Console> =>
  Effect.gen(function* () {
    const consoleService = yield* Console;
    yield* consoleService.print(message);
    return;
  });

import { Context, Effect } from "effect";

export interface ConsoleUnavailable {
  readonly _tag: "ConsoleUnavailable";
  readonly message: string;
}

export class Console extends Context.Service<
  Console,
  {
    readonly print: (message: string) => Effect.Effect<void, ConsoleUnavailable>;
  }
>()("Console") {}

export const log = (message: string): Effect.Effect<void, ConsoleUnavailable, Console> =>
  Effect.gen(function* () {
    const console = yield* Console;
    yield* console.print(message);
    return null;
  });

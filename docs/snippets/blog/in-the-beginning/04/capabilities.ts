import { Context, Effect } from "effect";

// #region output
// A capability: something the host can do for a program. The
// interpreter asks for it; the host decides what it does.
export class Output extends Context.Service<
  Output,
  { readonly print: (line: string) => Effect.Effect<void> }
>()("Output") {}

export const consoleOutput = {
  print: (line: string) => Effect.sync(() => console.log(line)),
};

// For tests and sandboxes: remember the lines instead.
export const recordedOutput = () => {
  const lines: string[] = [];
  const print = (line: string) =>
    Effect.sync(() => {
      lines.push(line);
    });
  return { lines, output: { print } };
};
// #endregion output

import { Effect } from "effect";
import {
  consoleOutput,
  Output,
  recordedOutput,
} from "./capabilities.ts";
import { run } from "./run.ts";

// #region worlds
// One program, described once. Nothing prints until it runs.
const program = run("(+ (print 1) (print 2))");

// Run it in the real world: 1 and 2 go to the console.
export const loud = program.pipe(
  Effect.provideService(Output, consoleOutput),
);

// Run it in a test world: 1 and 2 go into an array.
export const quiet = () => {
  const { lines, output } = recordedOutput();
  const result = Effect.runSync(
    program.pipe(Effect.provideService(Output, output)),
  );
  return { result, lines };
};
// #endregion worlds

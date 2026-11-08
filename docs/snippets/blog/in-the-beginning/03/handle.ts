import { Effect } from "effect";
import { type Primitive, standard, type Value } from "./environment.ts";
import { run } from "./run.ts";

// #region recover
// This host decides that dividing by zero gives Infinity. The error
// type of `lenient` no longer mentions DivByZero.
export const lenient = (source: string) =>
  run(source).pipe(
    Effect.catchTag("DivByZero", () =>
      Effect.succeed<Value>(Infinity),
    ),
  );
// #endregion recover

// #region defect
// A primitive with a bug: it throws instead of failing.
const oops: Primitive = {
  _tag: "Primitive",
  name: "oops",
  apply: () =>
    Effect.sync(() => {
      throw new Error("index out of range");
    }),
};
export const buggy = new Map(standard).set("oops", oops);
// #endregion defect

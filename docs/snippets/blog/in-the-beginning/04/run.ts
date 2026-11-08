import { Effect } from "effect";
import { type Diagnostic, render } from "../02/read.ts";
import type { Output } from "./capabilities.ts";
import type { EvalError } from "./errors.ts";
import { evaluate } from "./evaluate.ts";
import { parse } from "./expr.ts";
import { globals, type Value } from "./scope.ts";

// #region run
export type Failure = Diagnostic | EvalError;

// Programs start in the global scope. Output is still required: the
// host hasn't said where printing goes.
export const run = (
  source: string,
  evaluator = evaluate,
): Effect.Effect<Value, Failure, Output> =>
  parse(source).pipe(
    Effect.flatMap((expr) => evaluator(expr, globals)),
  );

export const report = (source: string, error: Failure) =>
  render(source, { message: error.message, span: error.span });
// #endregion run

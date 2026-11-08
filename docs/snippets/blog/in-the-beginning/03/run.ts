import { Effect } from "effect";
import { parse } from "../02/expr.ts";
import { type Diagnostic, render } from "../02/read.ts";
import { Environment, standard, type Value } from "./environment.ts";
import type { EvalError } from "./errors.ts";
import { evaluate } from "./evaluate.ts";

// #region run
// Parse, evaluate, and provide the environment. What's left in the
// error channel is everything that can go wrong, by name.
export type Failure = Diagnostic | EvalError;

export const run = (
  source: string,
  environment: ReadonlyMap<string, Value> = standard,
): Effect.Effect<Value, Failure> =>
  parse(source).pipe(
    Effect.flatMap(evaluate),
    Effect.provideService(Environment, environment),
  );

// Parse errors and runtime errors share one display.
export const report = (source: string, error: Failure) =>
  render(source, { message: error.message, span: error.span });
// #endregion run

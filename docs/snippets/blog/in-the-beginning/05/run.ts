import { Effect } from "effect";
import { type Diagnostic, render } from "../02/read.ts";
import type { Output } from "../04/capabilities.ts";
import type { EvalError } from "../04/errors.ts";
import { evaluate } from "../04/evaluate.ts";
import { parse } from "../04/expr.ts";
import { globals, type Value } from "../04/scope.ts";
import { check } from "./check.ts";
import type { CheckError } from "./errors.ts";
import { showType } from "./types.ts";

// #region run
export type Failure = Diagnostic | CheckError | EvalError;

// Parse, then check, then run. A program that fails to check never
// starts, so it can't print anything.
export const run = (
  source: string,
): Effect.Effect<Value, Failure, Output> =>
  parse(source).pipe(
    Effect.tap(check),
    Effect.flatMap((expr) => evaluate(expr, globals)),
  );

// The type of a program, without running it.
export const typeOf = (source: string) =>
  parse(source).pipe(Effect.flatMap(check), Effect.map(showType));

export const report = (source: string, error: Failure) =>
  render(source, { message: error.message, span: error.span });
// #endregion run

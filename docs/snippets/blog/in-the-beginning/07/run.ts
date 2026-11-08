import { Effect, Schema } from "effect";
import { render } from "../02/read.ts";
import { show } from "../02/sexp.ts";
import type { Output } from "../04/capabilities.ts";
import { diagnose, ExprFromSexp } from "../04/expr.ts";
import { elaborate } from "../06/elaborate.ts";
import { execute, type Value } from "../06/execute.ts";
import type { Failure } from "../06/run.ts";
import { expandWith } from "./expand.ts";
import { program } from "./macro.ts";
import { readAll } from "./read.ts";

// #region run
// read -> expand -> parse -> elaborate -> execute. Macros are gone
// before Part 4's parser sees the program.
export const expanded = (source: string, hygienic = true) =>
  readAll(source).pipe(
    Effect.flatMap(program),
    Effect.flatMap(({ macros, body }) =>
      expandWith(hygienic)(macros, body),
    ),
  );

export const compile = (source: string, hygienic = true) =>
  expanded(source, hygienic).pipe(
    Effect.flatMap((sexp) =>
      Schema.decodeEffect(ExprFromSexp)(sexp).pipe(
        Effect.mapError((error) => diagnose(error.issue)),
      ),
    ),
    Effect.flatMap(elaborate),
  );

export const run = (
  source: string,
  hygienic = true,
): Effect.Effect<Value, Failure, Output> =>
  compile(source, hygienic).pipe(
    Effect.flatMap((core) => execute(core, undefined)),
  );

export const expansion = (source: string, hygienic = true) =>
  Effect.map(expanded(source, hygienic), show);

export const report = (source: string, error: Failure) =>
  render(source, { message: error.message, span: error.span });
// #endregion run

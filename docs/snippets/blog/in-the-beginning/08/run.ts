import { Effect } from "effect";
import { render } from "../02/read.ts";
import type { Output } from "../04/capabilities.ts";
import { showType } from "../05/types.ts";
import { execute, type Value } from "../06/execute.ts";
import type { Failure } from "../06/run.ts";
import { expanded } from "../07/run.ts";
import { elaborate, type Prelude, rootEnv } from "./kernel.ts";

// #region run
// Part 7's pipeline, minus Part 4's parser: the kernel elaborates
// the expanded s-expression directly, with a prelude's forms.
export const compile = (prelude: Prelude, source: string) =>
  expanded(source).pipe(
    Effect.flatMap((sexp) => elaborate(prelude, sexp)),
  );

// Part 6's executor runs the result, in the prelude's frame.
export const run = (
  prelude: Prelude,
  source: string,
): Effect.Effect<Value, Failure, Output> =>
  compile(prelude, source).pipe(
    Effect.flatMap((core) => execute(core, rootEnv(prelude))),
  );
// #endregion run

export const typeOf = (prelude: Prelude, source: string) =>
  compile(prelude, source).pipe(Effect.map((c) => showType(c.type)));

export const report = (source: string, error: Failure) =>
  render(source, { message: error.message, span: error.span });

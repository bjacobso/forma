import { Effect } from "effect";
import { render } from "../02/read.ts";
import { Output } from "../04/capabilities.ts";
import { execute, type Value } from "../06/execute.ts";
import { expanded } from "../07/run.ts";
import { elaborate, erase, type Prelude, rootEnv } from "./kernel.ts";
import { standard } from "./prelude.ts";
import type { CheckError } from "./solver.ts";
import { showComputation, type Type } from "./types.ts";

// #region run
// Part 8's pipeline. A host may name the effects it allows; then
// a program that needs any other is rejected before it starts.
export const compile = (
  prelude: Prelude,
  source: string,
  allowed: ReadonlyArray<string> | null = null,
) =>
  expanded(source).pipe(
    Effect.flatMap((sexp) => elaborate(prelude, sexp, allowed)),
  );

// Effects are erased, and Part 6's executor runs what's left.
export const run = (
  prelude: Prelude,
  source: string,
  allowed: ReadonlyArray<string> | null = null,
) =>
  compile(prelude, source, allowed).pipe(
    Effect.flatMap(({ core }) =>
      execute(erase(core), rootEnv(prelude)),
    ),
  );

// What a program returns, and what running it does.
export const typeOf = (source: string) =>
  compile(standard, source).pipe(
    Effect.map(({ core, effects }) =>
      showComputation(core.type, effects),
    ),
  );
// #endregion run

// The labels in a program's effects.
export const labels = (effects: Type) =>
  effects._tag === "TRow" ? [...effects.labels].sort() : [];

export const report = (
  source: string,
  error: { message: string; span: { start: number; end: number } },
) => render(source, error);

// #region host
// A host that runs scripts to completion, right now. It has no
// event loop to wait on, so it allows Output and DivByZero but not
// Async. The checker's answer is what makes Effect.runSync safe.
export const script = (
  source: string,
  output: { readonly print: (line: string) => Effect.Effect<void> },
) =>
  Effect.runSyncExit(
    run(standard, source, ["Output", "DivByZero"]).pipe(
      Effect.provideService(Output, output),
    ),
  );
// #endregion host

export type { CheckError, Value };

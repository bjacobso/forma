import { Effect, Schema } from "effect";
import { type Diagnostic, render } from "../02/read.ts";
import type { Output } from "../04/capabilities.ts";
import type { DivByZero } from "../04/errors.ts";
import { parse } from "../04/expr.ts";
import type { CheckError } from "../05/errors.ts";
import { showType } from "../05/types.ts";
import { Core } from "./core.ts";
import { elaborate } from "./elaborate.ts";
import { execute, type Value } from "./execute.ts";

// #region run
export type Failure = Diagnostic | CheckError | DivByZero;

// The front end: source in, typed core (or a diagnostic) out.
export const compile = (source: string) =>
  parse(source).pipe(Effect.flatMap(elaborate));

// The back end: runs core. It never sees source or infers a type.
export const run = (
  source: string,
): Effect.Effect<Value, Failure, Output> =>
  compile(source).pipe(
    Effect.flatMap((core) => execute(core, undefined)),
  );

// Checking is now elaboration, keeping only the type at the root.
export const typeOf = (source: string) =>
  compile(source).pipe(Effect.map((core) => showType(core.type)));

export const report = (source: string, error: Failure) =>
  render(source, { message: error.message, span: error.span });
// #endregion run

// #region artifact
// Core is data with a schema, so the compiler's output can be text.
const CoreJson = Schema.fromJsonString(Core);

// Compile once, to JSON that can be saved, sent, and run later.
export const build = (source: string) =>
  compile(source).pipe(
    Effect.flatMap(Schema.encodeEffect(CoreJson)),
  );

// Load it back. Decoding checks the artifact's shape, not types.
export const load = (json: string) =>
  Schema.decodeUnknownEffect(CoreJson)(json);
// #endregion artifact

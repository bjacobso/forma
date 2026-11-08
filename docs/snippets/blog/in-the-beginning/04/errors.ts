import { Schema } from "effect";
import { Span } from "../02/sexp.ts";
import type { EvalError as Part3Error } from "../03/errors.ts";

export { DivByZero, NotANumber, NotCallable, UnboundName } from "../03/errors.ts";

// #region errors
// Functions bring a new way to fail: the wrong number of arguments.
export class WrongArity extends Schema.TaggedError<WrongArity>()(
  "WrongArity",
  { expected: Schema.Number, got: Schema.Number, span: Span },
) {
  override get message() {
    const { expected, got } = this;
    const s = expected === 1 ? "" : "s";
    return `expected ${expected} argument${s}, got ${got}`;
  }
}

export type EvalError = Part3Error | WrongArity;
// #endregion errors

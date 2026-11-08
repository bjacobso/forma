import { Schema } from "effect";
import { Span } from "../02/sexp.ts";
import type { UnboundName } from "../04/errors.ts";

export { UnboundName } from "../04/errors.ts";

// #region errors
// Type errors: found before running, pointing at the source.
export class Mismatch extends Schema.TaggedError<Mismatch>()(
  "Mismatch",
  { expected: Schema.String, got: Schema.String, span: Span },
) {
  override get message() {
    return `expected ${this.expected}, got ${this.got}`;
  }
}

export class ArityError extends Schema.TaggedError<ArityError>()(
  "ArityError",
  { expected: Schema.Number, got: Schema.Number, span: Span },
) {
  override get message() {
    const { expected, got } = this;
    const s = expected === 1 ? "" : "s";
    return `expected ${expected} argument${s}, got ${got}`;
  }
}

export class CyclicType extends Schema.TaggedError<CyclicType>()(
  "CyclicType",
  { variable: Schema.String, type: Schema.String, span: Span },
) {
  override get message() {
    return `infinite type: ${this.variable} = ${this.type}`;
  }
}

export type CheckError =
  | UnboundName
  | Mismatch
  | ArityError
  | CyclicType;
// #endregion errors

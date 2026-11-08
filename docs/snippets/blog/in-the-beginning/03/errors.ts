import { Schema } from "effect";
import { Span } from "../02/sexp.ts";

// #region errors
// Every way evaluation can fail, as data: what failed, and where.
export class UnboundName extends Schema.TaggedError<UnboundName>()(
  "UnboundName",
  { symbol: Schema.String, span: Span },
) {
  override get message() {
    return `${this.symbol} is not defined`;
  }
}

export class NotCallable extends Schema.TaggedError<NotCallable>()(
  "NotCallable",
  { symbol: Schema.String, span: Span },
) {
  override get message() {
    return `${this.symbol} is not a function`;
  }
}

export class NotANumber extends Schema.TaggedError<NotANumber>()(
  "NotANumber",
  { op: Schema.String, got: Schema.String, span: Span },
) {
  override get message() {
    return `${this.op} expects numbers, got ${this.got}`;
  }
}

export class DivByZero extends Schema.TaggedError<DivByZero>()(
  "DivByZero",
  { span: Span },
) {
  override get message() {
    return "division by zero";
  }
}

export type EvalError =
  | UnboundName
  | NotCallable
  | NotANumber
  | DivByZero;
// #endregion errors

import { Data } from "effect";
import type { Loc } from "../reader/index.js";
import type { MacroOrigin, SourceTrace } from "../evaluator/source-trace.js";
import type { Span } from "../type/core-expr.js";

// =============================================================================
// Kernel Errors
// =============================================================================

export interface KernelStackFrame {
  readonly name: string;
  readonly loc?: Loc;
  readonly macroOrigins?: readonly MacroOrigin[];
}

export class StepLimitExceeded extends Data.TaggedError("StepLimitExceeded")<{
  readonly limit: number;
  readonly loc?: Loc;
  readonly macroOrigins?: readonly MacroOrigin[];
  readonly stackTrace?: readonly KernelStackFrame[];
}> {}

export class KernelTypeError extends Data.TaggedError("KernelTypeError")<{
  readonly message: string;
  readonly expected: string;
  readonly got: string;
  /** Structured data for the diagnostic; a string `code` becomes its code. */
  readonly details?: Readonly<Record<string, unknown>>;
  readonly loc?: Loc;
  readonly macroOrigins?: readonly MacroOrigin[];
  readonly stackTrace?: readonly KernelStackFrame[];
}> {}

export class ArityError extends Data.TaggedError("ArityError")<{
  readonly name: string;
  readonly expected: number | string;
  readonly got: number;
  readonly loc?: Loc;
  readonly macroOrigins?: readonly MacroOrigin[];
  readonly stackTrace?: readonly KernelStackFrame[];
}> {}

export class FailError extends Data.TaggedError("FailError")<{
  readonly message: string;
  readonly loc?: Loc;
  readonly macroOrigins?: readonly MacroOrigin[];
  readonly stackTrace?: readonly KernelStackFrame[];
}> {}

export type KernelError = StepLimitExceeded | KernelTypeError | ArityError | FailError;

export function withKernelSourceTrace(error: KernelError, trace: SourceTrace): KernelError {
  const loc = trace.macroOrigins ? trace.loc : (error.loc ?? trace.loc);
  const macroOrigins = error.macroOrigins ?? trace.macroOrigins;

  switch (error._tag) {
    case "StepLimitExceeded":
      return new StepLimitExceeded({
        limit: error.limit,
        ...(loc ? { loc } : {}),
        ...(macroOrigins ? { macroOrigins } : {}),
        ...(error.stackTrace ? { stackTrace: error.stackTrace } : {}),
      });
    case "KernelTypeError":
      return new KernelTypeError({
        message: error.message,
        expected: error.expected,
        got: error.got,
        ...(error.details ? { details: error.details } : {}),
        ...(loc ? { loc } : {}),
        ...(macroOrigins ? { macroOrigins } : {}),
        ...(error.stackTrace ? { stackTrace: error.stackTrace } : {}),
      });
    case "ArityError":
      return new ArityError({
        name: error.name,
        expected: error.expected,
        got: error.got,
        ...(loc ? { loc } : {}),
        ...(macroOrigins ? { macroOrigins } : {}),
        ...(error.stackTrace ? { stackTrace: error.stackTrace } : {}),
      });
    case "FailError":
      return new FailError({
        message: error.message,
        ...(loc ? { loc } : {}),
        ...(macroOrigins ? { macroOrigins } : {}),
        ...(error.stackTrace ? { stackTrace: error.stackTrace } : {}),
      });
  }
}

// =============================================================================
// Inference Errors
// =============================================================================

export interface Origin {
  readonly nodeId: string;
  readonly span: Span;
  readonly kind: string;
  readonly message?: string | undefined;
  readonly macroOrigins?: readonly MacroOrigin[];
}

export class InferenceError extends Error {
  readonly _tag = "InferenceError" as const;
  readonly origin: Origin | undefined;
  readonly details: Record<string, unknown>;
  readonly help: string | undefined;
  readonly fix: readonly import("./diagnostic.js").DiagnosticTextEdit[] | undefined;

  constructor(opts: {
    message: string;
    origin?: Origin | undefined;
    details?: Record<string, unknown>;
    help?: string | undefined;
    fix?: readonly import("./diagnostic.js").DiagnosticTextEdit[] | undefined;
  }) {
    const msg =
      opts.origin && opts.origin.span
        ? `${opts.message} (at offset ${opts.origin.span.start})`
        : opts.message;
    super(msg);
    this.origin = opts.origin;
    this.details = opts.details ?? {};
    this.help = opts.help;
    this.fix = opts.fix;
  }
}

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

const KERNEL_ERROR_TAGS: ReadonlySet<unknown> = new Set([
  "StepLimitExceeded",
  "KernelTypeError",
  "ArityError",
  "FailError",
]);

export function isKernelError(error: unknown): error is KernelError {
  return (
    typeof error === "object" &&
    error !== null &&
    KERNEL_ERROR_TAGS.has((error as { _tag?: unknown })._tag)
  );
}

/**
 * Locate an error raised while evaluating a node with `trace`. The innermost
 * location wins: an error that already has one keeps it, and takes the
 * trace's macro calls only when it was raised at the trace's own location.
 */
export function withKernelSourceTrace(error: KernelError, trace: SourceTrace): KernelError {
  if (error.loc && (error.macroOrigins || !trace.macroOrigins || !sameLoc(error.loc, trace.loc))) {
    return error;
  }
  return relocateKernelError(
    error,
    error.loc ?? trace.loc,
    error.macroOrigins ?? trace.macroOrigins,
  );
}

function sameLoc(left: Loc, right: Loc): boolean {
  return left.start === right.start && left.end === right.end;
}

/** The error with its location and macro calls replaced. */
export function relocateKernelError(
  error: KernelError,
  loc: Loc | undefined,
  macroOrigins: readonly MacroOrigin[] | undefined,
): KernelError {
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

  constructor(opts: {
    message: string;
    origin?: Origin | undefined;
    details?: Record<string, unknown>;
  }) {
    const msg =
      opts.origin && opts.origin.span
        ? `${opts.message} (at offset ${opts.origin.span.start})`
        : opts.message;
    super(msg);
    this.origin = opts.origin;
    this.details = opts.details ?? {};
  }
}

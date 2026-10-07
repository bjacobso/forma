/**
 * Errors, diagnostics, and source traces.
 *
 * @module Diagnostic
 */

export {
  StepLimitExceeded,
  KernelTypeError,
  ArityError,
  FailError,
  type KernelError,
} from "./diagnostic/errors.js";

export { InferenceError, type Origin } from "./diagnostic/errors.js";

// Re-export ParseError for convenience
export { ParseError } from "./reader/types.js";

export {
  diagnosticFromUnknown,
  type Diagnostic,
  type DiagnosticPhase,
  type Span,
} from "./diagnostic/diagnostic.js";

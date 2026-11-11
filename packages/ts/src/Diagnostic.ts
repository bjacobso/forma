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
export { closestName } from "./diagnostic/closest-name.js";

export {
  diagnosticFromUnknown,
  hasDiagnosticCode,
  type Diagnostic,
  type DiagnosticDetails,
  type DiagnosticDetailsMap,
  type HoleDiagnosticDetails,
  type DiagnosticTextEdit,
  type DiagnosticPhase,
  type Span,
} from "./diagnostic/diagnostic.js";

export { DiagnosticCatalog, diagnosticCatalog, builtinDiagnosticCatalog, type DiagnosticCatalogEntry } from "./diagnostic/catalog.js";

export { authorNames } from "./diagnostic/diagnostic.js";
export { spanLocator, diagnosticLocator, type LocatedSpan, type LocatedDiagnostic } from "./diagnostic/locations.js";

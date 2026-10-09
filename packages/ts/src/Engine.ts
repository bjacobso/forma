/**
 * Engine-owned operation facade for host adapters.
 *
 * @module Engine
 */

export {
  diagnosticFromUnknown,
  evaluate,
  evaluateInSession,
  evaluateObserved,
  prepareModuleImports,
  moduleCoreOptions,
  moduleCheckOptions,
  expand,
  parse,
  parseSource,
  typecheck,
  typeInferOptions,
  typeProjection,
  type AstNode,
  type Diagnostic,
  type ExpandRequest,
  type ExpandResult,
  type EvaluateInSessionRequest,
  type EvaluateRequest,
  type EvaluateResult,
  type ExpressionObservation,
  type ExpressionType,
  type HostBuiltinDescriptor,
  type ObservationReport,
  type PassName,
  type PassResult,
  type ParsedSource,
  type ParseRequest,
  type ParseResult,
  type Span,
  type TypecheckRequest,
  type TypecheckResult,
  type TypePolicy,
  type TypeProjection,
  type TypeSchemeExpr,
} from "./engine/operations.js";

export { debugCore, type CoreDebugResult } from "./engine/debug.js";
export { lowerCore, typecheckCore, typecheckCoreTyped } from "./engine/debug.js";
export { incrementalSummary, parseSummary, type IncrementalSummary } from "./engine/incremental.js";
export { validateHostTypes } from "./engine/type-policy.js";

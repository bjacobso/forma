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

/**
 * Direct Lisp interpreter.
 *
 * @module Evaluator
 */

export {
  evaluate,
  evaluateExprs,
  evaluateCompileTimeExprs,
  applyKFn,
  makePreludeLayer,
  observeEvaluation,
  type ObservedEvaluation,
} from "./evaluator/eval.js";
export {
  DEFAULT_MAX_OBSERVATION_RECORDS,
  ObservationCollector,
  type ExpressionObservation,
  type KernelObserver,
  type ObservationOptions,
  type ObservationReport,
} from "./evaluator/observation.js";
export {
  buildKernelExpansionEnv,
  expandKernelExprs,
  expandKernelExprsSync,
  parseAndExpandKernelSource,
} from "./evaluator/frontend.js";
export { sourceOriginsOf, sourceTraceOf } from "./evaluator/source-trace.js";
export { printKValue, printSExpr } from "./evaluator/kvalue-to-source.js";
export { kValueToSExpr } from "./evaluator/quasiquote.js";

export type {
  KValue,
  KFn,
  KSExpr,
  KMacro,
  KMeta,
  BuiltinFn,
  KernelOptions,
  KernelResult,
} from "./evaluator/types.js";
export {
  isKFn,
  isKSExpr,
  isKMacro,
  isKMeta,
  isKList,
  isKMap,
  isTruthy,
  kEquals,
  describeType,
  asNumber,
  asString,
  asList,
  asKFn,
} from "./evaluator/types.js";

/**
 * Hindley-Milner type system: types, inference, unification, kinds, effects, typeclasses.
 *
 * @module Type
 */

// Re-export everything from the internal HM barrel (includes convenience functions)
export {
  // Errors
  InferenceError,
  type Origin,

  // Type aliases (re-export both named types and constructors)
  type Type,
  type SchemeType,
  type Row,
  type ERow,
  type ConstraintT,
  type TVarT,
  type TConT,
  type TFunT,
  type TVariadicT,
  type TAppT,
  type TRowT,
  type REmptyT,
  type RVarT,
  type RExtendT,
  type EEmptyT,
  type EVarT,
  type EExtendT,

  // Type constructors
  TVar,
  TCon,
  TFun,
  TVariadic,
  TApp,
  TRow,
  REmpty,
  RVar,
  RExtend,
  EEmpty,
  EVar,
  EExtend,
  Constraint,
  Scheme,
  mono,
  tNum,
  tStr,
  tBool,
  tNil,
  tList,
  tMeta,
  tUnknown,
  tNever,
  showType,
  showRow,
  showERow,
  showScheme,
  showConstraint,
  fnType,
  variadicFnType,
  ftvType,
  ftvRow,
  fevType,
  fevERow,
  freeVarsScheme,
  flattenRow,
  buildRow,
  flattenERow,
  buildERow,

  // Inference context
  InferContext,
  makeInferContext,
  type NodeTypeMap,
  type InferDiagnostic,
  type DiagnosticList,
  type ADTInfo,
  type ClassInfo,
  type InstanceInfo,

  // Inference
  inferExpr,
  inferProgram,
  inferProgramAll,

  // Unification
  unify,
  unifyRows,
  unifyERows,
  applyFn,

  // Substitution
  type Subst,
  applyType,
  applyRow,
  applyERow,
  emptySubst,

  // Kinds
  type Kind,
  KStar,
  KRow,
  KEffect,
  KArrow,
  showKind,
  kindsEqual,
  kindFromArity,
  getBuiltinKind,

  // Typeclasses
  resolveConstraint,
  resolveConstraints,
  checkCoherence,
  builtinScheme,
  type BuiltinSchemeProvider,

  // Lowering
  lower,
  lowerProgram,

  // DSL type provider
  type DSLTypeProvider,
  type DSLSlotInfo,
  type SlotMode,

  // Convenience inference functions
  inferSource,
  inferSourceStr,
  inferSourceAll,
  type InferOptions,
  type InferResult,
  type InferAllResult,
} from "./type/index.js";

export {
  inferAuthoritySource,
  checkAuthority,
  assertAttributesFromEffect,
  type GrantFact,
  type CheckAuthorityOptions,
  type AuthorityManifest,
  type AuthorityInferenceResult,
  type AuthorityCheckResult,
} from "./type/authority.js";

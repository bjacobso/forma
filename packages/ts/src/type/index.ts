/**
 * Hindley-Milner type inference for the Lisp kernel.
 *
 * Now with:
 *  - CoreExpr intermediate representation with NodeId + Span
 *  - Row polymorphism for records
 *  - Effect-TS-service-based InferContext with Ref<Subst>
 *  - NodeTypeMap population for IDE features
 *
 * Usage:
 *   import { inferSource, inferSourceStr } from "@formalang/ts/type"
 *
 *   const type = Effect.runPromise(inferSourceStr("(fn [x] (+ x 1))"))
 *   // => "Num -> Num"
 */
import { Effect, Layer, Ref } from "effect";
import { parseManyToSExpr, type ParseError } from "../reader/index.js";
import type { Type } from "./types.js";
import { showType, tNil } from "./types.js";
import { inferProgram, inferProgramAll } from "./infer.js";
import { InferContext, makeInferContext, type NodeTypeMap } from "./context.js";
import type { BuiltinSchemeProvider } from "./builtin-schemes.js";
import { InferenceError } from "./errors.js";
import { lowerProgram } from "./lower.js";
import { resetNodeIds } from "./core-expr.js";

// Re-exports
export { InferenceError, type Origin } from "./errors.js";
export type {
  Type,
  Scheme as SchemeType,
  Row,
  ERow,
  Constraint as ConstraintT,
  TVar as TVarT,
  TCon as TConT,
  TFun as TFunT,
  TVariadic as TVariadicT,
  TApp as TAppT,
  TRow as TRowT,
  REmpty as REmptyT,
  RVar as RVarT,
  RExtend as RExtendT,
  EEmpty as EEmptyT,
  EVar as EVarT,
  EExtend as EExtendT,
} from "./types.js";
export {
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
} from "./types.js";
export {
  InferContext,
  makeInferContext,
  type MakeInferContextOptions,
  type NodeTypeMap,
  type InferDiagnostic,
  type DiagnosticList,
  type ADTInfo,
  type ClassInfo,
  type InstanceInfo,
} from "./context.js";
export { inferExpr, inferProgram, inferProgramAll } from "./infer.js";
export { unify, unifyRows, unifyERows, applyFn } from "./unify.js";
export type { Subst } from "./substitution.js";
export { applyType, applyRow, applyERow, emptySubst } from "./substitution.js";
export type { Kind } from "./kind.js";
export {
  KStar,
  KRow,
  KEffect,
  KArrow,
  showKind,
  kindsEqual,
  kindFromArity,
  getBuiltinKind,
} from "./kind.js";
export { resolveConstraint, resolveConstraints, checkCoherence } from "./typeclass.js";
export { builtinScheme, type BuiltinSchemeProvider } from "./builtin-schemes.js";
export type {
  CoreExpr,
  CLit,
  CVar,
  CLam,
  CApp,
  CLet,
  CEffectDo,
  CEffectFail,
  CEffectCatch,
  CIf,
  CRecord,
  CGet,
  CDef,
  CDSLForm,
  CTypeDef,
  CMatch,
  DSLFormChild,
  Span,
  MatchArm,
  Pattern,
  ADTConstructor,
  CDefClass,
  CInstance,
  CDefService,
  ClassTypeParam,
  ClassConstraint,
  ClassMethod,
  InstanceMethod,
  ServiceMethod,
} from "./core-expr.js";
export { lower, lowerProgram } from "./lower.js";
export {
  analyzeLsp,
  findTypeAtOffset,
  type AnalyzeLspOptions,
  type LspResult,
  type TypedSpan,
  type LspError,
} from "../lsp/hm-lsp.js";
export type { DSLTypeProvider, DSLSlotInfo } from "./dsl-provider.js";
export {
  createDSLTypeProviderFromRegistry,
  type CreateDSLTypeProviderOptions,
  type TypedSlotExtractor,
  type TypeBindingsExtractor,
  type ResultTypeForExprExtractor,
} from "./dsl-provider-from-registry.js";

// ---------------------------------------------------------------------------
// Convenience: infer from source string
// ---------------------------------------------------------------------------

export interface InferOptions {
  /** Optional DSL type provider for recognizing and type-checking DSL forms */
  readonly dslProvider?: import("./dsl-provider.js").DSLTypeProvider;
  /** Optional host-specific builtin type schemes. */
  readonly builtinScheme?: BuiltinSchemeProvider;
  /** Optional host-specific fallback for unbound symbol literals. */
  readonly unboundSymbolType?: (name: string) => Type | undefined;
}

export interface InferResult {
  readonly type: Type;
  readonly nodeTypes: NodeTypeMap;
  readonly diagnostics: import("./context.js").DiagnosticList;
}

/**
 * Parse source, lower to CoreExpr, and run type inference.
 * Returns the inferred type of the last expression + the NodeTypeMap.
 *
 * @param source The Lisp source code to infer types for
 * @param options Optional configuration including DSL type provider
 */
export function inferSource(
  source: string,
  options?: InferOptions,
): Effect.Effect<InferResult, InferenceError | ParseError> {
  return Effect.gen(function* () {
    const dslProvider = options?.dslProvider;
    const exprs = yield* parseManyToSExpr(source);
    if (exprs.length === 0) {
      return { type: tNil, nodeTypes: new Map(), diagnostics: [] };
    }

    resetNodeIds();
    const coreExprs = yield* Effect.try({
      try: () => lowerProgram(exprs, dslProvider),
      catch: (e) => (e instanceof InferenceError ? e : new InferenceError({ message: String(e) })),
    });

    const ctxService = yield* makeInferContext({
      ...(options?.builtinScheme ? { builtinScheme: options.builtinScheme } : {}),
      ...(options?.unboundSymbolType ? { unboundSymbolType: options.unboundSymbolType } : {}),
    });
    const layer = Layer.succeed(InferContext, ctxService);

    const result = yield* Effect.provide(
      inferProgram(coreExprs, undefined, dslProvider, exprs),
      layer,
    );
    const nodeTypes = yield* Ref.get(ctxService.nodeTypes);
    const diagnostics = yield* Ref.get(ctxService.diagnostics);

    return { type: result, nodeTypes, diagnostics };
  });
}

/**
 * Parse source and return the inferred type as a display string.
 */
export function inferSourceStr(
  source: string,
  options?: InferOptions,
): Effect.Effect<string, InferenceError | ParseError> {
  return Effect.map(inferSource(source, options), (r) => showType(r.type));
}

export interface InferAllResult {
  readonly types: readonly Type[];
  readonly nodeTypes: NodeTypeMap;
  readonly diagnostics: import("./context.js").DiagnosticList;
}

/**
 * Parse source, lower to CoreExpr, and run type inference for all expressions.
 * Returns an array of types, one per top-level expression.
 *
 * @param source The Lisp source code to infer types for
 * @param options Optional configuration including DSL type provider
 */
export function inferSourceAll(
  source: string,
  options?: InferOptions,
): Effect.Effect<InferAllResult, InferenceError | ParseError> {
  return Effect.gen(function* () {
    const dslProvider = options?.dslProvider;
    const exprs = yield* parseManyToSExpr(source);
    if (exprs.length === 0) {
      return { types: [], nodeTypes: new Map(), diagnostics: [] };
    }

    resetNodeIds();
    const coreExprs = yield* Effect.try({
      try: () => lowerProgram(exprs, dslProvider),
      catch: (e) => (e instanceof InferenceError ? e : new InferenceError({ message: String(e) })),
    });

    const ctxService = yield* makeInferContext({
      ...(options?.builtinScheme ? { builtinScheme: options.builtinScheme } : {}),
      ...(options?.unboundSymbolType ? { unboundSymbolType: options.unboundSymbolType } : {}),
    });
    const layer = Layer.succeed(InferContext, ctxService);

    const types = yield* Effect.provide(
      inferProgramAll(coreExprs, undefined, dslProvider, exprs),
      layer,
    );
    const nodeTypes = yield* Ref.get(ctxService.nodeTypes);
    const diagnostics = yield* Ref.get(ctxService.diagnostics);

    return { types, nodeTypes, diagnostics };
  });
}

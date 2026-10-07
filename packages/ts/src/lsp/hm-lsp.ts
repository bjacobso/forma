/**
 * LSP utilities for Hindley-Milner type inference.
 *
 * Provides structured output for IDE integration:
 * - All typed spans with their inferred types
 * - Type at cursor position
 * - Type errors with locations
 */

import { Effect, Layer, Ref } from "effect";
import { parseManyToSExpr } from "../reader/index.js";
import type { Type } from "../type/types.js";
import { showType, tNil } from "../type/types.js";
import type { CoreExpr, Span } from "../type/core-expr.js";
import { resetNodeIds } from "../type/core-expr.js";
import { lowerProgram } from "../type/lower.js";
import { inferProgram } from "../type/infer.js";
import type { TypeEnv } from "../type/substitution.js";
import { unifiedFormProvider } from "../type/unified-form-provider.js";
import type { SExpr } from "../reader/types.js";
import type { Env } from "../Env.js";
import { expandKernelExprsSync } from "../evaluator/frontend.js";
import {
  InferContext,
  makeOwnedInferContext,
  type MakeInferContextOptions,
} from "../type/context.js";
import { applyType } from "../type/substitution.js";
import { InferenceError } from "../type/errors.js";
import type { DSLTypeProvider } from "../type/dsl-provider.js";

// ---------------------------------------------------------------------------
// Types for LSP output
// ---------------------------------------------------------------------------

export interface TypedSpan {
  readonly id: string;
  readonly span: Span;
  readonly type: Type;
  readonly typeString: string;
  readonly code: string;
  readonly exprTag: string; // e.g., "Lam", "App", "Var", "Lit"
}

export interface LspError {
  readonly message: string;
  readonly span?: Span | undefined;
  readonly code?: string | undefined;
}

export interface LspResult {
  readonly success: boolean;
  readonly resultType?: Type | undefined;
  readonly resultTypeString?: string | undefined;
  readonly typedSpans: readonly TypedSpan[];
  readonly errors: readonly LspError[];
  /** Non-fatal diagnostics from DSL form validation (e.g., CEL type errors) */
  readonly diagnostics: readonly import("../type/context.js").InferDiagnostic[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract a code snippet from source given a span.
 */
function extractCode(source: string, span: Span): string {
  return source.slice(span.start, span.end);
}

/**
 * Recursively collect all CoreExpr nodes in tree order.
 */
function collectNodes(expr: CoreExpr): CoreExpr[] {
  const nodes: CoreExpr[] = [expr];

  switch (expr._tag) {
    case "Lam":
      nodes.push(...collectNodes(expr.body));
      break;
    case "App":
      nodes.push(...collectNodes(expr.fn));
      for (const arg of expr.args) {
        nodes.push(...collectNodes(arg));
      }
      break;
    case "Let":
      for (const binding of expr.bindings) {
        nodes.push(...collectNodes(binding.expr));
      }
      nodes.push(...collectNodes(expr.body));
      break;
    case "If":
      nodes.push(...collectNodes(expr.cond));
      nodes.push(...collectNodes(expr.then));
      nodes.push(...collectNodes(expr.else_));
      break;
    case "Record":
      for (const field of expr.fields) {
        nodes.push(...collectNodes(field.value));
      }
      break;
    case "Get":
      nodes.push(...collectNodes(expr.record));
      break;
    case "Def":
      nodes.push(...collectNodes(expr.expr));
      break;
    case "Ascribe":
      nodes.push(...collectNodes(expr.expr));
      break;
    case "DSLForm":
      for (const child of expr.children) {
        nodes.push(...collectNodes(child.expr));
      }
      break;
    case "Match":
      nodes.push(...collectNodes(expr.scrutinee));
      for (const arm of expr.arms) {
        nodes.push(...collectNodes(arm.body));
      }
      break;
    // TypeDef has no children to traverse (only a TypeExpr, not a CoreExpr)
    // Lit, Var have no children
  }

  return nodes;
}

// ---------------------------------------------------------------------------
// Main analysis function
// ---------------------------------------------------------------------------

/**
 * Options for LSP analysis.
 */
export interface AnalyzeLspOptions {
  /**
   * Optional DSL type provider for recognizing and type-checking DSL forms.
   * When provided, forms like (entity ...) are lowered to CDSLForm nodes
   * and their sub-expressions are type-checked via HM inference.
   */
  readonly dslProvider?: DSLTypeProvider;
  /**
   * Types for names the program does not define, such as host builtins, and
   * the scheme provider for built-ins. See `TypecheckRequest.hostBuiltins`
   * and `typePolicy`.
   */
  readonly inferOptions?: MakeInferContextOptions;
  /** Types of names defined before this source, such as by its preludes. */
  readonly initialEnv?: TypeEnv | undefined;
  /** Macros defined before this source, such as by its preludes. */
  readonly macroEnv?: Env | undefined;
  /** Receives the type environment after the last form. */
  readonly captureEnv?: ((env: TypeEnv) => void) | undefined;
}

/**
 * Analyze Lisp source and return structured LSP information.
 *
 * @param source The Lisp source code to analyze
 * @param options Optional configuration including DSL type provider
 */
export function analyzeLsp(
  source: string,
  options?: AnalyzeLspOptions,
): Effect.Effect<LspResult, never> {
  return Effect.gen(function* () {
    // Parse
    const parseResult = yield* Effect.result(parseManyToSExpr(source));
    if (parseResult._tag === "Failure") {
      const err = parseResult.failure;
      return {
        success: false,
        typedSpans: [],
        errors: [
          {
            message: `Parse error: ${err.message}`,
            span: err.loc ? { start: err.loc.start, end: err.loc.end } : undefined,
          },
        ],
        diagnostics: [],
      };
    }

    const sexprs = parseResult.success;
    if (sexprs.length === 0) {
      return {
        success: true,
        resultType: tNil,
        resultTypeString: showType(tNil),
        typedSpans: [],
        errors: [],
        diagnostics: [],
      };
    }

    // Lower (passing DSL provider so DSL forms become CDSLForm nodes). A
    // top-level form that does not lower is reported, and the others are
    // still lowered and typed.
    resetNodeIds();
    // An invalid local `form` declaration is reported; the program is still
    // typed with the forms its preludes describe.
    const formErrors: InferenceError[] = [];
    let dslProvider = options?.dslProvider;
    try {
      dslProvider = unifiedFormProvider(source, sexprs, options?.dslProvider);
    } catch (e) {
      formErrors.push(asInferenceError(e));
    }
    const lowered = lowerRecovering(sexprs, dslProvider, options?.macroEnv);
    const coreExprs = lowered.core;
    // Infer (passing DSL provider for result types and type bindings). A
    // top-level form that does not type is reported, and the forms around it
    // are still typed.
    // The builder stays private; only projected typed spans escape this call.
    const ctxService = yield* makeOwnedInferContext(options?.inferOptions);
    const layer = Layer.succeed(InferContext, ctxService);

    formErrors.push(...lowered.errors);

    const inferResult = yield* Effect.result(
      Effect.provide(
        inferProgram(coreExprs, options?.initialEnv, dslProvider, sexprs, options?.captureEnv, {
          onFormError: (error) => Effect.sync(() => void formErrors.push(error)),
        }),
        layer,
      ),
    );

    // Collect diagnostics regardless of success/failure
    const collectedDiagnostics = yield* Ref.get(ctxService.diagnostics);
    const failures = inferResult._tag === "Failure" ? [...formErrors, inferResult.failure] : formErrors;
    const errors = failures.map((err) => ({
      message: err.message,
      span: err.origin?.span,
      code: err.origin?.span ? extractCode(source, err.origin.span) : undefined,
    }));

    const resultType = inferResult._tag === "Success" ? inferResult.success : undefined;
    // Types recorded early in inference are resolved with everything learned since.
    const finalSubst = yield* Ref.get(ctxService.subst);
    const nodeTypes = yield* Ref.get(ctxService.nodeTypes);

    // Collect all nodes and build typed spans
    const allNodes: CoreExpr[] = [];
    for (const expr of coreExprs) {
      allNodes.push(...collectNodes(expr));
    }

    const typedSpans: TypedSpan[] = [];
    for (const node of allNodes) {
      const recorded = nodeTypes.get(node.id);
      if (recorded) {
        const type = applyType(finalSubst, recorded);
        typedSpans.push({
          id: node.id,
          span: node.span,
          type,
          typeString: showType(type),
          code: extractCode(source, node.span),
          exprTag: node._tag,
        });
      }
    }

    // Sort by span start position
    typedSpans.sort((a, b) => a.span.start - b.span.start);

    return {
      success: errors.length === 0,
      ...(resultType !== undefined && errors.length === 0
        ? { resultType, resultTypeString: showType(resultType) }
        : {}),
      typedSpans,
      errors,
      diagnostics: collectedDiagnostics,
    };
  });
}

function asInferenceError(error: unknown): InferenceError {
  if (error instanceof InferenceError) return error;
  return new InferenceError({ message: error instanceof Error ? error.message : String(error) });
}

/**
 * Lower a program, or, when one of its forms does not lower, each form on
 * its own with the signatures that describe it.
 */
function lowerRecovering(
  sexprs: readonly SExpr[],
  dslProvider: DSLTypeProvider | undefined,
  macroEnv: Env | undefined,
): { readonly core: CoreExpr[]; readonly errors: readonly InferenceError[] } {
  const lowerOptions = macroEnv ? { macroEnv } : {};
  try {
    return { core: lowerProgram(sexprs, dslProvider, lowerOptions), errors: [] };
  } catch {
    // Fall through to per-form lowering.
  }
  const signatureOf = (expr: SExpr): string | undefined =>
    expr._tag === "List" &&
    expr.items.length === 3 &&
    expr.items[0]?._tag === "Sym" &&
    expr.items[0].name === ":" &&
    expr.items[1]?._tag === "Sym"
      ? expr.items[1].name
      : undefined;
  const definedName = (expr: SExpr): string | undefined =>
    expr._tag === "List" && expr.items[1]?._tag === "Sym" ? expr.items[1].name : undefined;
  // Each form is lowered on its own, so the document's macros are defined first.
  const macros = sexprs.filter((expr) => {
    const head = expr._tag === "List" && expr.items[0]?._tag === "Sym" ? expr.items[0].name : undefined;
    return head === "macro" || head === "__macro";
  });
  let formOptions = lowerOptions;
  if (macros.length > 0) {
    try {
      const env = expandKernelExprsSync(macros, macroEnv ? { env: macroEnv } : {}).macroEnv;
      formOptions = { macroEnv: env.flatten() };
    } catch {
      // Calls to a macro that does not define are reported where they are lowered.
    }
  }
  const core: CoreExpr[] = [];
  const errors: InferenceError[] = [];
  for (const expr of sexprs) {
    if (signatureOf(expr) !== undefined) continue;
    const name = definedName(expr);
    const signatures = sexprs.filter((candidate) => name !== undefined && signatureOf(candidate) === name);
    try {
      core.push(...lowerProgram([...signatures, expr], dslProvider, formOptions));
    } catch (e) {
      const error = asInferenceError(e);
      errors.push(
        error.origin?.span
          ? error
          : new InferenceError({
              message: error.message,
              origin: { span: { start: expr.loc.start, end: expr.loc.end }, kind: "form", nodeId: "form" },
            }),
      );
    }
  }
  return { core, errors };
}

// ---------------------------------------------------------------------------
// Cursor position lookup
// ---------------------------------------------------------------------------

/**
 * Find the most specific type at a given offset.
 * Returns the smallest span containing the offset.
 */
export function findTypeAtOffset(
  typedSpans: readonly TypedSpan[],
  offset: number,
): TypedSpan | undefined {
  // Find all spans containing the offset
  const containing = typedSpans.filter((s) => s.span.start <= offset && offset < s.span.end);

  if (containing.length === 0) return undefined;

  // Return the smallest (most specific) span
  return containing.reduce((smallest, current) => {
    const smallestSize = smallest.span.end - smallest.span.start;
    const currentSize = current.span.end - current.span.start;
    return currentSize < smallestSize ? current : smallest;
  });
}

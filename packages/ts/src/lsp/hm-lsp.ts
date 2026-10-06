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
import { InferContext, makeOwnedInferContext } from "../type/context.js";
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
    const dslProvider = options?.dslProvider;

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

    // Lower (passing DSL provider so DSL forms become CDSLForm nodes)
    resetNodeIds();
    let coreExprs: CoreExpr[];
    try {
      coreExprs = lowerProgram(sexprs, dslProvider);
    } catch (e) {
      const err = e instanceof InferenceError ? e : new InferenceError({ message: String(e) });
      return {
        success: false,
        typedSpans: [],
        errors: [
          {
            message: err.message,
            span: err.origin?.span,
          },
        ],
        diagnostics: [],
      };
    }

    // Infer (passing DSL provider for result types and type bindings)
    // The builder stays private; only projected typed spans escape this call.
    const ctxService = yield* makeOwnedInferContext();
    const layer = Layer.succeed(InferContext, ctxService);

    const inferResult = yield* Effect.result(
      Effect.provide(inferProgram(coreExprs, undefined, dslProvider, sexprs), layer),
    );

    // Collect diagnostics regardless of success/failure
    const collectedDiagnostics = yield* Ref.get(ctxService.diagnostics);

    if (inferResult._tag === "Failure") {
      const err = inferResult.failure;
      return {
        success: false,
        typedSpans: [],
        errors: [
          {
            message: err.message,
            span: err.origin?.span,
            code: err.origin?.span ? extractCode(source, err.origin.span) : undefined,
          },
        ],
        diagnostics: collectedDiagnostics,
      };
    }

    const resultType = inferResult.success;
    const nodeTypes = yield* Ref.get(ctxService.nodeTypes);

    // Collect all nodes and build typed spans
    const allNodes: CoreExpr[] = [];
    for (const expr of coreExprs) {
      allNodes.push(...collectNodes(expr));
    }

    const typedSpans: TypedSpan[] = [];
    for (const node of allNodes) {
      const type = nodeTypes.get(node.id);
      if (type) {
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
      success: true,
      resultType,
      resultTypeString: showType(resultType),
      typedSpans,
      errors: [],
      diagnostics: collectedDiagnostics,
    };
  });
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

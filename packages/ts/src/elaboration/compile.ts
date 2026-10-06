/**
 * Unified Compilation
 *
 * Compiles source code using the kernel and registered DSL handlers.
 * This is the main entry point for the unified REPL experience.
 */

import { Effect } from "effect";
import type { SExpr } from "../reader/index.js";
import { parseManyToSExpr, ParseError } from "../reader/index.js";
import type { CompileOptions } from "./context.js";
import { CompileContext, CompileError, createCompileContext } from "./context.js";
import { evaluateSlots } from "./slots.js";
import { evaluateCompileTimeExprs, evaluateExprs } from "../evaluator/eval.js";
import { buildKernelExpansionEnv } from "../evaluator/frontend.js";
import { PreludeEnv } from "../expander/prelude.js";
import type { KValue } from "../evaluator/types.js";
import type { DSLTypeProvider } from "../type/dsl-provider.js";
import type { LspResult } from "../lsp/hm-lsp.js";
import { analyzeLsp } from "../lsp/hm-lsp.js";

// =============================================================================
// Compile Result
// =============================================================================

/**
 * Result of unified compilation.
 */
export interface CompileResult {
  /** Results from evaluating/compiling each expression */
  readonly results: readonly CompileResultItem[];

  /** Accumulated errors */
  readonly errors: readonly CompileError[];

  /** Final context state */
  readonly ctx: CompileContext;
}

/**
 * Result item for a single expression.
 */
export type CompileResultItem =
  | { readonly kind: "value"; readonly value: KValue }
  | { readonly kind: "ir"; readonly handler: string; readonly ir: unknown }
  | { readonly kind: "error"; readonly error: CompileError };

// =============================================================================
// Compilation
// =============================================================================

/**
 * Compile source code with DSL handlers.
 *
 * Requires the `PreludeEnv` service for macro definitions.
 */
export function compile(
  source: string,
  options?: CompileOptions,
): Effect.Effect<CompileResult, ParseError | CompileError, PreludeEnv> {
  return Effect.gen(function* () {
    const exprs = yield* parseManyToSExpr(source);
    return yield* compileExprs(exprs, { ...options, source });
  });
}

/**
 * Compile pre-parsed expressions.
 *
 * Requires the `PreludeEnv` service for macro definitions.
 */
export function compileExprs(
  exprs: readonly SExpr[],
  options?: CompileOptions,
): Effect.Effect<CompileResult, CompileError, PreludeEnv> {
  return Effect.gen(function* () {
    const ctx = createCompileContext(options);

    // Load prelude macros into context env through the shared frontend bootstrap.
    const preludeEnv = yield* PreludeEnv;
    ctx.env = buildKernelExpansionEnv({ env: ctx.env, preludeEnv });

    const results: CompileResultItem[] = [];

    for (const expr of exprs) {
      const result = yield* compileExpr(expr, ctx);
      results.push(result);
    }

    return {
      results,
      errors: ctx.errors,
      ctx,
    };
  });
}

/**
 * Compile a single expression.
 */
export function compileExpr(
  expr: SExpr,
  ctx: CompileContext,
): Effect.Effect<CompileResultItem, CompileError, PreludeEnv> {
  return Effect.gen(function* () {
    // Check if this is a DSL form
    if (expr._tag === "List" && expr.items.length > 0) {
      const head = expr.items[0];
      if (head?._tag === "Sym") {
        const handler = ctx.getHandler(head.name);
        if (handler) {
          // Extract and evaluate slots
          const slots = handler.extractSlots
            ? yield* handler.extractSlots(expr, ctx)
            : yield* evaluateSlots(expr, handler.slots, ctx);

          // Compile with handler
          const ir = yield* handler.compile(expr, ctx, slots);

          return { kind: "ir" as const, handler: handler.name, ir };
        }
      }
    }

    // Runtime REPL expressions should go through the VM-first facade.
    // Keep compile-time-only macro definitions on the evaluator path so the
    // returned env preserves macro bindings across submissions.
    const evaluateKernelExpr = isCompileTimeOnlyExpr(expr)
      ? evaluateCompileTimeExprs
      : evaluateExprs;

    const result = yield* Effect.mapError(
      evaluateKernelExpr([expr], {
        stepLimit: ctx.stepLimit,
        builtins: ctx.builtins,
        env: ctx.env,
      }),
      (e) => ctx.error(`Evaluation error: ${e.message}`, expr.loc),
    );

    // Update context with new environment (persists define bindings)
    ctx.env = result.env;

    return { kind: "value" as const, value: result.value };
  });
}

function isCompileTimeOnlyExpr(expr: SExpr): boolean {
  if (expr._tag !== "List" || expr.items.length === 0) {
    return false;
  }

  const head = expr.items[0];
  return head?._tag === "Sym" && head.name === "__macro";
}

// =============================================================================
// Convenience Functions
// =============================================================================

/**
 * Compile and return just the results (for REPL use).
 *
 * Requires the `PreludeEnv` service for macro definitions.
 */
export function compileSimple(
  source: string,
  options?: CompileOptions,
): Effect.Effect<
  { results: unknown[]; errors: readonly CompileError[] },
  ParseError | CompileError,
  PreludeEnv
> {
  return Effect.gen(function* () {
    const result = yield* compile(source, options);

    const values = result.results.map((item) => {
      switch (item.kind) {
        case "value":
          return item.value;
        case "ir":
          return item.ir;
        case "error":
          return { error: item.error.message };
      }
    });

    return { results: values, errors: result.errors };
  });
}

// =============================================================================
// Compilation with Type Checking
// =============================================================================

/**
 * Result of compilation with type checking.
 * Extends CompileResult with HM type inference information.
 */
export interface TypeCheckedCompileResult extends CompileResult {
  /** HM type inference results (typed spans, errors, etc.) */
  readonly typeInfo: LspResult;
}

/**
 * Compile source code with DSL handlers AND run HM type inference.
 *
 * Requires the `PreludeEnv` service for macro definitions.
 */
export function compileWithTypecheck(
  source: string,
  options: CompileOptions | undefined,
  dslProvider: DSLTypeProvider,
): Effect.Effect<TypeCheckedCompileResult, ParseError | CompileError, PreludeEnv> {
  return Effect.gen(function* () {
    // Run handler compilation (existing pipeline)
    const compileResult = yield* compile(source, options);

    // Run HM type inference in parallel (never fails, always returns result)
    const typeInfo = yield* analyzeLsp(source, { dslProvider });

    // Merge type errors into the compile errors
    const typeErrors: CompileError[] = typeInfo.errors.map(
      (err) =>
        new CompileError({
          message: `Type error: ${err.message}`,
          loc: err.span ? { start: err.span.start, end: err.span.end, line: 0, col: 0 } : undefined,
        }),
    );

    return {
      ...compileResult,
      errors: [...compileResult.errors, ...typeErrors],
      typeInfo,
    };
  });
}

/**
 * Check if a source contains only DSL forms (no kernel evaluation needed).
 */
export function isDSLOnly(source: string, ctx: CompileContext): Effect.Effect<boolean, ParseError> {
  return Effect.gen(function* () {
    const exprs = yield* parseManyToSExpr(source);

    for (const expr of exprs) {
      if (expr._tag === "List" && expr.items.length > 0) {
        const head = expr.items[0];
        if (head?._tag === "Sym" && ctx.hasHandler(head.name)) {
          continue;
        }
      }
      return false;
    }

    return true;
  });
}

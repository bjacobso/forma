/**
 * Compiler: SExpr → Chunk
 *
 * Walks the SExpr tree and emits bytecode into a Chunk. Resolves variable
 * references to local slots, upvalue indices, or global indices at compile time.
 *
 * Design choices:
 * - The shared kernel frontend expands macros and normalizes destructuring first.
 * - Builtins that take higher-order functions (map, filter) use CALL_BUILTIN.
 * - Arithmetic on exactly 2 args is inlined to ADD/SUB/MUL/DIV opcodes.
 * - The compiler only accepts normalized runtime programs. Compile-time-only
 *   surface forms must be eliminated, executed, or rejected before bytecode
 *   emission.
 */

import type { KernelObserver } from "../evaluator/observation.js";
import type { SExpr } from "../reader/index.js";
import { Env } from "../Env.js";
import { expandKernelExprsSync } from "../evaluator/frontend.js";
import { KernelTypeError } from "../diagnostic/errors.js";
import type { BuiltinFn } from "../evaluator/types.js";
import { Op, type Chunk, newChunk, emit } from "./opcodes.js";
import { CompileScope, GlobalRegistry, BuiltinRegistry } from "./scope.js";
import type { CompileContext } from "./scope.js";
import { compileSExpr, traceOf } from "./compile-core.js";

// Re-export public types from scope.ts
export { GlobalRegistry, BuiltinRegistry } from "./scope.js";

// ---------------------------------------------------------------------------
// Rejected runtime heads
// ---------------------------------------------------------------------------

const VM_REJECTED_RUNTIME_HEADS = new Set([
  "def-macro",
  "define-macro",
  "def",
  "defn",
  "def-effect",
  "define-effect",
  "perform",
  "handle",
  "defclass",
  "unquote",
  "unquote-splicing",
  "deftype",
  "data",
  ":",
  "::",
]);

// ---------------------------------------------------------------------------
// Compiler options and result
// ---------------------------------------------------------------------------

export interface CompileOptions {
  /** Available builtins for CALL_BUILTIN resolution */
  readonly builtins: Record<string, BuiltinFn>;
  /** Optional environment used for macro expansion and initial globals */
  readonly env?: Env;
  /** Skip prelude injection during expansion */
  readonly includePrelude?: boolean;
  /**
   * Indicates the input exprs already passed through the shared expansion
   * frontend and represent a runtime program.
   */
  readonly normalized?: boolean;
  /** Observe author-written expressions. See `ObservationCollector`. */
  readonly observer?: KernelObserver;
}

export interface CompileResult {
  chunk: Chunk;
  globals: GlobalRegistry;
  builtinRegistry: BuiltinRegistry;
}

// ---------------------------------------------------------------------------
// compileProgram — main entry point
// ---------------------------------------------------------------------------

/**
 * Compile a sequence of top-level SExpr nodes into a single VM chunk.
 *
 * This function expects a runtime program. When `normalized` is not set it
 * runs shared expansion first, but it still rejects any compile-time-only
 * forms that survive expansion.
 */
export function compileProgram(exprs: readonly SExpr[], options: CompileOptions): CompileResult {
  const normalizedExprs =
    options.normalized === true
      ? exprs
      : expandKernelExprsSync(exprs, {
          builtins: options.builtins,
          ...(options.env ? { env: options.env } : {}),
          ...(options.includePrelude === false ? { includePrelude: false } : {}),
        }).expanded;
  assertRuntimeCompilable(normalizedExprs);
  const globals = new GlobalRegistry();
  const builtinRegistry = new BuiltinRegistry(options.builtins);
  const chunk = newChunk("<main>", 0);
  const scope = new CompileScope(null);
  const context: CompileContext = {
    ...(options.env ? { env: options.env } : {}),
    ...(options.observer ? { observer: options.observer } : {}),
  };

  predeclareTopLevelGlobals(normalizedExprs, globals);

  for (let i = 0; i < normalizedExprs.length; i++) {
    const isLast = i === normalizedExprs.length - 1;
    compileSExpr(
      normalizedExprs[i]!,
      chunk,
      scope,
      globals,
      builtinRegistry,
      context,
      false,
      isLast,
    );
    if (!isLast) {
      emit(chunk, Op.POP, traceOf(normalizedExprs[i]!));
    }
  }

  emit(
    chunk,
    Op.RETURN,
    normalizedExprs.length > 0 ? traceOf(normalizedExprs[normalizedExprs.length - 1]!) : undefined,
  );
  (chunk as { localCount: number }).localCount = scope.localCount;

  return { chunk, globals, builtinRegistry };
}

// ---------------------------------------------------------------------------
// predeclareTopLevelGlobals
// ---------------------------------------------------------------------------

function predeclareTopLevelGlobals(exprs: readonly SExpr[], globals: GlobalRegistry): void {
  for (const expr of exprs) {
    if (
      expr._tag === "List" &&
      expr.items.length >= 3 &&
      expr.items[0]?._tag === "Sym" &&
      expr.items[0].name === "define"
    ) {
      const nameExpr = expr.items[1]!;
      if (nameExpr._tag === "Sym") {
        globals.resolve(nameExpr.name);
      } else if (nameExpr._tag === "List" && nameExpr.items[0]?._tag === "Sym") {
        globals.resolve(nameExpr.items[0].name);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Runtime compilability assertions
// ---------------------------------------------------------------------------

function assertRuntimeCompilable(exprs: readonly SExpr[]): void {
  let rejected: SExpr | null = null;
  for (const expr of exprs) {
    rejected = findRejectedRuntimeNode(expr);
    if (rejected) {
      break;
    }
  }
  if (!rejected) {
    return;
  }

  if (rejected._tag === "Error") {
    throw new KernelTypeError({
      message: `Parse error node: ${rejected.message}`,
      expected: "normalized runtime program",
      got: "error",
      loc: rejected.loc,
      ...(traceOf(rejected).macroOrigins ? { macroOrigins: traceOf(rejected).macroOrigins } : {}),
    });
  }

  if (rejected._tag === "Set") {
    throw new KernelTypeError({
      message: "Set literals are not supported as runtime values",
      expected: "normalized runtime program",
      got: "set literal",
      loc: rejected.loc,
      ...(traceOf(rejected).macroOrigins ? { macroOrigins: traceOf(rejected).macroOrigins } : {}),
    });
  }

  if (rejected._tag !== "List") {
    throw new KernelTypeError({
      message: "VM compiler encountered a non-runtime expression",
      expected: "normalized runtime program",
      got: rejected._tag,
      loc: rejected.loc,
      ...(traceOf(rejected).macroOrigins ? { macroOrigins: traceOf(rejected).macroOrigins } : {}),
    });
  }

  const head = rejected.items[0];
  const formName = head?._tag === "Sym" ? head.name : "list";
  const trace = traceOf(rejected);
  throw new KernelTypeError({
    message: `VM compiler cannot execute compile-time-only form '${formName}'`,
    expected: "normalized runtime program",
    got: formName,
    loc: rejected.loc,
    ...(trace.macroOrigins ? { macroOrigins: trace.macroOrigins } : {}),
  });
}

function findRejectedRuntimeNode(expr: SExpr, inQuasiquote: boolean = false): SExpr | null {
  switch (expr._tag) {
    case "Set":
    case "Error":
      return expr;
    case "Vector":
      for (const item of expr.items) {
        const rejected = findRejectedRuntimeNode(item, inQuasiquote);
        if (rejected) {
          return rejected;
        }
      }
      return null;
    case "Map":
      for (const [k, v] of expr.pairs) {
        const rejectedKey = findRejectedRuntimeNode(k, inQuasiquote);
        if (rejectedKey) {
          return rejectedKey;
        }
        const rejectedValue = findRejectedRuntimeNode(v, inQuasiquote);
        if (rejectedValue) {
          return rejectedValue;
        }
      }
      return null;
    case "List": {
      const head = expr.items[0];
      if (head?._tag === "Sym" && head.name === "quasiquote") {
        for (let i = 1; i < expr.items.length; i++) {
          const rejected = findRejectedRuntimeNode(expr.items[i]!, true);
          if (rejected) {
            return rejected;
          }
        }
        return null;
      }
      if (head?._tag === "Sym" && VM_REJECTED_RUNTIME_HEADS.has(head.name)) {
        if (inQuasiquote && (head.name === "unquote" || head.name === "unquote-splicing")) {
          return null;
        }
        return expr;
      }
      for (const item of expr.items) {
        const rejected = findRejectedRuntimeNode(item, inQuasiquote);
        if (rejected) {
          return rejected;
        }
      }
      return null;
    }
    case "Num":
    case "Str":
    case "Bool":
    case "Sym":
      return null;
  }
}

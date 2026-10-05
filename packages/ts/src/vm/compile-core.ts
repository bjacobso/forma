/**
 * Core compilation — recursive descent dispatch for SExpr → bytecode.
 */

import type { SExpr } from "../reader/index.js";
import type { SourceTrace } from "../evaluator/source-trace.js";
import { sourceTraceOf } from "../evaluator/source-trace.js";
import { KBuiltin } from "../evaluator/types.js";
import { Op, type Chunk, emit, emitU8, emitU16, addConstant } from "./opcodes.js";
import type { CompileScope, GlobalRegistry, BuiltinRegistry, CompileContext } from "./scope.js";
import {
  compileFn,
  compileLet,
  compileIf,
  compileDo,
  compileMatch,
  compileDef,
} from "./compile-forms.js";
import { compileInstance } from "./compile-effects.js";
import { compileQuasiquote } from "./compile-quasiquote.js";

// ---------------------------------------------------------------------------
// CompileFn callback type
// ---------------------------------------------------------------------------

export type CompileFn = (
  expr: SExpr,
  chunk: Chunk,
  scope: CompileScope,
  globals: GlobalRegistry,
  builtins: BuiltinRegistry,
  ctx: CompileContext,
  tail: boolean,
  isLast: boolean,
) => void;

// ---------------------------------------------------------------------------
// Inlinable arithmetic — 2-arg calls that can be a single opcode
// ---------------------------------------------------------------------------

const INLINE_BINARY: Record<string, Op> = {
  "+": Op.ADD,
  "-": Op.SUB,
  "*": Op.MUL,
  "/": Op.DIV,
  mod: Op.MOD,
  "=": Op.EQ,
  "<": Op.LT,
  ">": Op.GT,
  "<=": Op.LTE,
  ">=": Op.GTE,
};

// ---------------------------------------------------------------------------
// Core compilation — recursive descent
// ---------------------------------------------------------------------------

export function compileSExpr(
  expr: SExpr,
  chunk: Chunk,
  scope: CompileScope,
  globals: GlobalRegistry,
  builtins: BuiltinRegistry,
  context: CompileContext,
  isTailPos: boolean,
  isLast: boolean,
): void {
  const targets = context.observer?.targetsOf(expr);
  if (!targets || targets.length === 0) {
    compileUnobserved(expr, chunk, scope, globals, builtins, context, isTailPos, isLast);
    return;
  }
  // An observed expression leaves tail position so its value returns here.
  compileUnobserved(expr, chunk, scope, globals, builtins, context, false, isLast);
  const trace = traceOf(expr);
  for (const target of targets) {
    emit(chunk, Op.OBSERVE, trace);
    emitU16(chunk, target, trace);
  }
}

function compileUnobserved(
  expr: SExpr,
  chunk: Chunk,
  scope: CompileScope,
  globals: GlobalRegistry,
  builtins: BuiltinRegistry,
  context: CompileContext,
  isTailPos: boolean,
  _isLast: boolean,
): void {
  const trace = traceOf(expr);

  switch (expr._tag) {
    case "Num": {
      const idx = addConstant(chunk, expr.value);
      emit(chunk, Op.CONST, trace);
      emitU16(chunk, idx, trace);
      return;
    }

    case "Str": {
      const idx = addConstant(chunk, expr.value);
      emit(chunk, Op.CONST, trace);
      emitU16(chunk, idx, trace);
      return;
    }

    case "Bool":
      emit(chunk, expr.value ? Op.TRUE : Op.FALSE, trace);
      return;

    case "Sym":
      compileSymbol(expr.name, chunk, scope, globals, builtins, context, trace);
      return;

    case "Vector":
      for (const item of expr.items) {
        compileSExpr(item, chunk, scope, globals, builtins, context, false, false);
      }
      emit(chunk, Op.MAKE_LIST, trace);
      emitU16(chunk, expr.items.length, trace);
      return;

    case "Map":
      for (const [k, v] of expr.pairs) {
        compileSExpr(k, chunk, scope, globals, builtins, context, false, false);
        compileSExpr(v, chunk, scope, globals, builtins, context, false, false);
      }
      emit(chunk, Op.MAKE_MAP, trace);
      emitU16(chunk, expr.pairs.length, trace);
      return;

    case "List":
      compileList(expr.items, chunk, scope, globals, builtins, context, isTailPos, trace);
      return;

    case "Set":
    case "Error":
      // Rejected by assertRuntimeCompilable before bytecode emission.
      emit(chunk, Op.NIL, trace);
      return;
  }
}

// ---------------------------------------------------------------------------
// Symbol compilation
// ---------------------------------------------------------------------------

function compileSymbol(
  name: string,
  chunk: Chunk,
  scope: CompileScope,
  globals: GlobalRegistry,
  builtins: BuiltinRegistry,
  context: CompileContext,
  trace: SourceTrace,
): void {
  // Keywords are self-evaluating strings
  if (name.startsWith(":")) {
    const idx = addConstant(chunk, name);
    emit(chunk, Op.CONST, trace);
    emitU16(chunk, idx, trace);
    return;
  }

  // nil literal
  if (name === "nil") {
    emit(chunk, Op.NIL, trace);
    return;
  }

  // true/false
  if (name === "true") {
    emit(chunk, Op.TRUE, trace);
    return;
  }
  if (name === "false") {
    emit(chunk, Op.FALSE, trace);
    return;
  }

  // Local variable
  const local = scope.resolveLocal(name);
  if (local !== -1) {
    emit(chunk, Op.LOAD_LOCAL, trace);
    emitU8(chunk, local, trace);
    return;
  }

  // Upvalue (captured from enclosing scope)
  const upvalue = scope.resolveUpvalue(name);
  if (upvalue !== -1) {
    emit(chunk, Op.LOAD_UPVALUE, trace);
    emitU8(chunk, upvalue, trace);
    return;
  }

  if (globals.has(name) || context.env?.has(name)) {
    const globalIdx = globals.resolve(name);
    emit(chunk, Op.LOAD_GLOBAL, trace);
    emitU16(chunk, globalIdx, trace);
    return;
  }

  if (builtins.resolve(name) !== -1) {
    const idx = addConstant(chunk, KBuiltin(name));
    emit(chunk, Op.CONST, trace);
    emitU16(chunk, idx, trace);
    return;
  }

  // Global variable
  const globalIdx = globals.resolve(name);
  emit(chunk, Op.LOAD_GLOBAL, trace);
  emitU16(chunk, globalIdx, trace);
}

// ---------------------------------------------------------------------------
// List compilation (special forms + function calls)
// ---------------------------------------------------------------------------

function compileList(
  items: readonly SExpr[],
  chunk: Chunk,
  scope: CompileScope,
  globals: GlobalRegistry,
  builtins: BuiltinRegistry,
  context: CompileContext,
  isTailPos: boolean,
  trace: SourceTrace,
): void {
  if (items.length === 0) {
    // Empty list → empty vector
    emit(chunk, Op.MAKE_LIST, trace);
    emitU16(chunk, 0, trace);
    return;
  }

  const head = items[0]!;

  // Check for special forms
  if (head._tag === "Sym") {
    switch (head.name) {
      case "fn":
        compileFn(items, chunk, scope, globals, builtins, context, trace, compileSExpr);
        return;

      case "let":
        compileLet(items, chunk, scope, globals, builtins, context, isTailPos, trace, compileSExpr);
        return;

      case "if":
        compileIf(items, chunk, scope, globals, builtins, context, isTailPos, trace, compileSExpr);
        return;

      case "do":
        compileDo(items, chunk, scope, globals, builtins, context, isTailPos, trace, compileSExpr);
        return;

      case "match":
        compileMatch(
          items,
          chunk,
          scope,
          globals,
          builtins,
          context,
          isTailPos,
          trace,
          compileSExpr,
        );
        return;

      case "define":
        compileDef(items, chunk, scope, globals, builtins, context, trace, compileSExpr);
        return;

      case "define-typeclass":
      case "define-type":
        emit(chunk, Op.NIL, trace);
        return;

      case "instance":
        compileInstance(items, chunk, scope, globals, builtins, context, trace, compileSExpr);
        return;

      case "quasiquote":
        compileQuasiquote(items, chunk, scope, globals, builtins, context, trace, compileSExpr);
        return;
    }

    const headHasExplicitBinding =
      scope.resolveLocal(head.name) !== -1 ||
      scope.resolveUpvalue(head.name) !== -1 ||
      globals.has(head.name) ||
      context.env?.has(head.name) === true;

    // Check for inlinable binary arithmetic
    const inlineOp = INLINE_BINARY[head.name];
    if (!headHasExplicitBinding && inlineOp !== undefined && items.length === 3) {
      compileSExpr(items[1]!, chunk, scope, globals, builtins, context, false, false);
      compileSExpr(items[2]!, chunk, scope, globals, builtins, context, false, false);
      emit(chunk, inlineOp, trace);
      return;
    }

    // Check if it's a known builtin (variadic arithmetic, string ops, etc.)
    const builtinIdx = builtins.resolve(head.name);
    if (!headHasExplicitBinding && builtinIdx !== -1) {
      // Compile args, then CALL_BUILTIN
      for (let i = 1; i < items.length; i++) {
        compileSExpr(items[i]!, chunk, scope, globals, builtins, context, false, false);
      }
      emit(chunk, Op.CALL_BUILTIN, trace);
      emitU16(chunk, builtinIdx, trace);
      emitU8(chunk, items.length - 1, trace);
      return;
    }
  }

  // General function call: compile callee, compile args, CALL/TAIL_CALL
  compileSExpr(head, chunk, scope, globals, builtins, context, false, false);
  for (let i = 1; i < items.length; i++) {
    compileSExpr(items[i]!, chunk, scope, globals, builtins, context, false, false);
  }
  const argc = items.length - 1;
  if (isTailPos) {
    emit(chunk, Op.TAIL_CALL, trace);
  } else {
    emit(chunk, Op.CALL, trace);
  }
  emitU8(chunk, argc, trace);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function traceOf(expr: SExpr): SourceTrace {
  return sourceTraceOf(expr);
}

/**
 * Special form compilation — fn, let, if, do, match, def.
 */

import type { SExpr } from "../reader/index.js";
import { trySym, headSym } from "../reader/types.js";
import { KernelTypeError } from "../diagnostic/errors.js";
import { compileMatchPattern, type MatchPattern } from "../evaluator/match.js";
import type { SourceTrace } from "../evaluator/source-trace.js";
import {
  Op,
  type Chunk,
  newChunk,
  emit,
  emitU8,
  emitU16,
  addConstant,
  emitJump,
  patchJump,
} from "./opcodes.js";
import { CompileScope } from "./scope.js";
import type { GlobalRegistry, BuiltinRegistry, CompileContext } from "./scope.js";
import type { CompileFn } from "./compile-core.js";
import { traceOf } from "./compile-core.js";

// ---------------------------------------------------------------------------
// fn
// ---------------------------------------------------------------------------

export function compileFn(
  items: readonly SExpr[],
  parentChunk: Chunk,
  scope: CompileScope,
  globals: GlobalRegistry,
  builtins: BuiltinRegistry,
  context: CompileContext,
  trace: SourceTrace,
  compileSExpr: CompileFn,
): void {
  const paramsExpr = items[1];
  if (!paramsExpr || paramsExpr._tag !== "Vector") {
    // Invalid fn form — emit nil (error caught at type-check time)
    emit(parentChunk, Op.NIL, trace);
    return;
  }

  const paramNames: string[] = [];
  let restParam: string | undefined;
  for (let i = 0; i < paramsExpr.items.length; i++) {
    const p = paramsExpr.items[i]!;
    const pName = trySym(p);
    if (!pName) continue;
    if (pName === "&") {
      const nextP = paramsExpr.items[i + 1];
      const nextPName = nextP ? trySym(nextP) : undefined;
      if (!nextPName || i + 2 !== paramsExpr.items.length) {
        emit(parentChunk, Op.NIL, trace);
        return;
      }
      restParam = nextPName;
      break;
    }
    paramNames.push(pName);
  }

  const fnName = `<lambda:${trace.loc.line}>`;
  const funcChunk = newChunk(fnName, paramNames.length, restParam !== undefined);
  const childScope = new CompileScope(scope, paramNames.length + (restParam ? 1 : 0));

  // Parameters are the first N locals
  for (const p of paramNames) {
    childScope.locals.push({
      name: p,
      slot: childScope.locals.length,
      isCaptured: false,
    });
  }
  if (restParam) {
    childScope.locals.push({
      name: restParam,
      slot: childScope.locals.length,
      isCaptured: false,
    });
  }

  // Compile body (possibly multiple forms = implicit do)
  if (items.length === 3) {
    compileSExpr(items[2]!, funcChunk, childScope, globals, builtins, context, true, true);
  } else {
    // Multiple body forms — compile as implicit do
    for (let i = 2; i < items.length; i++) {
      const isLast = i === items.length - 1;
      compileSExpr(items[i]!, funcChunk, childScope, globals, builtins, context, isLast, isLast);
      if (!isLast) {
        emit(funcChunk, Op.POP, traceOf(items[i]!));
      }
    }
  }

  emit(funcChunk, Op.RETURN, trace);
  (funcChunk as { localCount: number }).localCount = childScope.localCount;
  (funcChunk as { upvalueCount: number }).upvalueCount = childScope.upvalues.length;

  // Add the function chunk to parent
  const funcIdx = parentChunk.functions.length;
  (parentChunk.functions as Chunk[]).push(funcChunk);

  // Emit CLOSURE instruction
  emit(parentChunk, Op.CLOSURE, trace);
  emitU16(parentChunk, funcIdx, trace);
  emitU8(parentChunk, childScope.upvalues.length, trace);

  // Emit upvalue capture descriptors
  for (const uv of childScope.upvalues) {
    emitU8(parentChunk, uv.isLocal ? 1 : 0, trace);
    emitU8(parentChunk, uv.index, trace);
  }
}

// ---------------------------------------------------------------------------
// Zero-arg closure (used by quasiquote)
// ---------------------------------------------------------------------------

export function compileZeroArgClosure(
  expr: SExpr,
  parentChunk: Chunk,
  scope: CompileScope,
  globals: GlobalRegistry,
  builtins: BuiltinRegistry,
  context: CompileContext,
  trace: SourceTrace,
  compileSExpr: CompileFn,
): void {
  const fnName = `<qq:${trace.loc.line}>`;
  const funcChunk = newChunk(fnName, 0);
  const childScope = new CompileScope(scope, 0);
  compileSExpr(expr, funcChunk, childScope, globals, builtins, context, true, true);
  emit(funcChunk, Op.RETURN, trace);
  (funcChunk as { localCount: number }).localCount = childScope.localCount;
  (funcChunk as { upvalueCount: number }).upvalueCount = childScope.upvalues.length;

  const funcIdx = parentChunk.functions.length;
  (parentChunk.functions as Chunk[]).push(funcChunk);

  emit(parentChunk, Op.CLOSURE, trace);
  emitU16(parentChunk, funcIdx, trace);
  emitU8(parentChunk, childScope.upvalues.length, trace);
  for (const uv of childScope.upvalues) {
    emitU8(parentChunk, uv.isLocal ? 1 : 0, trace);
    emitU8(parentChunk, uv.index, trace);
  }
}

// ---------------------------------------------------------------------------
// let
// ---------------------------------------------------------------------------

export function compileLet(
  items: readonly SExpr[],
  chunk: Chunk,
  scope: CompileScope,
  globals: GlobalRegistry,
  builtins: BuiltinRegistry,
  context: CompileContext,
  isTailPos: boolean,
  trace: SourceTrace,
  compileSExpr: CompileFn,
): void {
  const bindingsExpr = items[1];
  if (!bindingsExpr || bindingsExpr._tag !== "Vector") {
    emit(chunk, Op.NIL, trace);
    return;
  }

  // Track how many locals we add so we can clean up
  const localsBefore = scope.locals.length;

  // Compile bindings: pairs of [name value]
  for (let i = 0; i < bindingsExpr.items.length; i += 2) {
    const nameSym = bindingsExpr.items[i];
    const valExpr = bindingsExpr.items[i + 1];
    if (!nameSym || !valExpr) break;

    // Compile the value
    compileSExpr(valExpr, chunk, scope, globals, builtins, context, false, false);

    const letBindName = trySym(nameSym);
    if (letBindName) {
      // Allocate a local slot and store the value
      const slot = scope.addLocal(letBindName);
      emit(chunk, Op.STORE_LOCAL, trace);
      emitU8(chunk, slot, trace);
      emit(chunk, Op.POP, trace);
    } else {
      // Unsupported destructuring in bytecode — emit store to a dummy slot
      emit(chunk, Op.POP, trace);
    }
  }

  // Compile body forms (implicit do for multiple body forms)
  if (items.length === 3) {
    compileSExpr(items[2]!, chunk, scope, globals, builtins, context, isTailPos, true);
  } else {
    for (let i = 2; i < items.length; i++) {
      const isLast = i === items.length - 1;
      compileSExpr(
        items[i]!,
        chunk,
        scope,
        globals,
        builtins,
        context,
        isLast && isTailPos,
        isLast,
      );
      if (!isLast) {
        emit(chunk, Op.POP, traceOf(items[i]!));
      }
    }
  }

  // Pop locals (let scope ended)
  // We don't actually pop — locals stay on stack until function returns.
  // But we remove them from the scope so they can't be referenced.
  scope.locals.length = localsBefore;
}

// ---------------------------------------------------------------------------
// if
// ---------------------------------------------------------------------------

export function compileIf(
  items: readonly SExpr[],
  chunk: Chunk,
  scope: CompileScope,
  globals: GlobalRegistry,
  builtins: BuiltinRegistry,
  context: CompileContext,
  isTailPos: boolean,
  trace: SourceTrace,
  compileSExpr: CompileFn,
): void {
  // Compile condition
  compileSExpr(items[1]!, chunk, scope, globals, builtins, context, false, false);

  // Jump to else if false
  const jumpToElse = emitJump(chunk, Op.JUMP_IF_FALSE, trace);

  // Compile then branch
  compileSExpr(items[2]!, chunk, scope, globals, builtins, context, isTailPos, true);

  // Jump over else branch
  const jumpOverElse = emitJump(chunk, Op.JUMP, trace);

  // Patch the jump-to-else
  patchJump(chunk, jumpToElse);

  // Compile else branch (or nil if absent)
  if (items.length >= 4) {
    compileSExpr(items[3]!, chunk, scope, globals, builtins, context, isTailPos, true);
  } else {
    emit(chunk, Op.NIL, trace);
  }

  // Patch the jump-over-else
  patchJump(chunk, jumpOverElse);
}

// ---------------------------------------------------------------------------
// do
// ---------------------------------------------------------------------------

export function compileDo(
  items: readonly SExpr[],
  chunk: Chunk,
  scope: CompileScope,
  globals: GlobalRegistry,
  builtins: BuiltinRegistry,
  context: CompileContext,
  isTailPos: boolean,
  trace: SourceTrace,
  compileSExpr: CompileFn,
): void {
  if (items.length === 1) {
    emit(chunk, Op.NIL, trace);
    return;
  }
  for (let i = 1; i < items.length; i++) {
    const isLast = i === items.length - 1;
    compileSExpr(items[i]!, chunk, scope, globals, builtins, context, isLast && isTailPos, isLast);
    if (!isLast) {
      emit(chunk, Op.POP, traceOf(items[i]!));
    }
  }
}

// ---------------------------------------------------------------------------
// match
// ---------------------------------------------------------------------------

export function compileMatch(
  items: readonly SExpr[],
  chunk: Chunk,
  scope: CompileScope,
  globals: GlobalRegistry,
  builtins: BuiltinRegistry,
  context: CompileContext,
  isTailPos: boolean,
  trace: SourceTrace,
  compileSExpr: CompileFn,
): void {
  if (items.length < 4 || (items.length - 2) % 2 !== 0) {
    throw new KernelTypeError({
      message: "match requires a scrutinee followed by pattern/body pairs",
      expected: "scrutinee and pattern/body pairs",
      got: `${Math.max(items.length - 1, 0)} form(s)`,
      loc: trace.loc,
      ...(trace.macroOrigins ? { macroOrigins: trace.macroOrigins } : {}),
    });
  }

  const localsBeforeMatch = scope.locals.length;

  compileSExpr(items[1]!, chunk, scope, globals, builtins, context, false, false);
  const scrutineeSlot = scope.addLocal(`__match_scrutinee_${scope.localCount}`);
  emit(chunk, Op.STORE_LOCAL, traceOf(items[1]!));
  emitU8(chunk, scrutineeSlot, traceOf(items[1]!));
  emit(chunk, Op.POP, traceOf(items[1]!));

  const jumpToEndOffsets: number[] = [];

  for (let i = 2; i < items.length; i += 2) {
    const patternExpr = items[i]!;
    const bodyExpr = items[i + 1]!;
    const localsBeforeArm = scope.locals.length;
    const compiledPattern = compileMatchPattern(patternExpr, traceOf(patternExpr));
    const registerConstructors = (pattern: MatchPattern): void => {
      if (pattern._tag === "Constructor") globals.resolve(`__constructor/${pattern.name}`);
      if (pattern._tag === "Constructor" || pattern._tag === "Seq") {
        pattern.items.forEach(registerConstructors);
        if (pattern._tag === "Seq" && pattern.rest) registerConstructors(pattern.rest);
      } else if (pattern._tag === "Map") {
        pattern.entries.forEach(entry => registerConstructors(entry.pattern));
        if (pattern.as) registerConstructors(pattern.as);
      }
    };
    registerConstructors(compiledPattern.pattern);
    const bindingSlots = compiledPattern.bindingNames.map((name) => scope.addLocal(name));

    emit(chunk, Op.LOAD_LOCAL, traceOf(patternExpr));
    emitU8(chunk, scrutineeSlot, traceOf(patternExpr));
    emit(chunk, Op.MATCH, traceOf(patternExpr));
    emitU16(chunk, addConstant(chunk, compiledPattern), traceOf(patternExpr));
    emitU8(chunk, bindingSlots.length, traceOf(patternExpr));
    for (const slot of bindingSlots) {
      emitU8(chunk, slot, traceOf(patternExpr));
    }

    const jumpToNextArm = emitJump(chunk, Op.JUMP_IF_FALSE, traceOf(patternExpr));
    compileSExpr(bodyExpr, chunk, scope, globals, builtins, context, isTailPos, true);
    jumpToEndOffsets.push(emitJump(chunk, Op.JUMP, traceOf(bodyExpr)));
    patchJump(chunk, jumpToNextArm);
    scope.locals.length = localsBeforeArm;
  }

  emit(chunk, Op.MATCH_FAILURE, trace);
  for (const offset of jumpToEndOffsets) {
    patchJump(chunk, offset);
  }
  scope.locals.length = localsBeforeMatch;
}

// ---------------------------------------------------------------------------
// define
// ---------------------------------------------------------------------------

export function compileDef(
  items: readonly SExpr[],
  chunk: Chunk,
  scope: CompileScope,
  globals: GlobalRegistry,
  builtins: BuiltinRegistry,
  context: CompileContext,
  trace: SourceTrace,
  compileSExpr: CompileFn,
): void {
  const nameExpr = items[1];
  if (!nameExpr) {
    emit(chunk, Op.NIL, trace);
    return;
  }

  let globalName: string | undefined;
  let valueExpr: SExpr | undefined;

  const defName = trySym(nameExpr);
  if (defName) {
    globalName = defName;
    valueExpr = items[2];
  } else if ((globalName = headSym(nameExpr))) {
    const headItems = (nameExpr as SExpr & { items: readonly SExpr[] }).items;
    valueExpr = {
      _tag: "List",
      items: [
        { _tag: "Sym", name: "fn", loc: nameExpr.loc },
        { _tag: "Vector", items: headItems.slice(1), loc: nameExpr.loc },
        ...items.slice(2),
      ],
      loc: nameExpr.loc,
    };
  }

  if (!globalName || !valueExpr) {
    emit(chunk, Op.NIL, trace);
    return;
  }

  const globalIdx = globals.resolve(globalName);

  compileSExpr(valueExpr, chunk, scope, globals, builtins, context, false, false);

  emit(chunk, Op.STORE_GLOBAL, trace);
  emitU16(chunk, globalIdx, trace);

  emit(chunk, Op.LOAD_GLOBAL, trace);
  emitU16(chunk, globalIdx, trace);
}

/**
 * Typeclass instance compilation.
 */

import type { SExpr } from "../reader/index.js";
import type { SourceTrace } from "../evaluator/source-trace.js";
import { Op, type Chunk, emit, emitU8, emitU16, addConstant } from "./opcodes.js";
import type { CompileScope, GlobalRegistry, BuiltinRegistry, CompileContext } from "./scope.js";
import type { CompileFn } from "./compile-core.js";

export function compileInstance(
  items: readonly SExpr[],
  chunk: Chunk,
  scope: CompileScope,
  globals: GlobalRegistry,
  builtins: BuiltinRegistry,
  context: CompileContext,
  trace: SourceTrace,
  compileSExpr: CompileFn,
): void {
  let headerIndex = 1;
  if (items[headerIndex]?._tag === "Vector") {
    headerIndex++;
  }

  const headerExpr = items[headerIndex];
  if (!headerExpr || headerExpr._tag !== "List" || headerExpr.items.length < 2) {
    emit(chunk, Op.NIL, trace);
    return;
  }

  const classNameExpr = headerExpr.items[0];
  if (!classNameExpr || classNameExpr._tag !== "Sym") {
    emit(chunk, Op.NIL, trace);
    return;
  }

  const canonicalRuntimeTypeName = (name: string): string => {
    switch (name) {
      case "Number":
      case "Num":
        return "Float";
      case "Str":
        return "String";
      case "Bool":
        return "Boolean";
      case "Nil":
        return "Unit";
      default:
        return name;
    }
  };

  const typeExpr = headerExpr.items[1];
  let typeName: string | null = null;
  if (typeExpr?._tag === "Sym") {
    typeName = canonicalRuntimeTypeName(typeExpr.name);
  } else if (
    typeExpr?._tag === "List" &&
    typeExpr.items.length > 0 &&
    typeExpr.items[0]?._tag === "Sym"
  ) {
    typeName = canonicalRuntimeTypeName(typeExpr.items[0].name);
  }

  if (!typeName) {
    emit(chunk, Op.NIL, trace);
    return;
  }

  const methods: Array<{ name: string; globalIdx: number }> = [];
  for (let i = headerIndex + 1; i < items.length; i++) {
    const methodExpr = items[i];
    if (!methodExpr || methodExpr._tag !== "List" || methodExpr.items.length !== 3) {
      continue;
    }
    const defSym = methodExpr.items[0];
    const methodNameSym = methodExpr.items[1];
    if (defSym?._tag !== "Sym" || defSym.name !== "define" || methodNameSym?._tag !== "Sym") {
      continue;
    }

    compileSExpr(methodExpr.items[2]!, chunk, scope, globals, builtins, context, false, false);
    methods.push({
      name: methodNameSym.name,
      globalIdx: globals.resolve(methodNameSym.name),
    });
  }

  emit(chunk, Op.REGISTER_INSTANCE, trace);
  emitU16(chunk, addConstant(chunk, classNameExpr.name), trace);
  emitU16(chunk, addConstant(chunk, typeName), trace);
  emitU8(chunk, methods.length, trace);
  for (const method of methods) {
    emitU16(chunk, addConstant(chunk, method.name), trace);
    emitU16(chunk, method.globalIdx, trace);
  }
}

import { isKFloat, printFloat } from "./types.js";
/**
 * Quasiquote Evaluation
 *
 * Implements quasiquote/unquote/unquote-splicing for the Lisp macro system.
 *
 * Quasiquote walks an SExpr template and:
 * - Leaves most nodes as-is (returned as KSExpr)
 * - Evaluates (unquote expr) and converts the result to SExpr
 * - Evaluates (unquote-splicing expr) and splices the list result into the parent
 *
 * @module
 */

import { Effect, Ref } from "effect";
import type { SExpr, Loc } from "../reader/types.js";
import * as T from "../reader/types.js";
import { Env } from "../Env.js";
import type { KernelError } from "../diagnostic/errors.js";
import { KernelTypeError } from "../diagnostic/errors.js";
import type { KValue, BuiltinFn } from "./types.js";
import { isKList, isKSExpr, isKKeyword, isKSymbol, mapKeyValue } from "./types.js";

/** Synthetic loc for generated nodes */
const synLoc: Loc = { start: 0, end: 0, line: 1, col: 1 };

/**
 * Evaluate a quasiquoted expression.
 *
 * Returns a KSExpr wrapping the expanded template.
 */
export function evalQuasiquote(
  template: SExpr,
  env: Env,
  builtins: Record<string, BuiltinFn>,
  counter: Ref.Ref<number>,
  stepLimit: number,
  evalExpr: (
    expr: SExpr,
    env: Env,
    builtins: Record<string, BuiltinFn>,
    counter: Ref.Ref<number>,
    stepLimit: number,
  ) => Effect.Effect<KValue, KernelError>,
): Effect.Effect<SExpr, KernelError> {
  return expandQQ(template, env, builtins, counter, stepLimit, evalExpr);
}

export function evalQuasiquoteTemplate(
  template: SExpr,
  evalNext: (kind: "unquote" | "splice", loc: Loc) => Effect.Effect<KValue, KernelError>,
): Effect.Effect<SExpr, KernelError> {
  return expandQQTemplate(template, evalNext);
}

function expandQQ(
  expr: SExpr,
  env: Env,
  builtins: Record<string, BuiltinFn>,
  counter: Ref.Ref<number>,
  stepLimit: number,
  evalExpr: (
    expr: SExpr,
    env: Env,
    builtins: Record<string, BuiltinFn>,
    counter: Ref.Ref<number>,
    stepLimit: number,
  ) => Effect.Effect<KValue, KernelError>,
): Effect.Effect<SExpr, KernelError> {
  return Effect.gen(function* () {
    // Check for (unquote expr)
    if (expr._tag === "List" && expr.items.length === 2) {
      const head = expr.items[0];
      if (head?._tag === "Sym" && head.name === "unquote") {
        const val = yield* evalExpr(expr.items[1]!, env, builtins, counter, stepLimit);
        return kValueToSExpr(val);
      }
    }

    // Recurse into lists — handle unquote-splicing
    if (expr._tag === "List") {
      const expanded: SExpr[] = [];
      for (const item of expr.items) {
        if (
          item._tag === "List" &&
          item.items.length === 2 &&
          item.items[0]?._tag === "Sym" &&
          item.items[0].name === "unquote-splicing"
        ) {
          const val = yield* evalExpr(item.items[1]!, env, builtins, counter, stepLimit);
          expanded.push(...(yield* spliceValueToSExprs(val, item.loc)));
        } else {
          expanded.push(yield* expandQQ(item, env, builtins, counter, stepLimit, evalExpr));
        }
      }
      return T.List(expanded, expr.loc);
    }

    // Recurse into vectors
    if (expr._tag === "Vector") {
      const expanded: SExpr[] = [];
      for (const item of expr.items) {
        if (
          item._tag === "List" &&
          item.items.length === 2 &&
          item.items[0]?._tag === "Sym" &&
          item.items[0].name === "unquote-splicing"
        ) {
          const val = yield* evalExpr(item.items[1]!, env, builtins, counter, stepLimit);
          expanded.push(...(yield* spliceValueToSExprs(val, item.loc)));
        } else {
          expanded.push(yield* expandQQ(item, env, builtins, counter, stepLimit, evalExpr));
        }
      }
      return T.Vector(expanded, expr.loc);
    }

    if (expr._tag === "Map") {
      const pairs: [SExpr, SExpr][] = [];
      for (const [key,value] of expr.pairs) pairs.push([
        yield* expandQQ(key,env,builtins,counter,stepLimit,evalExpr),
        yield* expandQQ(value,env,builtins,counter,stepLimit,evalExpr),
      ]);
      return T.SMap(pairs,expr.loc);
    }
    // Atoms pass through unchanged
    return expr;
  });
}

function expandQQTemplate(
  expr: SExpr,
  evalNext: (kind: "unquote" | "splice", loc: Loc) => Effect.Effect<KValue, KernelError>,
): Effect.Effect<SExpr, KernelError> {
  return Effect.gen(function* () {
    if (expr._tag === "List" && expr.items.length === 2) {
      const head = expr.items[0];
      if (head?._tag === "Sym" && head.name === "unquote") {
        return kValueToSExpr(yield* evalNext("unquote", expr.loc));
      }
    }

    if (expr._tag === "List") {
      const expanded: SExpr[] = [];
      for (const item of expr.items) {
        if (
          item._tag === "List" &&
          item.items.length === 2 &&
          item.items[0]?._tag === "Sym" &&
          item.items[0].name === "unquote-splicing"
        ) {
          expanded.push(
            ...(yield* spliceValueToSExprs(yield* evalNext("splice", item.loc), item.loc)),
          );
        } else {
          expanded.push(yield* expandQQTemplate(item, evalNext));
        }
      }
      return T.List(expanded, expr.loc);
    }

    if (expr._tag === "Vector") {
      const expanded: SExpr[] = [];
      for (const item of expr.items) {
        if (
          item._tag === "List" &&
          item.items.length === 2 &&
          item.items[0]?._tag === "Sym" &&
          item.items[0].name === "unquote-splicing"
        ) {
          expanded.push(
            ...(yield* spliceValueToSExprs(yield* evalNext("splice", item.loc), item.loc)),
          );
        } else {
          expanded.push(yield* expandQQTemplate(item, evalNext));
        }
      }
      return T.Vector(expanded, expr.loc);
    }

    if (expr._tag === "Map") {
      const expandedPairs: [SExpr, SExpr][] = [];
      for (const [k, v] of expr.pairs) {
        expandedPairs.push([
          yield* expandQQTemplate(k, evalNext),
          yield* expandQQTemplate(v, evalNext),
        ]);
      }
      return T.SMap(expandedPairs, expr.loc);
    }

    return expr;
  });
}

function spliceValueToSExprs(val: KValue, loc: Loc): Effect.Effect<readonly SExpr[], KernelError> {
  return Effect.gen(function* () {
    if (isKSExpr(val)) {
      const inner = val.expr;
      if (inner._tag === "Vector" || inner._tag === "List") {
        return inner.items;
      }
      return yield* new KernelTypeError({
        message: "unquote-splicing requires a list or vector",
        expected: "list",
        got: inner._tag,
        loc,
      });
    }
    if (isKList(val)) {
      return val.map(kValueToSExpr);
    }
    return yield* new KernelTypeError({
      message: "unquote-splicing requires a list",
      expected: "list",
      got: typeof val,
      loc,
    });
  });
}

/**
 * Convert a KValue to an SExpr node.
 *
 * Used by quasiquote to embed evaluated results back into templates.
 */
export function kValueToSExpr(value: KValue): SExpr {
  if (isKKeyword(value) || isKSymbol(value)) return T.Sym(value.name,synLoc);
  if (value === null) return T.Sym("nil", synLoc);
  if (typeof value === "boolean") return T.Bool(value, synLoc);
  if (isKFloat(value)) return T.Num(value.value, synLoc, "float");
  if (typeof value === "number") return T.Num(value, synLoc, "int");
  if (typeof value === "string") {
    return T.Str(value, synLoc);
  }
  if (Array.isArray(value)) {
    return T.Vector((value as readonly KValue[]).map(kValueToSExpr), synLoc);
  }
  if (value instanceof Map) {
    const pairs: [SExpr, SExpr][] = [];
    for (const [k, v] of value as ReadonlyMap<string, KValue>) {
      pairs.push([kValueToSExpr(mapKeyValue(k)), kValueToSExpr(v)]);
    }
    return T.SMap(pairs, synLoc);
  }
  // KSExpr — unwrap
  if (typeof value === "object" && "_tag" in value && value._tag === "KSExpr") {
    return value.expr;
  }
  // KFn, KMacro — can't represent
  return T.Sym("nil", synLoc);
}

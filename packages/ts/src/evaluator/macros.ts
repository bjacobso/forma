import { Effect } from "effect";
import type { SExpr, Loc } from "../reader/index.js";
import { trySym } from "../reader/types.js";
import { KernelTypeError, ArityError } from "../diagnostic/errors.js";
import type { KernelError } from "../diagnostic/errors.js";
import { Env } from "../Env.js";
import { evalQuasiquote } from "./quasiquote.js";
import { copyExpansion, tagExpandedExpr } from "./source-trace.js";
import type { KValue, KMacro } from "./types.js";
import { isKSExpr } from "./types.js";
import { authorNames } from "../diagnostic/diagnostic.js";
import type { EvaluatorRuntime, EvalFn } from "./eval-types.js";

// ---------------------------------------------------------------------------
// Macros
// ---------------------------------------------------------------------------

export function evalDefMacro(
  items: readonly SExpr[],
  loc: Loc,
  env: Env,
): Effect.Effect<KValue, KernelError> {
  if (items.length < 4) {
    return Effect.fail(
      new ArityError({ name: "__macro", expected: "3+", got: items.length - 1, loc }),
    );
  }
  const nameSym = items[1]!;
  const macroName = trySym(nameSym);
  if (!macroName) {
    return Effect.fail(
      new KernelTypeError({
        message: "__macro name must be a symbol",
        expected: "symbol",
        got: nameSym._tag,
        loc: nameSym.loc,
      }),
    );
  }
  const paramsExpr = items[2]!;
  if (paramsExpr._tag !== "Vector") {
    return Effect.fail(
      new KernelTypeError({
        message: "__macro params must be a vector",
        expected: "vector",
        got: paramsExpr._tag,
        loc: paramsExpr.loc,
      }),
    );
  }
  const params: string[] = [];
  let restParam: string | undefined;
  for (let i = 0; i < paramsExpr.items.length; i++) {
    const p = paramsExpr.items[i]!;
    const pName = trySym(p);
    if (!pName) {
      return Effect.fail(
        new KernelTypeError({
          message: "__macro param must be a symbol",
          expected: "symbol",
          got: p._tag,
          loc: p.loc,
        }),
      );
    }
    if (pName === "&") {
      const nextP = paramsExpr.items[i + 1];
      const nextPName = nextP ? trySym(nextP) : undefined;
      if (!nextPName) {
        return Effect.fail(
          new KernelTypeError({
            message: "& must be followed by a rest parameter name",
            expected: "symbol",
            got: nextP?._tag ?? "nothing",
            loc: p.loc,
          }),
        );
      }
      restParam = nextPName;
      break;
    }
    params.push(pName);
  }
  const body: SExpr =
    items.length === 4
      ? items[3]!
      : {
          _tag: "List" as const,
          items: [{ _tag: "Sym" as const, name: "do", loc }, ...items.slice(3)],
          loc,
        };
  const macro: KMacro = {
    _tag: "KMacro",
    name: macroName,
    params,
    ...(restParam != null ? { restParam } : {}),
    body,
    closure: env,
  };
  return Effect.succeed(macro);
}

// ---------------------------------------------------------------------------
// Macro application
// ---------------------------------------------------------------------------

/**
 * Whether a macro returned its own call unchanged. Such a macro declines the
 * call, which keeps the core meaning of its head: a library macro named `do`
 * can claim `(do (bind x eff) ...)` and leave a plain `(do a b)` to the core
 * form, instead of expanding it again forever. The expander and the
 * compile-time evaluator both apply this rule.
 */
export function declinesCall(head: SExpr, args: readonly SExpr[], result: SExpr): boolean {
  return result._tag === "List" &&
    result.items.length === args.length + 1 &&
    result.items[0]?._tag === "Sym" && head._tag === "Sym" && result.items[0].name === head.name &&
    result.items.every((item, index) => index === 0 || item === args[index - 1] || item.loc === args[index - 1]!.loc);
}

export function applyMacro(
  macro: KMacro,
  argExprs: readonly SExpr[],
  callerEnv: Env,
  runtime: EvaluatorRuntime,
  callLoc: Loc,
  evalExpr: EvalFn,
  head?: SExpr,
): Effect.Effect<KValue, KernelError> {
  return Effect.gen(function* () {
    if (macro.restParam) {
      if (argExprs.length < macro.params.length) {
        return yield* new ArityError({
          name: macro.name,
          expected: `${macro.params.length}+`,
          got: argExprs.length,
        });
      }
    } else {
      if (argExprs.length !== macro.params.length) {
        return yield* new ArityError({
          name: macro.name,
          expected: macro.params.length,
          got: argExprs.length,
        });
      }
    }

    const bindings: Record<string, KValue> = {};
    for (let i = 0; i < macro.params.length; i++) {
      bindings[macro.params[i]!] = { _tag: "KSExpr" as const, expr: argExprs[i]! };
    }
    if (macro.restParam) {
      const restArgs: KValue[] = [];
      for (let i = macro.params.length; i < argExprs.length; i++) {
        restArgs.push({ _tag: "KSExpr" as const, expr: argExprs[i]! });
      }
      bindings[macro.restParam] = restArgs;
    }
    const macroEnv = macro.closure.extend(bindings);

    const result = yield* evalExpr(macro.body, macroEnv, runtime);

    if (isKSExpr(result)) {
      // Declined: evaluate the call under the head's core meaning.
      if (head?._tag === "Sym" && declinesCall(head, argExprs, result.expr)) {
        const core = { ...head, name: authorNames(head.name) };
        return yield* evalExpr({ _tag: "List", items: [core, ...argExprs], loc: callLoc }, callerEnv, runtime);
      }
      const expanded = copyExpansion(result.expr, argExprs);
      tagExpandedExpr(expanded, { macroName: macro.name, loc: callLoc }, argExprs);
      return yield* evalExpr(expanded, callerEnv, runtime);
    }

    return result;
  });
}

// ---------------------------------------------------------------------------
// Quasiquote
// ---------------------------------------------------------------------------

export function evalQuasiquoteForm(
  items: readonly SExpr[],
  loc: Loc,
  env: Env,
  runtime: EvaluatorRuntime,
  evalExpr: EvalFn,
): Effect.Effect<KValue, KernelError> {
  return Effect.gen(function* () {
    if (items.length !== 2) {
      return yield* new ArityError({ name: "quasiquote", expected: 1, got: items.length - 1, loc });
    }
    const expanded = yield* evalQuasiquote(
      items[1]!,
      env,
      runtime.builtins,
      runtime.counter,
      runtime.stepLimit,
      (nestedExpr, nestedEnv, builtins, counter, stepLimit) =>
        evalExpr(nestedExpr, nestedEnv, {
          ...runtime,
          builtins,
          counter,
          stepLimit,
        }),
    );
    return { _tag: "KSExpr" as const, expr: expanded };
  });
}

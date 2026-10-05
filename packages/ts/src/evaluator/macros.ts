import { Effect } from "effect";
import type { SExpr, Loc } from "../reader/index.js";
import { trySym } from "../reader/types.js";
import { KernelTypeError, ArityError } from "../diagnostic/errors.js";
import type { KernelError } from "../diagnostic/errors.js";
import { Env } from "../Env.js";
import { evalQuasiquote } from "./quasiquote.js";
import { emitExpansion } from "../expander/provenance.js";
import type { KValue, KMacro } from "./types.js";
import { isKSExpr } from "./types.js";
import type { EvaluatorRuntime, EvalFn } from "./eval-types.js";
import { getTcoTail, setTcoTail } from "./eval-types.js";

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
      new ArityError({ name: "define-macro", expected: "3+", got: items.length - 1, loc }),
    );
  }
  const nameSym = items[1]!;
  const macroName = trySym(nameSym);
  if (!macroName) {
    return Effect.fail(
      new KernelTypeError({
        message: "define-macro name must be a symbol",
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
        message: "define-macro params must be a vector",
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
          message: "define-macro param must be a symbol",
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
 * Expand and evaluate a macro call the expander did not see. The expansion is
 * a fresh tree with provenance, as the expander's are, and the macro body
 * runs unobserved: it is expansion-time code, not the author's expression.
 */
export function applyMacro(
  macro: KMacro,
  call: SExpr & { readonly _tag: "List" },
  callerEnv: Env,
  runtime: EvaluatorRuntime,
  evalExpr: EvalFn,
): Effect.Effect<KValue, KernelError> {
  return Effect.gen(function* () {
    const argExprs = call.items.slice(1);
    if (macro.restParam) {
      if (argExprs.length < macro.params.length) {
        return yield* new ArityError({
          name: macro.name,
          expected: `${macro.params.length}+`,
          got: argExprs.length,
          loc: call.loc,
        });
      }
    } else {
      if (argExprs.length !== macro.params.length) {
        return yield* new ArityError({
          name: macro.name,
          expected: macro.params.length,
          got: argExprs.length,
          loc: call.loc,
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

    const { observer: _observer, ...expansionRuntime } = runtime;
    const prevTail = getTcoTail();
    setTcoTail(false);
    const result = yield* evalExpr(macro.body, macroEnv, expansionRuntime).pipe(
      Effect.ensuring(Effect.sync(() => setTcoTail(prevTail))),
      Effect.mapError((error) => {
        runtime.observer?.expansionFailed?.(call);
        return error;
      }),
    );

    if (isKSExpr(result)) {
      const expansion = emitExpansion(call, macro.name, argExprs, result.expr);
      const observer = runtime.observer;
      if (!observer) return yield* evalExpr(expansion, callerEnv, runtime);
      // The surrounding evalExpr already observes this runtime call. Its
      // expansion still carries the call's provenance, but only arguments
      // and nested author expressions should be counted while evaluating it.
      const handled = new Set(observer.targetsOf(call));
      return yield* evalExpr(expansion, callerEnv, {
        ...runtime,
        observer: {
          targetsOf: (expr) => observer.targetsOf(expr).filter((target) => !handled.has(target)),
          observe: observer.observe.bind(observer),
          ...(observer.expansionFailed
            ? { expansionFailed: observer.expansionFailed.bind(observer) }
            : {}),
        },
      });
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
    // An unquoted expression is never in tail position: its value is embedded
    // in the template, so a self call there must not become a tail call.
    const prevTail = getTcoTail();
    setTcoTail(false);
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
    setTcoTail(prevTail);
    return { _tag: "KSExpr" as const, expr: expanded };
  });
}

import { Effect, Layer, Ref } from "effect";
import type { SExpr } from "../reader/index.js";
import { ParseError, parse, toSExprMany } from "../reader/index.js";
import { ObservationCollector, type ObservationOptions } from "./observation.js";
import { Env } from "../Env.js";
import { getPreludeEnvSync } from "../expander/expand.js";
import { expandKernelExprsSync, parseAndExpandKernelSource } from "./frontend.js";
import { withKernelSourceTrace } from "../diagnostic/errors.js";
import type { KernelError } from "../diagnostic/errors.js";
import { sourceTraceOf } from "./source-trace.js";
import { compileProgram, runChunkWithStats } from "../vm/index.js";
import type { KValue, KMacro, BuiltinFn, KernelOptions, KernelResult } from "./types.js";
// (runtime type guards used by evaluateCompileTimeExprs are inlined or delegated)
import { PreludeEnv } from "../expander/prelude.js";

import type { EvaluatorRuntime } from "./eval-types.js";
import { evalExpr, applyKFn, toKernelError } from "./eval-core.js";
import { evalInstance } from "./instances.js";
import {
  requiresEvaluatorRuntime,
  buildVMGlobals,
  buildRuntimeEnvFromGlobals,
  checkCanonicalPublicSyntax,
} from "./vm-bridge.js";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create the PreludeEnv layer by evaluating the prelude source.
 *
 * The layer is memoized by Effect when used with `Effect.provide`.
 * Callers should create one layer and reuse it across evaluations.
 *
 * @param builtins The builtins to use when evaluating the prelude macros.
 *   Defaults to `defaultBuiltins`.
 */
export function makePreludeLayer(
  builtins: Record<string, BuiltinFn> = {},
): Layer.Layer<PreludeEnv, KernelError | ParseError> {
  return Layer.effect(
    PreludeEnv,
    Effect.try({
      try: () => getPreludeEnvSync(builtins),
      catch: (error) => {
        if (error instanceof ParseError) {
          return error;
        }
        return toKernelError(error);
      },
    }),
  );
}

/**
 * Evaluate a source string through the VM-first runtime facade.
 *
 * The source is parsed, expanded through the shared frontend, then executed by
 * the VM when the expanded program is inside the VM runtime subset. The
 * evaluator remains the fallback only for evaluator-executable runtime forms
 * that the VM still intentionally rejects.
 *
 * Requires the `PreludeEnv` service (prelude macros are loaded as the base
 * environment). Use `makePreludeLayer` to create the layer.
 */
export function evaluate(
  source: string,
  options: KernelOptions,
): Effect.Effect<KernelResult, KernelError | ParseError, PreludeEnv> {
  return Effect.gen(function* () {
    const frontend = yield* parseAndExpandKernelSource(source, {
      builtins: options.builtins ?? {},
      ...(options.env ? { env: options.env } : {}),
    });
    if (frontend.exprs.length === 0) {
      return { value: null, steps: 0, env: options.env ?? Env.empty() } satisfies KernelResult;
    }
    const syntaxError = checkCanonicalPublicSyntax(frontend.expanded);
    if (syntaxError !== null) {
      return yield* Effect.fail(syntaxError);
    }
    return yield* evaluateExpandedRuntimeExprs(
      frontend.expanded,
      options.env ?? Env.empty(),
      options,
    );
  });
}

/**
 * Evaluate pre-parsed expressions with the same VM-first contract as
 * `evaluate()`.
 *
 * This still runs shared expansion first. Returned environments contain
 * runtime bindings (`define`, `instance`) but do not retain
 * compile-time macro definitions.
 *
 * Legacy public syntax forms (`def`, `::`, `deftype`, `data`, and legacy define variants) are rejected
 * with informative errors, consistent with HM lowering.
 */
export function evaluateExprs(
  exprs: readonly SExpr[],
  options: KernelOptions,
): Effect.Effect<KernelResult, KernelError> {
  return Effect.gen(function* () {
    const frontend = yield* Effect.try({
      try: () =>
        expandKernelExprsSync(exprs, {
          builtins: options.builtins ?? {},
          ...(options.env ? { env: options.env } : {}),
          ...(options.observer?.expansionFailed
            ? { onExpansionFailure: options.observer.expansionFailed.bind(options.observer) }
            : {}),
        }),
      catch: toKernelError,
    });
    const syntaxError = checkCanonicalPublicSyntax(frontend.expanded);
    if (syntaxError !== null) {
      return yield* Effect.fail(syntaxError);
    }
    return yield* evaluateExpandedRuntimeExprs(
      frontend.expanded,
      options.env ?? Env.empty(),
      options,
    );
  });
}

function evaluateExpandedRuntimeExprs(
  exprs: readonly SExpr[],
  runtimeEnv: Env,
  options: KernelOptions,
): Effect.Effect<KernelResult, KernelError> {
  return Effect.gen(function* () {
    if (requiresEvaluatorRuntime(exprs)) {
      // Fallback means "execute an evaluator-only runtime form", not
      // "accept any unsupported surface syntax as a VM program".
      return yield* evaluateCompileTimeExprs(exprs, {
        ...options,
        env: runtimeEnv,
      });
    }

    const builtins = options.builtins ?? {};
    const compiled = yield* Effect.try({
      try: () =>
        compileProgram(exprs, {
          builtins,
          env: runtimeEnv,
          normalized: true,
          includePrelude: false,
          ...(options.observer ? { observer: options.observer } : {}),
        }),
      catch: toKernelError,
    });
    const globals = buildVMGlobals(compiled.globals, runtimeEnv);
    const globalNames = Array.from({ length: compiled.globals.count }, (_, idx) =>
      compiled.globals.nameAt(idx),
    );
    const result = yield* runChunkWithStats(compiled.chunk, {
      builtins: compiled.builtinRegistry.toArray(builtins),
      builtinLookup: compiled.builtinRegistry.toMap(builtins),
      globals,
      globalNames,
      strictGlobals: true,
      stepLimit: options.stepLimit,
      ...(options.observer ? { observer: options.observer } : {}),
    });

    return {
      value: result.value,
      steps: result.steps,
      env: buildRuntimeEnvFromGlobals(runtimeEnv, compiled.globals, globals),
    } satisfies KernelResult;
  });
}

/**
 * Low-level compile-time evaluator.
 *
 * This is the evaluator used for compile-time macro execution and for the
 * small evaluator-only runtime subset (`unquote`, `unquote-splicing`).
 *
 * Unlike the VM-first runtime facade, this API preserves `define-macro` bindings
 * in the returned environment and can execute expressions that still contain
 * macro calls.
 */
export function evaluateCompileTimeExprs(
  exprs: readonly SExpr[],
  options: KernelOptions,
): Effect.Effect<KernelResult, KernelError> {
  return Effect.gen(function* () {
    const counter = yield* Ref.make(0);
    const builtins = options.builtins ?? {};
    const baseEnv = options.env ?? Env.empty();
    const runtime: EvaluatorRuntime = {
      builtins,
      counter,
      stepLimit: options.stepLimit,
      ...(options.observer ? { observer: options.observer } : {}),
    };

    // Top-level forms evaluated here rather than by evalExpr are observed as
    // the VM observes them, with the value the form leaves.
    const observer = runtime.observer;
    const observed = (form: SExpr): ((value: KValue) => void) => {
      const targets = observer?.targetsOf(form) ?? [];
      return (value) => {
        for (const target of targets) observer!.observe(target, value);
      };
    };

    let result: KValue = null;
    let currentEnv = baseEnv;
    for (let exprIndex = 0; exprIndex < exprs.length; exprIndex++) {
      const expr = exprs[exprIndex]!;
      // For define: use a mutable slot so fn closures can self-reference
      if (expr._tag === "List" && expr.items.length >= 3) {
        const head = expr.items[0];
        if (head?._tag === "Sym" && head.name === "define") {
          const defGroup: Array<{
            form: SExpr;
            expr: SExpr;
            set: (value: KValue) => void;
          }> = [];
          const groupedNames = new Set<string>();
          let defEnv = currentEnv;
          let groupEnd = exprIndex;

          while (groupEnd < exprs.length) {
            const candidate = exprs[groupEnd]!;
            if (
              candidate._tag !== "List" ||
              candidate.items.length < 3 ||
              candidate.items[0]?._tag !== "Sym" ||
              candidate.items[0].name !== "define"
            ) {
              break;
            }

            const nameExpr = candidate.items[1]!;
            const boundName =
              nameExpr._tag === "Sym"
                ? nameExpr.name
                : nameExpr._tag === "List" && nameExpr.items[0]?._tag === "Sym"
                  ? nameExpr.items[0].name
                  : undefined;
            if (!boundName) {
              break;
            }
            if (groupedNames.has(boundName)) {
              break;
            }
            const slot = defEnv.bindMutable(boundName, null);
            defEnv = slot.env;
            groupedNames.add(boundName);
            let valueExpr: SExpr;
            if (nameExpr._tag === "Sym") {
              valueExpr = candidate.items[2]!;
            } else if (nameExpr._tag === "List") {
              valueExpr = {
                _tag: "List",
                items: [
                  { _tag: "Sym", name: "fn", loc: nameExpr.loc },
                  { _tag: "Vector", items: nameExpr.items.slice(1), loc: nameExpr.loc },
                  ...candidate.items.slice(2),
                ],
                loc: nameExpr.loc,
              };
            } else {
              break;
            }
            defGroup.push({
              form: candidate,
              expr: valueExpr,
              set: slot.set,
            });
            groupEnd++;
          }

          for (const def of defGroup) {
            const observe = observed(def.form);
            const val = yield* evalExpr(def.expr, defEnv, runtime);
            def.set(val);
            observe(val);
            result = val;
          }
          currentEnv = defEnv;
          exprIndex = groupEnd - 1;
          continue;
        }
        // define-typeclass: no-op at runtime (type system handles it)
        if (head?._tag === "Sym" && head.name === "define-typeclass") {
          observed(expr)(null);
          result = null;
          continue;
        }
        // instance: register methods in dispatch table + bind dispatch wrappers
        if (head?._tag === "Sym" && head.name === "instance") {
          const observe = observed(expr);
          const instanceResult = yield* evalInstance(
            expr.items,
            expr.loc,
            currentEnv,
            runtime,
            evalExpr,
          ).pipe(Effect.mapError((error) => withKernelSourceTrace(error, sourceTraceOf(expr))));
          currentEnv = instanceResult.env;
          observe(null);
          result = null;
          continue;
        }
        // define-macro: (define-macro name [params] body...)
        if (head?._tag === "Sym" && head.name === "define-macro") {
          const nameSym = expr.items[1];
          if (nameSym?._tag === "Sym" && expr.items.length >= 4) {
            const paramsExpr = expr.items[2]!;
            if (paramsExpr._tag === "Vector") {
              const params: string[] = [];
              let restParam: string | undefined;
              for (let pi = 0; pi < paramsExpr.items.length; pi++) {
                const p = paramsExpr.items[pi]!;
                if (p._tag === "Sym" && p.name === "&") {
                  const nextP = paramsExpr.items[pi + 1];
                  if (nextP?._tag === "Sym") restParam = nextP.name;
                  break;
                }
                if (p._tag === "Sym") params.push(p.name);
              }
              const body: SExpr =
                expr.items.length === 4
                  ? expr.items[3]!
                  : {
                      _tag: "List" as const,
                      items: [
                        { _tag: "Sym" as const, name: "do", loc: expr.loc },
                        ...expr.items.slice(3),
                      ],
                      loc: expr.loc,
                    };
              const macro: KMacro = {
                _tag: "KMacro",
                name: nameSym.name,
                params,
                ...(restParam != null ? { restParam } : {}),
                body,
                closure: currentEnv,
              };
              currentEnv = currentEnv.bind(nameSym.name, macro);
              result = macro;
              continue;
            }
          }
        }
      }
      result = yield* evalExpr(expr, currentEnv, runtime);
    }

    const steps = yield* Ref.get(counter);
    return { value: result, steps, env: currentEnv } satisfies KernelResult;
  });
}

/** An evaluation whose author-written expressions are observed. */
export interface ObservedEvaluation {
  readonly collector: ObservationCollector;
  readonly evaluation: Effect.Effect<KernelResult, KernelError | ParseError>;
}

/**
 * Prepare an observed evaluation of `source`. The collector exists before the
 * evaluation runs, so a caller can attribute a failure and still report the
 * values computed before it.
 */
export function observeEvaluation(
  source: string,
  options: KernelOptions,
  observation: ObservationOptions = {},
): ObservedEvaluation {
  const parsed = parse(source);
  if (parsed.errors.length > 0) {
    return {
      collector: new ObservationCollector(source, [], observation),
      evaluation: Effect.fail(parsed.errors[0]!),
    };
  }
  const exprs = toSExprMany(parsed.redTree);
  const collector = new ObservationCollector(source, exprs, observation);
  return {
    collector,
    evaluation: evaluateExprs(exprs, { ...options, observer: collector }),
  };
}

export { applyKFn };

import { Effect } from "effect";
import type { SExpr, Loc } from "../reader/index.js";
import { parseManyToSExpr } from "../reader/index.js";
import { Env } from "../Env.js";
import { ArityError, isKernelError, relocateKernelError } from "../diagnostic/errors.js";
import { evaluateCompileTimeExprs } from "../evaluator/eval.js";
import { PRELUDE_SOURCE } from "./prelude.js";
import { copyTree, derive, desugar, emitExpansion, macroOriginsOf } from "./provenance.js";
import { kValueToSExpr } from "../evaluator/quasiquote.js";
import type { BuiltinFn, KMacro, KValue } from "../evaluator/types.js";
import { isKMacro, isKSExpr } from "../evaluator/types.js";

const DEFAULT_MACRO_STEP_LIMIT = 10_000;

const preludeEnvCache = new WeakMap<Record<string, BuiltinFn>, Env>();

interface ExpandState {
  bindingCounter: number;
  /** Macros defined by the program being expanded. */
  readonly ownMacros: Set<KMacro>;
  readonly onExpansionFailure?: ((call: SExpr) => void) | undefined;
}

export interface ExpandProgramOptions {
  readonly builtins: Record<string, BuiltinFn>;
  readonly env?: Env;
  readonly includePrelude?: boolean;
  /**
   * Evaluate inline compile-time calls after macro expansion.
   *
   * This is intended for consumers like domain DSL compilers that embed
   * kernel expressions inside non-kernel forms and need those subexpressions
   * normalized through the same frontend as the rest of the language.
   *
   * Evaluation failures are treated as "not inlineable" so downstream
   * consumers can continue reporting their own form-level diagnostics.
   */
  readonly inlineCompileTimeCalls?: boolean;
  /**
   * Keep top-level `define-macro` forms in the returned program.
   *
   * Runtime entry points leave this off so the expanded program contains only
   * runtime forms. Compile-time tooling can opt in when it needs the original
   * macro definitions to stay in the output stream.
   */
  readonly keepMacroDefs?: boolean;
  readonly macroStepLimit?: number;
  /**
   * Called with the macro call whose expansion failed, before the failure is
   * thrown. Observation attributes the failure to that call.
   */
  readonly onExpansionFailure?: ((call: SExpr) => void) | undefined;
}

export interface ExpandProgramResult {
  readonly exprs: readonly SExpr[];
  readonly env: Env;
}

/**
 * Shared expansion frontend for the Lisp kernel.
 *
 * This pass:
 * - injects the prelude macro environment unless disabled
 * - evaluates top-level `define-macro` forms in the compile-time evaluator
 * - expands user and prelude macros recursively
 * - normalizes destructuring in `fn` / `let`
 *
 * The result is a fresh tree whose every node has one origin (see
 * `provenance.ts`): it shares no node with the input, a macro definition,
 * or another expansion.
 *
 * It does not lower every surface form to the VM subset. Forms such as
 * `match`, `define-type`, and type ascriptions may still remain for non-VM
 * consumers after expansion.
 */
export function expandProgramSync(
  exprs: readonly SExpr[],
  options: ExpandProgramOptions,
): ExpandProgramResult {
  const state: ExpandState = {
    bindingCounter: 0,
    ownMacros: new Set(),
    onExpansionFailure: options.onExpansionFailure,
  };
  const macroStepLimit = options.macroStepLimit ?? DEFAULT_MACRO_STEP_LIMIT;
  let macroEnv = makeMacroEnv(options);
  const inlineCompileTimeCalls = options.inlineCompileTimeCalls === true;
  const expanded: SExpr[] = [];

  for (const expr of exprs) {
    if (isTopLevelDefMacro(expr)) {
      macroEnv = evalTopLevel(expr, macroEnv, options.builtins, macroStepLimit);
      const macro = expr.items[1]?._tag === "Sym" ? macroEnv.lookup(expr.items[1].name) : undefined;
      if (macro !== undefined && isKMacro(macro)) state.ownMacros.add(macro);
      if (options.keepMacroDefs === true) {
        expanded.push(copyTree(expr));
      }
      continue;
    }

    expanded.push(
      expandExpr(expr, macroEnv, options.builtins, macroStepLimit, state, inlineCompileTimeCalls),
    );
  }

  return { exprs: expanded, env: macroEnv };
}

function makeMacroEnv(options: ExpandProgramOptions): Env {
  const baseEnv =
    options.includePrelude === false ? undefined : getPreludeEnvSync(options.builtins);
  if (!options.env) {
    return baseEnv ?? Env.empty();
  }
  return baseEnv ? options.env.withParent(baseEnv) : options.env;
}

export function getPreludeEnvSync(builtins: Record<string, BuiltinFn>): Env {
  const cached = preludeEnvCache.get(builtins);
  if (cached) {
    return cached;
  }

  const env = Effect.runSync(
    Effect.gen(function* () {
      const exprs = yield* parseManyToSExpr(PRELUDE_SOURCE);
      const result = yield* evaluateCompileTimeExprs(exprs, {
        stepLimit: DEFAULT_MACRO_STEP_LIMIT,
        builtins,
      });
      return result.env;
    }),
  );

  preludeEnvCache.set(builtins, env);
  return env;
}

function evalTopLevel(
  expr: SExpr,
  env: Env,
  builtins: Record<string, BuiltinFn>,
  stepLimit: number,
): Env {
  return Effect.runSync(
    evaluateCompileTimeExprs([expr], {
      stepLimit,
      builtins,
      env,
    }),
  ).env;
}

function freshBinding(prefix: string, state: ExpandState): string {
  return `@${prefix}_${state.bindingCounter++}`;
}

function sym(name: string, loc: Loc): SExpr {
  return { _tag: "Sym", name, loc };
}

function list(items: readonly SExpr[], loc: Loc): SExpr {
  return { _tag: "List", items, loc };
}

function vector(items: readonly SExpr[], loc: Loc): SExpr {
  return { _tag: "Vector", items, loc };
}

function expandExpr(
  expr: SExpr,
  macroEnv: Env,
  builtins: Record<string, BuiltinFn>,
  macroStepLimit: number,
  state: ExpandState,
  inlineCompileTimeCalls: boolean,
): SExpr {
  if (expr._tag === "List" && expr.items.length > 0) {
    const head = expr.items[0]!;
    if (head._tag === "Sym") {
      const binding = macroEnv.lookup(head.name);
      if (binding !== undefined && isKMacro(binding)) {
        const args = expr.items.slice(1);
        let result: SExpr;
        try {
          result = evaluateMacro(binding, args, builtins, macroStepLimit);
        } catch (error) {
          throw expansionFailure(error, expr, binding, state);
        }
        return expandExpr(
          emitExpansion(expr, binding.name, args, result),
          macroEnv,
          builtins,
          macroStepLimit,
          state,
          inlineCompileTimeCalls,
        );
      }

      switch (head.name) {
        case "quasiquote":
        case "define-macro":
        case "::":
        case "define-type":
        case "define-typeclass":
          return copyTree(expr);
        case ":":
          return expandAscribe(
            expr,
            macroEnv,
            builtins,
            macroStepLimit,
            state,
            inlineCompileTimeCalls,
          );
        case "instance":
          return expandInstance(
            expr,
            macroEnv,
            builtins,
            macroStepLimit,
            state,
            inlineCompileTimeCalls,
          );
        case "match":
          return expandMatch(
            expr,
            macroEnv,
            builtins,
            macroStepLimit,
            state,
            inlineCompileTimeCalls,
          );
        case "fn":
          return expandFn(expr, macroEnv, builtins, macroStepLimit, state, inlineCompileTimeCalls);
        case "let":
          return expandLet(expr, macroEnv, builtins, macroStepLimit, state, inlineCompileTimeCalls);
      }

      if (inlineCompileTimeCalls) {
        const inlined = tryInlineCompileTimeCall(expr, macroEnv, builtins, macroStepLimit);
        if (inlined) {
          return expandExpr(
            emitExpansion(expr, head.name, expr.items.slice(1), inlined),
            macroEnv,
            builtins,
            macroStepLimit,
            state,
            inlineCompileTimeCalls,
          );
        }
      }
    }
  }

  switch (expr._tag) {
    case "Num":
    case "Str":
    case "Bool":
    case "Sym":
    case "Set":
    case "Error":
      return copyTree(expr);
    case "Vector":
      return derive(
        expr,
        vector(
          expr.items.map((item) =>
            expandExpr(item, macroEnv, builtins, macroStepLimit, state, inlineCompileTimeCalls),
          ),
          expr.loc,
        ),
      );
    case "Map":
      return derive(expr, {
        _tag: "Map",
        pairs: expr.pairs.map(([k, v]) => [
          expandExpr(k, macroEnv, builtins, macroStepLimit, state, inlineCompileTimeCalls),
          expandExpr(v, macroEnv, builtins, macroStepLimit, state, inlineCompileTimeCalls),
        ]),
        loc: expr.loc,
      });
    case "List":
      return derive(
        expr,
        list(
          expr.items.map((item) =>
            expandExpr(item, macroEnv, builtins, macroStepLimit, state, inlineCompileTimeCalls),
          ),
          expr.loc,
        ),
      );
  }
}

function expandAscribe(
  expr: SExpr & { _tag: "List" },
  macroEnv: Env,
  builtins: Record<string, BuiltinFn>,
  macroStepLimit: number,
  state: ExpandState,
  inlineCompileTimeCalls: boolean,
): SExpr {
  if (expr.items.length !== 3) {
    return copyTree(expr);
  }

  return derive(
    expr,
    list(
      [
        copyTree(expr.items[0]!),
        expandExpr(
          expr.items[1]!,
          macroEnv,
          builtins,
          macroStepLimit,
          state,
          inlineCompileTimeCalls,
        ),
        copyTree(expr.items[2]!),
      ],
      expr.loc,
    ),
  );
}

function expandInstance(
  expr: SExpr & { _tag: "List" },
  macroEnv: Env,
  builtins: Record<string, BuiltinFn>,
  macroStepLimit: number,
  state: ExpandState,
  inlineCompileTimeCalls: boolean,
): SExpr {
  const items: SExpr[] = [];

  for (let i = 0; i < expr.items.length; i++) {
    const item = expr.items[i]!;
    if (
      item._tag === "List" &&
      item.items.length === 3 &&
      item.items[0]?._tag === "Sym" &&
      item.items[0].name === "define"
    ) {
      items.push(
        derive(
          item,
          list(
            [
              copyTree(item.items[0]!),
              copyTree(item.items[1]!),
              expandExpr(
                item.items[2]!,
                macroEnv,
                builtins,
                macroStepLimit,
                state,
                inlineCompileTimeCalls,
              ),
            ],
            item.loc,
          ),
        ),
      );
      continue;
    }

    items.push(copyTree(item));
  }

  return derive(expr, list(items, expr.loc));
}

function expandMatch(
  expr: SExpr & { _tag: "List" },
  macroEnv: Env,
  builtins: Record<string, BuiltinFn>,
  macroStepLimit: number,
  state: ExpandState,
  inlineCompileTimeCalls: boolean,
): SExpr {
  if (expr.items.length < 4) {
    return copyTree(expr);
  }

  const items: SExpr[] = [
    copyTree(expr.items[0]!),
    expandExpr(expr.items[1]!, macroEnv, builtins, macroStepLimit, state, inlineCompileTimeCalls),
  ];

  for (let i = 2; i < expr.items.length; i += 2) {
    items.push(copyTree(expr.items[i]!));
    if (i + 1 < expr.items.length) {
      items.push(
        expandExpr(
          expr.items[i + 1]!,
          macroEnv,
          builtins,
          macroStepLimit,
          state,
          inlineCompileTimeCalls,
        ),
      );
    }
  }

  return derive(expr, list(items, expr.loc));
}

function expandFn(
  expr: SExpr & { _tag: "List" },
  macroEnv: Env,
  builtins: Record<string, BuiltinFn>,
  macroStepLimit: number,
  state: ExpandState,
  inlineCompileTimeCalls: boolean,
): SExpr {
  if (expr.items.length < 3) {
    return copyTree(expr);
  }

  const paramsExpr = expr.items[1]!;
  if (paramsExpr._tag !== "Vector") {
    return copyTree(expr);
  }

  const params: SExpr[] = [];
  const destructureBindings: SExpr[] = [];

  for (let i = 0; i < paramsExpr.items.length; i++) {
    const param = paramsExpr.items[i]!;
    if (param._tag === "Sym" && param.name === "&") {
      params.push(...paramsExpr.items.slice(i).map(copyTree));
      break;
    }

    if (param._tag === "Map" || param._tag === "Vector") {
      const placeholder = freshBinding("destructure", state);
      params.push(desugar(param, sym(placeholder, param.loc)));
      if (param._tag === "Map") {
        expandMapDestructure(param, placeholder, expr, destructureBindings, state);
      } else {
        expandSeqDestructure(param, placeholder, expr, destructureBindings, state);
      }
      continue;
    }

    params.push(copyTree(param));
  }

  const bodyForms = expr.items
    .slice(2)
    .map((item) =>
      expandExpr(item, macroEnv, builtins, macroStepLimit, state, inlineCompileTimeCalls),
    );

  let body =
    bodyForms.length === 1
      ? bodyForms[0]!
      : desugar(expr, list([desugar(expr, sym("do", expr.loc)), ...bodyForms], expr.loc));

  if (destructureBindings.length > 0) {
    body = desugar(
      expr,
      list(
        [
          desugar(expr, sym("let", expr.loc)),
          desugar(expr, vector(destructureBindings, expr.loc)),
          body,
        ],
        expr.loc,
      ),
    );
  }

  return derive(
    expr,
    list(
      [copyTree(expr.items[0]!), derive(paramsExpr, vector(params, paramsExpr.loc)), body],
      expr.loc,
    ),
  );
}

function expandLet(
  expr: SExpr & { _tag: "List" },
  macroEnv: Env,
  builtins: Record<string, BuiltinFn>,
  macroStepLimit: number,
  state: ExpandState,
  inlineCompileTimeCalls: boolean,
): SExpr {
  if (expr.items.length < 3) {
    return copyTree(expr);
  }

  const bindingsExpr = expr.items[1]!;
  if (bindingsExpr._tag !== "Vector") {
    return copyTree(expr);
  }

  const normalizedBindings: SExpr[] = [];

  for (let i = 0; i < bindingsExpr.items.length; i += 2) {
    const binding = bindingsExpr.items[i];
    const valueExpr = bindingsExpr.items[i + 1];
    if (!binding || !valueExpr) {
      break;
    }

    const expandedValue = expandExpr(
      valueExpr,
      macroEnv,
      builtins,
      macroStepLimit,
      state,
      inlineCompileTimeCalls,
    );

    if (binding._tag === "Map" || binding._tag === "Vector") {
      const placeholder = freshBinding("destructure_let", state);
      normalizedBindings.push(desugar(binding, sym(placeholder, binding.loc)), expandedValue);
      if (binding._tag === "Map") {
        expandMapDestructure(binding, placeholder, expr, normalizedBindings, state);
      } else {
        expandSeqDestructure(binding, placeholder, expr, normalizedBindings, state);
      }
      continue;
    }

    normalizedBindings.push(copyTree(binding), expandedValue);
  }

  return derive(
    expr,
    list(
      [
        copyTree(expr.items[0]!),
        derive(bindingsExpr, vector(normalizedBindings, bindingsExpr.loc)),
        ...expr.items
          .slice(2)
          .map((item) =>
            expandExpr(item, macroEnv, builtins, macroStepLimit, state, inlineCompileTimeCalls),
          ),
      ],
      expr.loc,
    ),
  );
}

function tryInlineCompileTimeCall(
  expr: SExpr & { _tag: "List" },
  env: Env,
  builtins: Record<string, BuiltinFn>,
  stepLimit: number,
): SExpr | null {
  const head = expr.items[0];
  if (head?._tag !== "Sym") {
    return null;
  }

  const binding = env.lookup(head.name);
  if (binding !== undefined && isKMacro(binding)) {
    return null;
  }

  if (!(head.name in builtins) && binding === undefined) {
    return null;
  }

  try {
    const result = Effect.runSync(
      evaluateCompileTimeExprs([expr], {
        stepLimit,
        builtins,
        env,
      }),
    ).value;

    return isKSExpr(result) ? result.expr : kValueToSExpr(result);
  } catch {
    return null;
  }
}

// Destructuring lowers to bindings of desugared temporaries. Each use of a
// temporary is its own node, and keys are copied as part of the pattern.

function expandMapDestructure(
  mapExpr: SExpr & { _tag: "Map" },
  placeholder: string,
  form: SExpr,
  bindings: SExpr[],
  state: ExpandState,
): void {
  const use = () => desugar(mapExpr, sym(placeholder, mapExpr.loc));
  for (const [k, v] of mapExpr.pairs) {
    if (k._tag === "Sym" && k.name === ":keys" && v._tag === "Vector") {
      for (const key of v.items) {
        if (key._tag !== "Sym") {
          continue;
        }

        bindDestructurePattern(
          key,
          desugarCall(form, "get", [use(), desugar(key, sym(`:${key.name}`, key.loc))]),
          form,
          bindings,
          state,
        );
      }
      continue;
    }

    if (k._tag === "Sym" && k.name === ":as" && v._tag === "Sym") {
      bindings.push(copyTree(v));
      bindings.push(use());
      continue;
    }

    const valueExpr = desugarCall(form, "get", [use(), desugarTree(k)]);
    bindDestructurePattern(v, valueExpr, form, bindings, state);
  }
}

function expandSeqDestructure(
  vecExpr: SExpr & { _tag: "Vector" },
  placeholder: string,
  form: SExpr,
  bindings: SExpr[],
  state: ExpandState,
): void {
  const use = () => desugar(vecExpr, sym(placeholder, vecExpr.loc));
  let restIndex = -1;

  for (let i = 0; i < vecExpr.items.length; i++) {
    const item = vecExpr.items[i]!;
    if (item._tag === "Sym" && item.name === "&") {
      restIndex = i;
      break;
    }

    bindDestructurePattern(
      item,
      desugarCall(form, "nth", [use(), desugar(form, { _tag: "Num", value: i, loc: form.loc })]),
      form,
      bindings,
      state,
    );
  }

  if (restIndex >= 0 && restIndex + 1 < vecExpr.items.length) {
    let restExpr: SExpr = use();
    for (let i = 0; i < restIndex; i++) {
      restExpr = desugarCall(form, "rest", [restExpr]);
    }
    bindDestructurePattern(vecExpr.items[restIndex + 1]!, restExpr, form, bindings, state);
  }
}

function bindDestructurePattern(
  pattern: SExpr,
  valueExpr: SExpr,
  form: SExpr,
  bindings: SExpr[],
  state: ExpandState,
): void {
  switch (pattern._tag) {
    case "Sym":
      bindings.push(copyTree(pattern));
      bindings.push(valueExpr);
      return;
    case "Map": {
      const placeholder = freshBinding("destructure_map", state);
      bindings.push(desugar(pattern, sym(placeholder, pattern.loc)), valueExpr);
      expandMapDestructure(pattern, placeholder, form, bindings, state);
      return;
    }
    case "Vector": {
      const placeholder = freshBinding("destructure_seq", state);
      bindings.push(desugar(pattern, sym(placeholder, pattern.loc)), valueExpr);
      expandSeqDestructure(pattern, placeholder, form, bindings, state);
      return;
    }
    default:
      return;
  }
}

/** `(name args...)`, written by the expander for the author form `form`. */
function desugarCall(form: SExpr, name: string, args: readonly SExpr[]): SExpr {
  return desugar(form, list([desugar(form, sym(name, form.loc)), ...args], form.loc));
}

/** A copy of part of a pattern, used as an expression the expander wrote. */
function desugarTree(node: SExpr): SExpr {
  switch (node._tag) {
    case "List":
    case "Vector":
    case "Set":
      return desugar(node, { _tag: node._tag, items: node.items.map(desugarTree), loc: node.loc });
    case "Map":
      return desugar(node, {
        _tag: "Map",
        pairs: node.pairs.map(([k, v]) => [desugarTree(k), desugarTree(v)] as const),
        loc: node.loc,
      });
    default:
      return desugar(node, { ...node });
  }
}

/**
 * Locate a failure raised while expanding `call`. An arity failure has no
 * location, and a failure inside a macro the program did not define (a
 * prelude macro) is located in another source: both belong to the call.
 */
function expansionFailure(error: unknown, call: SExpr, macro: KMacro, state: ExpandState): unknown {
  state.onExpansionFailure?.(call);
  if (!isKernelError(error) || (error.loc && state.ownMacros.has(macro))) {
    return error;
  }
  return relocateKernelError(error, call.loc, [
    { macroName: macro.name, loc: call.loc },
    ...(macroOriginsOf(call) ?? []),
  ]);
}

function evaluateMacro(
  macro: KMacro,
  argExprs: readonly SExpr[],
  builtins: Record<string, BuiltinFn>,
  stepLimit: number,
): SExpr {
  if (macro.restParam) {
    if (argExprs.length < macro.params.length) {
      throw new ArityError({
        name: macro.name,
        expected: `${macro.params.length}+`,
        got: argExprs.length,
      });
    }
  } else if (argExprs.length !== macro.params.length) {
    throw new ArityError({
      name: macro.name,
      expected: macro.params.length,
      got: argExprs.length,
    });
  }

  const bindings: Record<string, KValue> = {};
  for (let i = 0; i < macro.params.length; i++) {
    bindings[macro.params[i]!] = { _tag: "KSExpr", expr: argExprs[i]! };
  }

  if (macro.restParam) {
    bindings[macro.restParam] = argExprs
      .slice(macro.params.length)
      .map((expr) => ({ _tag: "KSExpr", expr }) satisfies KValue);
  }

  const macroEnv = macro.closure.extend(bindings);
  const result = Effect.runSync(
    evaluateCompileTimeExprs([macro.body], {
      stepLimit,
      builtins,
      env: macroEnv,
    }),
  ).value;

  return isKSExpr(result) ? result.expr : kValueToSExpr(result);
}

function isTopLevelDefMacro(expr: SExpr): expr is SExpr & { _tag: "List" } {
  return (
    expr._tag === "List" &&
    expr.items.length >= 4 &&
    expr.items[0]?._tag === "Sym" &&
    expr.items[0].name === "define-macro"
  );
}

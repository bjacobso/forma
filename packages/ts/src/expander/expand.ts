import { Effect } from "effect";
import type { SExpr, Loc } from "../reader/index.js";
import { parseManyToSExpr } from "../reader/index.js";
import { Env } from "../Env.js";
import { ArityError } from "../diagnostic/errors.js";
import { evaluateCompileTimeExprs } from "../evaluator/eval.js";
import { PRELUDE_SOURCE } from "./prelude.js";
import { kValueToSExpr } from "../evaluator/quasiquote.js";
import { copySourceTrace, markExpansion, tagExpandedExpr } from "../evaluator/source-trace.js";
import type { BuiltinFn, KMacro, KValue } from "../evaluator/types.js";
import { isKMacro, isKSExpr } from "../evaluator/types.js";

const DEFAULT_MACRO_STEP_LIMIT = 10_000;

const preludeEnvCache = new WeakMap<Record<string, BuiltinFn>, Env>();

interface ExpandState {
  bindingCounter: number;
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
 * It does not lower every surface form to the VM subset. Forms such as
 * `match`, `define-type`, and type ascriptions may still remain for non-VM
 * consumers after expansion.
 */
export function expandProgramSync(
  exprs: readonly SExpr[],
  options: ExpandProgramOptions,
): ExpandProgramResult {
  const state: ExpandState = { bindingCounter: 0 };
  const macroStepLimit = options.macroStepLimit ?? DEFAULT_MACRO_STEP_LIMIT;
  let macroEnv = makeMacroEnv(options);
  const inlineCompileTimeCalls = options.inlineCompileTimeCalls === true;
  const expanded: SExpr[] = [];

  for (const expr of exprs) {
    if (isTopLevelDefMacro(expr)) {
      macroEnv = evalTopLevel(expr, macroEnv, options.builtins, macroStepLimit);
      if (options.keepMacroDefs === true) {
        expanded.push(expr);
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

function freshBinding(prefix: string, loc: Loc, state: ExpandState): SExpr {
  return { _tag: "Sym", name: `@${prefix}_${state.bindingCounter++}`, loc };
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
        const result = evaluateMacro(binding, expr.items.slice(1), builtins, macroStepLimit);
        tagExpandedExpr(result, { macroName: binding.name, loc: expr.loc });
        const expanded = markExpansion(expr, result);
        return expandExpr(
          expanded,
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
          return expr;
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
            inlined,
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
      return expr;
    case "Vector":
      return copySourceTrace(
        expr,
        vector(
          expr.items.map((item) =>
            expandExpr(item, macroEnv, builtins, macroStepLimit, state, inlineCompileTimeCalls),
          ),
          expr.loc,
        ),
      );
    case "Map":
      return copySourceTrace(expr, {
        _tag: "Map",
        pairs: expr.pairs.map(([k, v]) => [
          expandExpr(k, macroEnv, builtins, macroStepLimit, state, inlineCompileTimeCalls),
          expandExpr(v, macroEnv, builtins, macroStepLimit, state, inlineCompileTimeCalls),
        ]),
        loc: expr.loc,
      });
    case "List":
      return copySourceTrace(
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
    return expr;
  }

  return copySourceTrace(
    expr,
    list(
      [
        expr.items[0]!,
        expandExpr(
          expr.items[1]!,
          macroEnv,
          builtins,
          macroStepLimit,
          state,
          inlineCompileTimeCalls,
        ),
        expr.items[2]!,
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
        copySourceTrace(
          item,
          list(
            [
              item.items[0]!,
              item.items[1]!,
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

    items.push(item);
  }

  return copySourceTrace(expr, list(items, expr.loc));
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
    return expr;
  }

  const items: SExpr[] = [
    expr.items[0]!,
    expandExpr(expr.items[1]!, macroEnv, builtins, macroStepLimit, state, inlineCompileTimeCalls),
  ];

  for (let i = 2; i < expr.items.length; i += 2) {
    items.push(expr.items[i]!);
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

  return copySourceTrace(expr, list(items, expr.loc));
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
    return expr;
  }

  const paramsExpr = expr.items[1]!;
  if (paramsExpr._tag !== "Vector") {
    return expr;
  }

  const params: SExpr[] = [];
  const destructureBindings: SExpr[] = [];

  for (let i = 0; i < paramsExpr.items.length; i++) {
    const param = paramsExpr.items[i]!;
    if (param._tag === "Sym" && param.name === "&") {
      params.push(param);
      if (i + 1 < paramsExpr.items.length) {
        params.push(paramsExpr.items[i + 1]!);
      }
      for (let j = i + 2; j < paramsExpr.items.length; j++) {
        params.push(paramsExpr.items[j]!);
      }
      break;
    }

    if (param._tag === "Sym") {
      params.push(param);
      continue;
    }

    if (param._tag === "Map" || param._tag === "Vector") {
      const placeholder = freshBinding("destructure", param.loc, state);
      params.push(placeholder);
      if (param._tag === "Map") {
        expandMapDestructure(param, placeholder, expr.loc, destructureBindings, state);
      } else {
        expandSeqDestructure(param, placeholder, expr.loc, destructureBindings, state);
      }
      continue;
    }

    params.push(param);
  }

  const bodyForms = expr.items
    .slice(2)
    .map((item) =>
      expandExpr(item, macroEnv, builtins, macroStepLimit, state, inlineCompileTimeCalls),
    );

  let body =
    bodyForms.length === 1 ? bodyForms[0]! : list([sym("do", expr.loc), ...bodyForms], expr.loc);

  if (destructureBindings.length > 0) {
    body = list([sym("let", expr.loc), vector(destructureBindings, expr.loc), body], expr.loc);
  }

  return copySourceTrace(
    expr,
    list([sym("fn", expr.loc), vector(params, paramsExpr.loc), body], expr.loc),
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
    return expr;
  }

  const bindingsExpr = expr.items[1]!;
  if (bindingsExpr._tag !== "Vector") {
    return expr;
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

    if (binding._tag === "Sym") {
      normalizedBindings.push(binding, expandedValue);
      continue;
    }

    if (binding._tag === "Map" || binding._tag === "Vector") {
      const placeholder = freshBinding("destructure_let", binding.loc, state);
      normalizedBindings.push(placeholder, expandedValue);
      if (binding._tag === "Map") {
        expandMapDestructure(binding, placeholder, expr.loc, normalizedBindings, state);
      } else {
        expandSeqDestructure(binding, placeholder, expr.loc, normalizedBindings, state);
      }
      continue;
    }

    normalizedBindings.push(binding, expandedValue);
  }

  return copySourceTrace(
    expr,
    list(
      [
        sym("let", expr.loc),
        vector(normalizedBindings, bindingsExpr.loc),
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

function expandMapDestructure(
  mapExpr: SExpr & { _tag: "Map" },
  placeholder: SExpr,
  loc: Loc,
  bindings: SExpr[],
  state: ExpandState,
): void {
  for (const [k, v] of mapExpr.pairs) {
    if (k._tag === "Sym" && k.name === ":keys" && v._tag === "Vector") {
      for (const key of v.items) {
        if (key._tag !== "Sym") {
          continue;
        }

        bindDestructurePattern(
          key,
          list([sym("get", loc), placeholder, sym(`:${key.name}`, key.loc)], loc),
          loc,
          bindings,
          state,
        );
      }
      continue;
    }

    if (k._tag === "Sym" && k.name === ":as" && v._tag === "Sym") {
      bindings.push(sym(v.name, v.loc));
      bindings.push(placeholder);
      continue;
    }

    bindDestructurePattern(v, list([sym("get", loc), placeholder, k], loc), loc, bindings, state);
  }
}

function expandSeqDestructure(
  vecExpr: SExpr & { _tag: "Vector" },
  placeholder: SExpr,
  loc: Loc,
  bindings: SExpr[],
  state: ExpandState,
): void {
  let restIndex = -1;

  for (let i = 0; i < vecExpr.items.length; i++) {
    const item = vecExpr.items[i]!;
    if (item._tag === "Sym" && item.name === "&") {
      restIndex = i;
      break;
    }

    bindDestructurePattern(
      item,
      list([sym("nth", loc), placeholder, { _tag: "Num", value: i, loc }], loc),
      loc,
      bindings,
      state,
    );
  }

  if (restIndex >= 0 && restIndex + 1 < vecExpr.items.length) {
    let restExpr: SExpr = placeholder;
    for (let i = 0; i < restIndex; i++) {
      restExpr = list([sym("rest", loc), restExpr], loc);
    }
    bindDestructurePattern(vecExpr.items[restIndex + 1]!, restExpr, loc, bindings, state);
  }
}

function bindDestructurePattern(
  pattern: SExpr,
  valueExpr: SExpr,
  loc: Loc,
  bindings: SExpr[],
  state: ExpandState,
): void {
  switch (pattern._tag) {
    case "Sym":
      bindings.push(sym(pattern.name, pattern.loc));
      bindings.push(valueExpr);
      return;
    case "Map": {
      const placeholder = freshBinding("destructure_map", pattern.loc, state);
      bindings.push(placeholder, valueExpr);
      expandMapDestructure(pattern, placeholder, loc, bindings, state);
      return;
    }
    case "Vector": {
      const placeholder = freshBinding("destructure_seq", pattern.loc, state);
      bindings.push(placeholder, valueExpr);
      expandSeqDestructure(pattern, placeholder, loc, bindings, state);
      return;
    }
    default:
      return;
  }
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

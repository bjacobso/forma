import { Effect } from "effect";
import type { SExpr, Loc } from "../reader/index.js";
import { trySym, headSym } from "../reader/types.js";
import { KernelTypeError, ArityError } from "../diagnostic/errors.js";
import type { KernelError } from "../diagnostic/errors.js";
import { Env } from "../Env.js";
import { compileMatchPattern, matchCompiledPattern } from "./match.js";
import type { KValue, KFn } from "./types.js";
import { isTruthy } from "./types.js";
import type { EvaluatorRuntime, EvalFn } from "./eval-types.js";
import { getTcoTail, setTcoTail } from "./eval-types.js";
import { expandMapDestructure, expandSeqDestructure } from "./destructure.js";
import { applyMapDestructureRuntime, applySeqDestructureRuntime } from "./destructure.js";

// ---------------------------------------------------------------------------
// Special forms
// ---------------------------------------------------------------------------

export function evalFn(
  items: readonly SExpr[],
  loc: Loc,
  env: Env,
): Effect.Effect<KFn, KernelError> {
  if (items.length < 3) {
    return Effect.fail(new ArityError({ name: "fn", expected: "2+", got: items.length - 1, loc }));
  }
  const paramsExpr = items[1]!;
  if (paramsExpr._tag !== "Vector") {
    return Effect.fail(
      new KernelTypeError({
        message: "fn params must be a vector",
        expected: "vector",
        got: paramsExpr._tag,
        loc: paramsExpr.loc,
      }),
    );
  }

  const params: string[] = [];
  let restParam: string | undefined;
  const destructureBindings: SExpr[] = []; // pairs of [pattern-var, get-expr] for let wrapper

  for (let pi = 0; pi < paramsExpr.items.length; pi++) {
    const p = paramsExpr.items[pi]!;
    if (trySym(p) === "&") {
      const nextP = paramsExpr.items[pi + 1];
      if (!nextP || !trySym(nextP)) {
        return Effect.fail(
          new KernelTypeError({
            message: "& must be followed by a rest parameter name",
            expected: "symbol",
            got: nextP?._tag ?? "nothing",
            loc: p.loc,
          }),
        );
      }
      if (pi + 2 !== paramsExpr.items.length) {
        return Effect.fail(
          new KernelTypeError({
            message: "rest parameter must be the final fn parameter",
            expected: "final rest parameter",
            got: "additional parameters",
            loc: nextP.loc,
          }),
        );
      }
      restParam = trySym(nextP)!;
      break;
    }

    const symName = trySym(p);
    if (symName) {
      params.push(symName);
    } else if (p._tag === "Map") {
      // Map destructuring: {:keys [a b c]} or {:keys [a b c] :as name}
      const placeholder = `__destructure_${pi}`;
      params.push(placeholder);
      expandMapDestructure(
        p,
        { _tag: "Sym" as const, name: placeholder, loc: p.loc },
        loc,
        destructureBindings,
      );
    } else if (p._tag === "Vector") {
      // Sequential destructuring: [a b & rest]
      const placeholder = `__destructure_${pi}`;
      params.push(placeholder);
      expandSeqDestructure(
        p,
        { _tag: "Sym" as const, name: placeholder, loc: p.loc },
        loc,
        destructureBindings,
      );
    } else {
      return Effect.fail(
        new KernelTypeError({
          message: "fn param must be a symbol, map destructure, or vector destructure",
          expected: "symbol, map, or vector",
          got: p._tag,
          loc: p.loc,
        }),
      );
    }
  }

  // If multiple body forms, wrap in implicit do
  let body: SExpr =
    items.length === 3
      ? items[2]!
      : {
          _tag: "List" as const,
          items: [{ _tag: "Sym" as const, name: "do", loc }, ...items.slice(2)],
          loc,
        };

  // If there are destructuring bindings, wrap body in a let
  if (destructureBindings.length > 0) {
    body = {
      _tag: "List" as const,
      items: [
        { _tag: "Sym" as const, name: "let", loc },
        { _tag: "Vector" as const, items: destructureBindings, loc },
        body,
      ],
      loc,
    };
  }

  return Effect.succeed({
    _tag: "KFn" as const,
    params,
    ...(restParam != null ? { restParam } : {}),
    body,
    closure: env,
  });
}

export function evalLet(
  items: readonly SExpr[],
  loc: Loc,
  env: Env,
  runtime: EvaluatorRuntime,
  evalExpr: EvalFn,
): Effect.Effect<KValue, KernelError> {
  return Effect.gen(function* () {
    if (items.length < 3) {
      return yield* new ArityError({ name: "let", expected: "2+", got: items.length - 1, loc });
    }
    const bindingsExpr = items[1]!;
    if (bindingsExpr._tag !== "Vector") {
      return yield* new KernelTypeError({
        message: "let bindings must be a vector",
        expected: "vector",
        got: bindingsExpr._tag,
        loc: bindingsExpr.loc,
      });
    }
    if (bindingsExpr.items.length % 2 !== 0) {
      return yield* new KernelTypeError({
        message: "let bindings must have an even number of forms",
        expected: "even count",
        got: `${bindingsExpr.items.length}`,
        loc: bindingsExpr.loc,
      });
    }

    // Binding values are non-tail
    const prevTail = getTcoTail();
    setTcoTail(false);
    let letEnv = env;
    for (let i = 0; i < bindingsExpr.items.length; i += 2) {
      const nameSym = bindingsExpr.items[i]!;
      const val = yield* evalExpr(bindingsExpr.items[i + 1]!, letEnv, runtime);

      const bindName = trySym(nameSym);
      if (bindName) {
        letEnv = letEnv.bind(bindName, val);
      } else if (nameSym._tag === "Map") {
        letEnv = applyMapDestructureRuntime(nameSym, val, letEnv);
      } else if (nameSym._tag === "Vector") {
        letEnv = applySeqDestructureRuntime(nameSym, val, letEnv);
      } else {
        return yield* new KernelTypeError({
          message: "let binding name must be a symbol, map destructure, or vector destructure",
          expected: "symbol, map, or vector",
          got: nameSym._tag,
          loc: nameSym.loc,
        });
      }
    }

    // Evaluate body forms (implicit do) — last form is tail
    let result: KValue = null;
    for (let i = 2; i < items.length; i++) {
      setTcoTail(i === items.length - 1 ? prevTail : false);
      result = yield* evalExpr(items[i]!, letEnv, runtime);
    }
    return result;
  });
}

export function evalIf(
  items: readonly SExpr[],
  loc: Loc,
  env: Env,
  runtime: EvaluatorRuntime,
  evalExpr: EvalFn,
): Effect.Effect<KValue, KernelError> {
  return Effect.gen(function* () {
    if (items.length < 3 || items.length > 4) {
      return yield* new ArityError({ name: "if", expected: "2-3", got: items.length - 1, loc });
    }
    const prevTail = getTcoTail();
    setTcoTail(false);
    const test = yield* evalExpr(items[1]!, env, runtime);
    setTcoTail(prevTail);
    if (isTruthy(test)) {
      return yield* evalExpr(items[2]!, env, runtime);
    }
    if (items.length === 4) {
      return yield* evalExpr(items[3]!, env, runtime);
    }
    return null;
  });
}

export function evalDo(
  items: readonly SExpr[],
  env: Env,
  runtime: EvaluatorRuntime,
  evalExpr: EvalFn,
): Effect.Effect<KValue, KernelError> {
  return Effect.gen(function* () {
    let result: KValue = null;
    const prevTail = getTcoTail();
    for (let i = 1; i < items.length; i++) {
      setTcoTail(i === items.length - 1 ? prevTail : false);
      result = yield* evalExpr(items[i]!, env, runtime);
    }
    return result;
  });
}

export function evalMatch(
  items: readonly SExpr[],
  loc: Loc,
  env: Env,
  runtime: EvaluatorRuntime,
  evalExpr: EvalFn,
): Effect.Effect<KValue, KernelError> {
  return Effect.gen(function* () {
    if (items.length < 4 || (items.length - 2) % 2 !== 0) {
      return yield* new KernelTypeError({
        message: "match requires a scrutinee followed by pattern/body pairs",
        expected: "scrutinee and pattern/body pairs",
        got: `${Math.max(items.length - 1, 0)} form(s)`,
        loc,
      });
    }

    const prevTail = getTcoTail();
    setTcoTail(false);
    const scrutinee = yield* evalExpr(items[1]!, env, runtime);

    for (let i = 2; i < items.length; i += 2) {
      const patternExpr = items[i]!;
      const bodyExpr = items[i + 1]!;
      let compiledPattern: ReturnType<typeof compileMatchPattern>;
      try {
        compiledPattern = compileMatchPattern(patternExpr);
      } catch (error) {
        if (error instanceof KernelTypeError) {
          return yield* error;
        }
        throw error;
      }
      const bindings = matchCompiledPattern(compiledPattern, scrutinee);
      if (bindings === null) {
        continue;
      }

      let branchEnv = env;
      for (
        let bindingIndex = 0;
        bindingIndex < compiledPattern.bindingNames.length;
        bindingIndex++
      ) {
        branchEnv = branchEnv.bind(
          compiledPattern.bindingNames[bindingIndex]!,
          bindings[bindingIndex]!,
        );
      }

      setTcoTail(prevTail);
      return yield* evalExpr(bodyExpr, branchEnv, runtime);
    }

    setTcoTail(prevTail);
    return null;
  });
}

export function evalDef(
  items: readonly SExpr[],
  loc: Loc,
  env: Env,
  runtime: EvaluatorRuntime,
  evalExpr: EvalFn,
): Effect.Effect<KValue, KernelError> {
  return Effect.gen(function* () {
    if (items.length < 3) {
      return yield* new ArityError({ name: "define", expected: "2+", got: items.length - 1, loc });
    }
    const nameExpr = items[1]!;
    const defSymName = trySym(nameExpr);
    if (defSymName) {
      if (items.length !== 3) {
        return yield* new ArityError({ name: "define", expected: 2, got: items.length - 1, loc });
      }
      const { env: defEnv, set } = env.bindMutable(defSymName, null);
      // The value is stored, so it is never in tail position.
      const prevTail = getTcoTail();
      setTcoTail(false);
      const val = yield* evalExpr(items[2]!, defEnv, runtime);
      setTcoTail(prevTail);
      set(val);
      return val;
    }

    const fnName = headSym(nameExpr);
    if (fnName) {
      const headItems = (nameExpr as SExpr & { items: readonly SExpr[] }).items;
      const fnExpr = {
        _tag: "List" as const,
        items: [
          { _tag: "Sym" as const, name: "fn", loc: nameExpr.loc },
          { _tag: "Vector" as const, items: headItems.slice(1), loc: nameExpr.loc },
          ...items.slice(2),
        ],
        loc: nameExpr.loc,
      };
      const { env: defEnv, set } = env.bindMutable(fnName, null);
      const val = yield* evalExpr(fnExpr, defEnv, runtime);
      set(val);
      return val;
    }

    return yield* new KernelTypeError({
      message: "define name must be a symbol or function head",
      expected: "symbol or (name args...)",
      got: nameExpr._tag,
      loc: nameExpr.loc,
    });
  });
}

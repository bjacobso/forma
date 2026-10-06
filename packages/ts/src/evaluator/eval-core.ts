import { KKeyword, mapKey, quotedDatum } from "./types.js";
import { Effect, Ref } from "effect";
import type { SExpr, Loc } from "../reader/index.js";
import {
  StepLimitExceeded,
  KernelTypeError,
  ArityError,
  withKernelSourceTrace,
} from "../diagnostic/errors.js";
import type { KernelError } from "../diagnostic/errors.js";
import { Env } from "../Env.js";
import { sourceTraceOf } from "./source-trace.js";
import type { KValue, KFn, KTailCall } from "./types.js";
import {
  KBuiltin as makeKBuiltin,
  isKFn,
  isKBuiltin,
  isKMacro,
  isKTailCall,
  TypeCheckError,
  describeType,
} from "./types.js";
import type { EvaluatorRuntime } from "./eval-types.js";
import { getTcoTail, setTcoTail, getTcoSelf, setTcoSelf } from "./eval-types.js";
import { evalFn, evalLet, evalIf, evalDo, evalMatch, evalDef } from "./special-forms.js";
import { evalDefMacro, applyMacro, evalQuasiquoteForm } from "./macros.js";
import { evalInstance } from "./instances.js";

// ---------------------------------------------------------------------------
// Core evaluation dispatch
// ---------------------------------------------------------------------------

/**
 * Evaluate a single SExpr node.
 */
export function evalExpr(
  expr: SExpr,
  env: Env,
  runtime: EvaluatorRuntime,
): Effect.Effect<KValue, KernelError> {
  const observer = runtime.observer;
  const targets = observer?.targetsOf(expr);
  if (!observer || !targets || targets.length === 0) return evalUnobserved(expr, env, runtime);
  return Effect.map(evalUnobserved(expr, env, runtime), (value) => {
    if (!isKTailCall(value)) for (const target of targets) observer.observe(target, value);
    return value;
  });
}

function evalUnobserved(
  expr: SExpr,
  env: Env,
  runtime: EvaluatorRuntime,
): Effect.Effect<KValue, KernelError> {
  const trace = sourceTraceOf(expr);
  return Effect.gen(function* () {
    const steps = yield* Ref.updateAndGet(runtime.counter, (n) => n + 1);
    if (steps > runtime.stepLimit) {
      return yield* new StepLimitExceeded({ limit: runtime.stepLimit, loc: expr.loc });
    }

    try {
      switch (expr._tag) {
        case "Num":
          return expr.value;
        case "Str":
          return expr.value;
        case "Bool":
          return expr.value;
        case "Sym":
          return yield* evalSym(expr.name, env, runtime, expr.loc);
        case "Vector":
          return yield* evalVector(expr.items, env, runtime);
        case "Map":
          return yield* evalMap(expr.pairs, env, runtime);
        case "List":
          return yield* evalList(expr.items, trace.loc, env, runtime);
        case "Set":
          return yield* new KernelTypeError({
            message: "Set literals are not supported as runtime values",
            expected: "valid expression",
            got: "set literal",
            loc: expr.loc,
          });
        case "Error":
          return yield* new KernelTypeError({
            message: `Parse error node: ${expr.message}`,
            expected: "valid expression",
            got: "error",
            loc: expr.loc,
          });
      }
    } catch (e) {
      if (e instanceof TypeCheckError) {
        return yield* new KernelTypeError({
          message: e.message,
          expected: e.expected,
          got: e.got,
          loc: expr.loc,
        });
      }
      throw e;
    }
  }).pipe(Effect.mapError((error) => withKernelSourceTrace(error, trace)));
}

export function evalSym(
  name: string,
  env: Env,
  runtime: EvaluatorRuntime,
  loc: Loc,
): Effect.Effect<KValue, KernelError> {
  // Handle keyword symbols (e.g., :foo) as self-evaluating strings
  if (name.startsWith(":")) {
    return Effect.succeed(KKeyword(name));
  }
  // nil literal
  if (name === "nil") {
    return Effect.succeed(null);
  }
  if (env.has(name)) {
    return Effect.succeed(env.lookup(name)!);
  }
  if (name==="None" || name==="Option.None") return Effect.succeed(new Map([[":_tag","None"]]));
  if (name in runtime.builtins) {
    return Effect.succeed(makeKBuiltin(name));
  }
  return Effect.fail(
    new KernelTypeError({
      message: `Unbound symbol: ${name}`,
      expected: "bound variable",
      got: name,
      loc,
    }),
  );
}

export function applyCallableValue(
  fn: KValue,
  args: readonly KValue[],
  runtime: EvaluatorRuntime,
): Effect.Effect<KValue, KernelError> {
  if (isKBuiltin(fn)) {
    const builtin = runtime.builtins[fn.name];
    if (builtin) {
      return builtin(args, (innerFn, innerArgs) => applyCallableValue(innerFn, innerArgs, runtime));
    }
  }
  if (isKFn(fn)) {
    return applyKFn(fn, args, runtime);
  }
  return Effect.fail(
    new KernelTypeError({
      message: `Cannot call ${describeType(fn)} as function`,
      expected: "function",
      got: describeType(fn),
    }),
  );
}

export function evalVector(
  items: readonly SExpr[],
  env: Env,
  runtime: EvaluatorRuntime,
): Effect.Effect<readonly KValue[], KernelError> {
  return Effect.gen(function* () {
    const result: KValue[] = [];
    for (const item of items) {
      result.push(yield* evalExpr(item, env, runtime));
    }
    return result;
  });
}

export function evalMap(
  pairs: readonly (readonly [SExpr, SExpr])[],
  env: Env,
  runtime: EvaluatorRuntime,
): Effect.Effect<ReadonlyMap<string, KValue>, KernelError> {
  return Effect.gen(function* () {
    const result = new Map<string, KValue>();
    for (const [kExpr, vExpr] of pairs) {
      const k = yield* evalExpr(kExpr, env, runtime);
      const key = mapKey(k);
      if (key === undefined) {
        return yield* new KernelTypeError({
          message: "Map keys must be strings",
          expected: "string",
          got: describeType(k),
          loc: kExpr.loc,
        });
      }
      const v = yield* evalExpr(vExpr, env, runtime);
      result.set(key, v);
    }
    return result as ReadonlyMap<string, KValue>;
  });
}

export function evalList(
  items: readonly SExpr[],
  loc: Loc,
  env: Env,
  runtime: EvaluatorRuntime,
): Effect.Effect<KValue, KernelError> {
  return Effect.gen(function* () {
    if (items.length === 0) {
      return [] as readonly KValue[];
    }

    const head = items[0]!;

    // Check for special forms
    if (head._tag === "Sym") {
      switch (head.name) {
        case "fn":
          return yield* evalFn(items, loc, env);
        case "let":
          return yield* evalLet(items, loc, env, runtime, evalExpr);
        case "if":
          return yield* evalIf(items, loc, env, runtime, evalExpr);
        case "do":
          return yield* evalDo(items, env, runtime, evalExpr);
        case "match":
          return yield* evalMatch(items, loc, env, runtime, evalExpr);
        case "define":
          return yield* evalDef(items, loc, env, runtime, evalExpr);
        case ":":
          return items[1] ? yield* evalExpr(items[1], env, runtime) : null;
        case "quote":
          if (items.length !== 2) return yield* new ArityError({ name: "quote", expected: 1, got: items.length - 1, loc });
          return quotedDatum(items[1]!);
        case "quasiquote":
          return yield* evalQuasiquoteForm(items, loc, env, runtime, evalExpr);
        case "unquote":
          return yield* new KernelTypeError({
            message: "unquote outside of quasiquote",
            expected: "quasiquote context",
            got: "bare unquote",
            loc,
          });
        case "unquote-splicing":
          return yield* new KernelTypeError({
            message: "unquote-splicing outside of quasiquote",
            expected: "quasiquote context",
            got: "bare unquote-splicing",
            loc,
          });
        case "__macro":
          return yield* evalDefMacro(items, loc, env);
        case "__typeclass":
          // No-op at runtime — type system handles class definitions
          return null;
        case "instance":
          // instance inside nested scope — should not happen normally,
          // but handle gracefully by delegating to evalInstance
          return (yield* evalInstance(items, loc, env, runtime, evalExpr)).result;
      }

      if (items.length === 1 && /^[A-Z]/.test(head.name) && env.has(head.name)) {
        const value = env.lookup(head.name)!;
        if (!isKFn(value) && !isKBuiltin(value) && !isKMacro(value)) return value;
      }
      // Check builtins — args are NOT in tail position
      if (head.name in runtime.builtins) {
        const prevTail = getTcoTail();
        setTcoTail(false);
        const args: KValue[] = [];
        for (let i = 1; i < items.length; i++) {
          args.push(yield* evalExpr(items[i]!, env, runtime));
        }
        setTcoTail(prevTail);
        const applyFn = (fn: KValue, fnArgs: readonly KValue[]) =>
          applyCallableValue(fn, fnArgs, runtime);
        try {
          return yield* runtime.builtins[head.name]!(args, applyFn);
        } catch (e) {
          if (e instanceof TypeCheckError) {
            return yield* new KernelTypeError({
              message: e.message,
              expected: e.expected,
              got: e.got,
              loc,
            });
          }
          throw e;
        }
      }
    }

    // General function application: the callee itself is not in tail position.
    const prevHeadTail = getTcoTail();
    setTcoTail(false);
    const fn = yield* evalExpr(head, env, runtime);
    setTcoTail(prevHeadTail);

    // Macro invocation: pass unevaluated args as KSExpr, evaluate result
    if (isKMacro(fn)) {
      return yield* applyMacro(fn, items.slice(1), env, runtime, loc, evalExpr);
    }

    if (isKFn(fn)) {
      // Evaluate args in non-tail position
      const prevTail = getTcoTail();
      setTcoTail(false);
      const args: KValue[] = [];
      for (let i = 1; i < items.length; i++) {
        args.push(yield* evalExpr(items[i]!, env, runtime));
      }
      setTcoTail(prevTail);

      // TCO: if this is a self-call in tail position, return a trampoline sentinel
      if (getTcoTail() && getTcoSelf() !== null && fn === getTcoSelf()) {
        return { _tag: "KTailCall" as const, args } as unknown as KValue;
      }

      return yield* applyKFn(fn, args, runtime);
    }

    // Check if it resolved to a builtin name — args are NOT in tail position
    if (typeof fn === "string" && fn in runtime.builtins) {
      const prevTail2 = getTcoTail();
      setTcoTail(false);
      const args: KValue[] = [];
      for (let i = 1; i < items.length; i++) {
        args.push(yield* evalExpr(items[i]!, env, runtime));
      }
      setTcoTail(prevTail2);
      const applyFn = (kfn: KValue, fnArgs: readonly KValue[]) =>
        applyCallableValue(kfn, fnArgs, runtime);
      return yield* runtime.builtins[fn]!(args, applyFn);
    }

    return yield* new KernelTypeError({
      message: `Cannot call ${describeType(fn)} as function`,
      expected: "function",
      got: describeType(fn),
      loc: head.loc,
    });
  });
}

// ---------------------------------------------------------------------------
// Function application (TCO trampoline)
// ---------------------------------------------------------------------------

export function applyKFn(
  fn: KFn,
  args: readonly KValue[],
  runtime: EvaluatorRuntime,
): Effect.Effect<KValue, KernelError> {
  // Dispatch wrapper override — call directly without param binding
  if (fn.apply) {
    return fn.apply(args, runtime);
  }

  return Effect.gen(function* () {
    let currentArgs = args;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (fn.restParam) {
        if (currentArgs.length < fn.params.length) {
          return yield* Effect.fail(
            new ArityError({
              name: "lambda",
              expected: `${fn.params.length}+`,
              got: currentArgs.length,
            }),
          );
        }
      } else if (currentArgs.length !== fn.params.length) {
        return yield* Effect.fail(
          new ArityError({
            name: "lambda",
            expected: fn.params.length,
            got: currentArgs.length,
          }),
        );
      }

      const bindings: Record<string, KValue> = {};
      for (let i = 0; i < fn.params.length; i++) {
        bindings[fn.params[i]!] = currentArgs[i]!;
      }
      if (fn.restParam) {
        bindings[fn.restParam] = currentArgs.slice(fn.params.length);
      }
      const callEnv = fn.closure.extend(bindings);

      const prevSelf = getTcoSelf();
      const prevTail = getTcoTail();
      setTcoSelf(fn);
      setTcoTail(true);
      const result: KValue | KTailCall = yield* evalExpr(
        fn.body,
        callEnv,
        runtime,
      ) as Effect.Effect<KValue | KTailCall, KernelError>;
      setTcoSelf(prevSelf);
      setTcoTail(prevTail);

      if (isKTailCall(result)) {
        const steps = yield* Ref.updateAndGet(runtime.counter, (n) => n + 1);
        if (steps > runtime.stepLimit) {
          return yield* new StepLimitExceeded({ limit: runtime.stepLimit });
        }
        currentArgs = result.args;
        continue;
      }
      return result;
    }
  });
}

export function toKernelError(error: unknown): KernelError {
  if (typeof error === "object" && error !== null && "_tag" in error) {
    return error as KernelError;
  }
  return new KernelTypeError({
    message: error instanceof Error ? error.message : String(error),
    expected: "successful runtime execution",
    got: "unexpected error",
  });
}

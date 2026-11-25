/**
 * HM type inference for operational Effect combinators, Stream operations,
 * Ref/Fiber primitives, Config/Decode, and Layer declarations.
 */
import { Effect, Ref } from "effect";
import type { Type, Row } from "./types.js";
import {
  TVar,
  TApp,
  TCon,
  TFun,
  TRow,
  REmpty,
  RExtend,
  tBool,
  tFloat,
  tInt,
  tList,
  tNil,
  tStr,
  tUnknown,
  mono,
  Scheme as mkScheme,
  fnType,
  showType,
} from "./types.js";
import { builtinScheme, type BuiltinSchemeProvider } from "./builtin-schemes.js";
import { applyEnv, applyType, type TypeEnv } from "./substitution.js";
import { assignType, joinType } from "./assign.js";
import { unify } from "./unify.js";
import { InferContext } from "./context.js";
import { InferenceError, type Origin } from "./errors.js";
import type { CoreExpr } from "./core-expr.js";
import { TESym } from "./core-expr.js";
import { checkExpr } from "./check-expr.js";
import { originOf, typeExprToType } from "./infer-core.js";
import { requireNumeric } from "./numeric.js";
import {
  buildOperationalEffect,
  checkEffectSetInclusion,
  effectSetFromArgs,
  effectSetOf,
  effectSetToType,
  emptyEffectSet,
  extractOperationalEffect,
  reprovenanceEffectSet,
  unionEffectSets,
  type EffectProvenance,
} from "./effect-sets.js";
import type { InferFn } from "./infer-binding.js";

/**
 * Builtin scheme provider for Effect programs: extends core `builtinScheme`
 * with the Effect-library pure helpers (Option, Map, List, Duration, Schedule).
 */
export function effectBuiltinScheme(
  fallback: BuiltinSchemeProvider = builtinScheme,
): BuiltinSchemeProvider {
  return (name) => {
    const core = fallback(name);
    if (core) return core;
    switch (name) {
      case "not":
        return mono(fnType([tBool], tBool));
      case "empty?": {
        const aId = "__empty_a";
        return mkScheme([aId], [], fnType([TApp(tList, [TVar(aId)])], tBool));
      }
      case "any?":
      case "every?": {
        const aId = "__quant_a";
        return mkScheme([aId], [], fnType([fnType([TVar(aId)], tBool), TApp(tList, [TVar(aId)])], tBool));
      }
      case "find": {
        const aId = "__find_a";
        return mkScheme(
          [aId],
          [],
          fnType([fnType([TVar(aId)], tBool), TApp(tList, [TVar(aId)])], TApp(TCon("Option"), [TVar(aId)])),
        );
      }
      case "includes?": {
        const aId = "__inc_a";
        const bId = "__inc_b";
        return mkScheme([aId, bId], [], fnType([TVar(aId), TVar(bId)], tBool));
      }
      case "sum": {
        const aId = "__sum_a";
        const a = TVar(aId);
        return mkScheme([aId], [], fnType([TApp(tList, [a])], a), [], [{ className: "$Numeric", args: [a] }]);
      }
      case "keys": {
        const kId = "__keys_k", vId = "__keys_v";
        return mkScheme([kId, vId], [], fnType([TApp(TCon("Map"), [TVar(kId), TVar(vId)])], TApp(tList, [TVar(kId)])));
      }
      case "vals": {
        const kId = "__vals_k", vId = "__vals_v";
        return mkScheme([kId, vId], [], fnType([TApp(TCon("Map"), [TVar(kId), TVar(vId)])], TApp(tList, [TVar(vId)])));
      }
      case "dissoc": {
        const kId = "__dissoc_k", vId = "__dissoc_v";
        const m = TApp(TCon("Map"), [TVar(kId), TVar(vId)]);
        return mkScheme([kId, vId], [], fnType([m, TVar(kId)], m));
      }
      case "has-key?": {
        const kId = "__haskey_k", vId = "__haskey_v";
        return mkScheme([kId, vId], [], fnType([TApp(TCon("Map"), [TVar(kId), TVar(vId)]), TVar(kId)], tBool));
      }
      case "assoc": {
        const kId = "__assoc_k", vId = "__assoc_v";
        const m = TApp(TCon("Map"), [TVar(kId), TVar(vId)]);
        return mkScheme([kId, vId], [], fnType([m, TVar(kId), TVar(vId)], m));
      }
      case "get-or-else": {
        const aId = "__goe_a";
        const a = TVar(aId);
        return mkScheme([aId], [], fnType([TApp(TCon("Option"), [a]), a], a));
      }
      case "is-some":
      case "is-none": {
        const aId = "__opt_a";
        return mkScheme([aId], [], fnType([TApp(TCon("Option"), [TVar(aId)])], tBool));
      }
      case "millis":
      case "seconds":
      case "minutes": {
        const aId = "__dur_a";
        const a = TVar(aId);
        return mkScheme([aId], [], fnType([a], TCon("Duration")), [], [{ className: "$Numeric", args: [a] }]);
      }
      case "spaced":
      case "exponential":
      case "fixed": {
        const aId = "__sched_a";
        return mkScheme([aId], [], fnType([TVar(aId)], TCon("Schedule")));
      }
      case "recurs":
        return mono(fnType([tInt], TCon("Schedule")));
      case "jittered":
        return mono(fnType([TCon("Schedule")], TCon("Schedule")));
      case "to-string": {
        const aId = "__tostr_a";
        return mkScheme([aId], [], fnType([TVar(aId)], tStr));
      }
      default:
        return undefined;
    }
  };
}

export const EFFECT_COMBINATORS: ReadonlySet<string> = new Set([
  "scoped",
  "acquire-release",
  "ensuring",
  "add-finalizer",
  "all",
  "for-each",
  "race",
  "fork",
  "join",
  "interrupt",
  "sleep",
  "timeout",
  "retry",
  "repeat",
  "map-error",
  "or-else-succeed",
  "or-die",
  "option",
  "result",
  "provide",
  "log",
  "config",
  "decode",
  "ref-make",
  "ref-get",
  "ref-set",
  "ref-update",
  "stream-of",
  "stream-range",
  "stream-map",
  "stream-filter",
  "stream-take",
  "stream-map-effect",
  "stream-run-collect",
  "stream-run-fold",
  "stream-run-for-each",
  "layer-merge",
  "layer-provide",
  "layer-provide-merge",
]);

/** Built-in operational error types that catch/fail can reference without an explicit (error ...) form. */
export const BUILTIN_EFFECT_ERRORS: ReadonlySet<string> = new Set([
  "ConfigError",
  "SchemaError",
  "TimeoutError",
]);

interface StreamParts {
  readonly item: Type;
  readonly errors: EffectProvenance;
  readonly requirements: EffectProvenance;
}

interface FiberParts {
  readonly success: Type;
  readonly errors: EffectProvenance;
}

interface LayerParts {
  readonly provides: EffectProvenance;
  readonly errors: EffectProvenance;
  readonly requirements: EffectProvenance;
}

function extractStream(type: Type): StreamParts | undefined {
  if (type._tag !== "TApp" || type.con._tag !== "TCon" || type.con.name !== "Stream" || type.args.length !== 3) {
    return undefined;
  }
  const [item, errT, reqT] = type.args;
  if (!item || !errT || !reqT) return undefined;
  if (errT._tag !== "TApp" || reqT._tag !== "TApp") return undefined;
  return {
    item,
    errors: effectSetFromArgs(errT.args),
    requirements: effectSetFromArgs(reqT.args),
  };
}

function buildStream(item: Type, errors: EffectProvenance = emptyEffectSet, requirements: EffectProvenance = emptyEffectSet): Type {
  return TApp(TCon("Stream"), [
    item,
    effectSetToType("error", errors),
    effectSetToType("requirement", requirements),
  ]);
}

function extractFiber(type: Type): FiberParts | undefined {
  if (type._tag !== "TApp" || type.con._tag !== "TCon" || type.con.name !== "Fiber" || type.args.length !== 2) {
    return undefined;
  }
  const [success, errT] = type.args;
  if (!success || !errT || errT._tag !== "TApp") return undefined;
  return { success, errors: effectSetFromArgs(errT.args) };
}

function buildFiber(success: Type, errors: EffectProvenance = emptyEffectSet): Type {
  return TApp(TCon("Fiber"), [success, effectSetToType("error", errors)]);
}

export function extractLayer(type: Type): LayerParts | undefined {
  if (type._tag !== "TApp" || type.con._tag !== "TCon" || type.con.name !== "Layer" || type.args.length !== 3) {
    return undefined;
  }
  const [provT, errT, reqT] = type.args;
  if (!provT || !errT || !reqT) return undefined;
  if (provT._tag !== "TApp" || errT._tag !== "TApp" || reqT._tag !== "TApp") return undefined;
  return {
    provides: effectSetFromArgs(provT.args),
    errors: effectSetFromArgs(errT.args),
    requirements: effectSetFromArgs(reqT.args),
  };
}

export function buildLayer(
  provides: EffectProvenance,
  errors: EffectProvenance = emptyEffectSet,
  requirements: EffectProvenance = emptyEffectSet,
): Type {
  return TApp(TCon("Layer"), [
    effectSetToType("requirement", provides),
    effectSetToType("error", errors),
    effectSetToType("requirement", requirements),
  ]);
}

function withoutKey(set: EffectProvenance, key: string): EffectProvenance {
  const next = new Map(set);
  next.delete(key);
  return next;
}

function subtractProvidedServices(requirements: EffectProvenance, provides: EffectProvenance): EffectProvenance {
  const next = new Map<string, typeof requirements extends ReadonlyMap<string, infer V> ? V : never>();
  for (const [req, span] of requirements) {
    const service = req.includes(".") ? req.slice(0, req.indexOf(".")) : req;
    if (!provides.has(req) && !provides.has(service)) {
      next.set(req, span);
    }
  }
  return next;
}

function splitKeywordOptions(
  args: readonly CoreExpr[],
  startIndex: number,
  origin: Origin,
): Effect.Effect<ReadonlyMap<string, CoreExpr>, InferenceError, InferContext> {
  return Effect.gen(function* () {
    const ctx = yield* InferContext;
    const options = new Map<string, CoreExpr>();
    const rest = args.slice(startIndex);
    if (rest.length % 2 !== 0) {
      return yield* ctx.fail(origin, { code: "typecheck/arity", message: "Combinator options must be keyword/value pairs." });
    }
    for (let i = 0; i < rest.length; i += 2) {
      const key = rest[i]!;
      if (key._tag !== "Lit" || key.lit._tag !== "LKeyword") {
        return yield* ctx.fail(originOf(key, "option"), { code: "typecheck/lower", message: "Expected a keyword option." });
      }
      options.set(key.lit.value, rest[i + 1]!);
    }
    return options;
  });
}

function checkConcurrencyOption(
  env: TypeEnv,
  option: CoreExpr | undefined,
  inferExpr: InferFn,
): Effect.Effect<void, InferenceError, InferContext> {
  return Effect.gen(function* () {
    if (!option) return;
    if (option._tag === "Lit" && option.lit._tag === "LKeyword" && option.lit.value === ":unbounded") {
      return;
    }
    const t = yield* inferExpr(env, option);
    yield* assignType(t, tInt, originOf(option, "concurrency"));
  });
}

function checkDurationArg(
  env: TypeEnv,
  arg: CoreExpr,
  inferExpr: InferFn,
): Effect.Effect<void, InferenceError, InferContext> {
  return Effect.gen(function* () {
    const ctx = yield* InferContext;
    const t = applyType(yield* Ref.get(ctx.subst), yield* inferExpr(env, arg));
    if (t._tag === "TCon" && t.name === "Duration") return;
    yield* requireNumeric(t, originOf(arg, "duration"));
  });
}

function requireEffect(
  type: Type,
  origin: Origin,
  what = "Effect",
): Effect.Effect<NonNullable<ReturnType<typeof extractOperationalEffect>>, InferenceError, InferContext> {
  return Effect.gen(function* () {
    const ctx = yield* InferContext;
    const resolved = applyType(yield* Ref.get(ctx.subst), type);
    const eff = extractOperationalEffect(resolved, origin.span);
    if (!eff) {
      const got = showType(resolved);
      return yield* ctx.fail(origin, {
        code: "typecheck/type-mismatch",
        message: `Expected ${what}, found ${got}`,
        expected: what,
        got,
      });
    }
    return eff;
  });
}

function requireNoFailure(
  errors: EffectProvenance,
  what: string,
  origin: Origin,
): Effect.Effect<void, InferenceError, InferContext> {
  return Effect.gen(function* () {
    if (errors.size === 0) return;
    const ctx = yield* InferContext;
    return yield* ctx.fail(origin, {
      code: "mechanics/finalizer-failure",
      message: `${what} must not fail, but it can fail with [${[...errors.keys()].join(" ")}]; recover with catch or or-die.`,
    });
  });
}

/**
 * Infer a call to an operational Effect, Stream, Ref, Fiber, or Layer combinator.
 * Returns `undefined` when the call should fall through to normal HM inference
 * (for example 2-argument string `join`).
 */
export const inferEffectCombinator = (
  env: TypeEnv,
  expr: CoreExpr & { _tag: "App" },
  name: string,
  inferExpr: InferFn,
  expected?: Type,
): Effect.Effect<Type | undefined, InferenceError, InferContext> =>
  Effect.gen(function* () {
    const ctx = yield* InferContext;
    const origin = originOf(expr, `effect-${name}`);
    const expectedEffect = expected ? extractOperationalEffect(expected) : undefined;

    // 2-argument `join` is string join `(join xs sep)`; 1-argument `join` is Fiber join.
    if (name === "join" && expr.args.length !== 1) {
      return undefined;
    }

    switch (name) {
      case "scoped": {
        if (expr.args.length !== 1) {
          return yield* ctx.fail(origin, { code: "typecheck/arity", message: "scoped expects 1 argument" });
        }
        const eff = yield* requireEffect(yield* inferExpr(env, expr.args[0]!), origin);
        return buildOperationalEffect(eff.success, eff.errors, withoutKey(eff.requirements, "Scope"));
      }

      case "acquire-release": {
        if (expr.args.length !== 2) {
          return yield* ctx.fail(origin, { code: "typecheck/arity", message: "acquire-release expects acquire and release arguments" });
        }
        const acquire = yield* requireEffect(yield* inferExpr(env, expr.args[0]!), originOf(expr.args[0]!, "acquire"));
        const releaseFnT = yield* checkExpr(
          applyEnv(yield* Ref.get(ctx.subst), env),
          expr.args[1]!,
          TFun(acquire.success, yield* ctx.freshTVar),
        );
        const resolvedRelease = applyType(yield* Ref.get(ctx.subst), releaseFnT);
        if (resolvedRelease._tag !== "TFun") {
          const got = showType(resolvedRelease);
          return yield* ctx.fail(originOf(expr.args[1]!, "release"), {
            code: "typecheck/type-mismatch",
            message: `acquire-release release must be a function, found ${got}`,
            expected: "Function",
            got,
          });
        }
        const releaseEff = yield* requireEffect(resolvedRelease.res, originOf(expr.args[1]!, "release"));
        yield* requireNoFailure(releaseEff.errors, "The release action of acquire-release", originOf(expr.args[1]!, "release"));
        return buildOperationalEffect(
          acquire.success,
          acquire.errors,
          unionEffectSets(acquire.requirements, releaseEff.requirements, effectSetOf(["Scope"], expr.span)),
        );
      }

      case "ensuring": {
        if (expr.args.length !== 2) {
          return yield* ctx.fail(origin, { code: "typecheck/arity", message: "ensuring expects body and finalizer arguments" });
        }
        const body = yield* requireEffect(yield* inferExpr(env, expr.args[0]!), originOf(expr.args[0]!, "ensuring-body"));
        const finalizer = yield* requireEffect(
          yield* inferExpr(applyEnv(yield* Ref.get(ctx.subst), env), expr.args[1]!),
          originOf(expr.args[1]!, "ensuring-finalizer"),
        );
        yield* requireNoFailure(finalizer.errors, "An ensuring finalizer", originOf(expr.args[1]!, "ensuring-finalizer"));
        return buildOperationalEffect(body.success, body.errors, unionEffectSets(body.requirements, finalizer.requirements));
      }

      case "add-finalizer": {
        if (expr.args.length !== 1) {
          return yield* ctx.fail(origin, { code: "typecheck/arity", message: "add-finalizer expects 1 argument" });
        }
        const finalizer = yield* requireEffect(yield* inferExpr(env, expr.args[0]!), originOf(expr.args[0]!, "finalizer"));
        yield* requireNoFailure(finalizer.errors, "A finalizer", originOf(expr.args[0]!, "finalizer"));
        return buildOperationalEffect(tNil, emptyEffectSet, unionEffectSets(finalizer.requirements, effectSetOf(["Scope"], expr.span)));
      }

      case "all": {
        if (expr.args.length < 1) {
          return yield* ctx.fail(origin, { code: "typecheck/arity", message: "all expects a record or vector of effects" });
        }
        const options = yield* splitKeywordOptions(expr.args, 1, origin);
        yield* checkConcurrencyOption(env, options.get(":concurrency"), inferExpr);
        const collection = expr.args[0]!;
        if (collection._tag === "Record") {
          const results: Array<{ label: string; type: Type }> = [];
          let errors: EffectProvenance = emptyEffectSet;
          let requirements: EffectProvenance = emptyEffectSet;
          for (const field of collection.fields) {
            const eff = yield* requireEffect(
              yield* inferExpr(applyEnv(yield* Ref.get(ctx.subst), env), field.value),
              originOf(field.value, "all-field"),
            );
            results.push({ label: field.label, type: eff.success });
            errors = unionEffectSets(errors, eff.errors);
            requirements = unionEffectSets(requirements, eff.requirements);
          }
          let row: Row = REmpty;
          for (let i = results.length - 1; i >= 0; i--) {
            row = RExtend(results[i]!.label, results[i]!.type, row);
          }
          return buildOperationalEffect(TRow(row), errors, requirements);
        }
        if (collection._tag === "App" && collection.fn._tag === "Var" && collection.fn.name === "__vector") {
          const expectedTuple =
            expectedEffect?.success._tag === "TApp" &&
            expectedEffect.success.con._tag === "TCon" &&
            expectedEffect.success.con.name === "Tuple"
              ? expectedEffect.success.args
              : undefined;
          const itemTypes: Type[] = [];
          let errors: EffectProvenance = emptyEffectSet;
          let requirements: EffectProvenance = emptyEffectSet;
          for (let i = 0; i < collection.args.length; i++) {
            const item = collection.args[i]!;
            const expectedItem = expectedTuple?.[i];
            const rawT = expectedItem
              ? yield* checkExpr(
                  applyEnv(yield* Ref.get(ctx.subst), env),
                  item,
                  buildOperationalEffect(expectedItem, expectedEffect!.errors, expectedEffect!.requirements),
                )
              : yield* inferExpr(applyEnv(yield* Ref.get(ctx.subst), env), item);
            const eff = yield* requireEffect(rawT, originOf(item, "all-item"));
            itemTypes.push(eff.success);
            errors = unionEffectSets(errors, eff.errors);
            requirements = unionEffectSets(requirements, eff.requirements);
          }
          return buildOperationalEffect(TApp(TCon("Tuple"), itemTypes), errors, requirements);
        }
        return yield* ctx.fail(originOf(collection, "all"), {
          code: "typecheck/type-mismatch",
          message: "all expects a record or vector of effects",
          expected: "Record or Vector of Effects",
          got: collection._tag,
        });
      }

      case "for-each": {
        if (expr.args.length < 2) {
          return yield* ctx.fail(origin, { code: "typecheck/arity", message: "for-each expects a list and a callback" });
        }
        const options = yield* splitKeywordOptions(expr.args, 2, origin);
        yield* checkConcurrencyOption(env, options.get(":concurrency"), inferExpr);
        const listT = applyType(yield* Ref.get(ctx.subst), yield* inferExpr(env, expr.args[0]!));
        const itemT = yield* ctx.freshTVar;
        yield* assignType(listT, TApp(tList, [itemT]), originOf(expr.args[0]!, "for-each-items"));
        const resolvedItem = applyType(yield* Ref.get(ctx.subst), itemT);
        const expectedListElem =
          expectedEffect?.success._tag === "TApp" &&
          expectedEffect.success.con._tag === "TCon" &&
          expectedEffect.success.con.name === "List" &&
          expectedEffect.success.args.length === 1
            ? expectedEffect.success.args[0]
            : undefined;
        const callbackTarget = expectedListElem
          ? TFun(
              resolvedItem,
              buildOperationalEffect(expectedListElem, expectedEffect!.errors, expectedEffect!.requirements),
            )
          : TFun(resolvedItem, yield* ctx.freshTVar);
        const fnT = applyType(
          yield* Ref.get(ctx.subst),
          yield* checkExpr(
            applyEnv(yield* Ref.get(ctx.subst), env),
            expr.args[1]!,
            callbackTarget,
          ),
        );
        if (fnT._tag !== "TFun") {
          const got = showType(fnT);
          return yield* ctx.fail(originOf(expr.args[1]!, "for-each-fn"), {
            code: "typecheck/type-mismatch",
            message: `for-each callback must be a function, found ${got}`,
            expected: "Function",
            got,
          });
        }
        const eff = yield* requireEffect(fnT.res, originOf(expr.args[1]!, "for-each-fn"));
        return buildOperationalEffect(TApp(tList, [eff.success]), eff.errors, eff.requirements);
      }

      case "race": {
        if (expr.args.length !== 2) {
          return yield* ctx.fail(origin, { code: "typecheck/arity", message: "race expects 2 effects" });
        }
        const left = yield* requireEffect(yield* inferExpr(env, expr.args[0]!), originOf(expr.args[0]!, "race-left"));
        const right = yield* requireEffect(
          yield* inferExpr(applyEnv(yield* Ref.get(ctx.subst), env), expr.args[1]!),
          originOf(expr.args[1]!, "race-right"),
        );
        const success = yield* joinType(left.success, right.success, origin);
        return buildOperationalEffect(
          success,
          unionEffectSets(left.errors, right.errors),
          unionEffectSets(left.requirements, right.requirements),
        );
      }

      case "fork": {
        if (expr.args.length !== 1) {
          return yield* ctx.fail(origin, { code: "typecheck/arity", message: "fork expects 1 effect" });
        }
        const body = yield* requireEffect(yield* inferExpr(env, expr.args[0]!), originOf(expr.args[0]!, "fork"));
        return buildOperationalEffect(buildFiber(body.success, body.errors), emptyEffectSet, body.requirements);
      }

      case "join":
      case "interrupt": {
        if (expr.args.length !== 1) {
          return yield* ctx.fail(origin, { code: "typecheck/arity", message: `${name} expects 1 fiber argument` });
        }
        const fiberT = applyType(yield* Ref.get(ctx.subst), yield* inferExpr(env, expr.args[0]!));
        const fiber = extractFiber(fiberT);
        if (!fiber) {
          const got = showType(fiberT);
          return yield* ctx.fail(originOf(expr.args[0]!, name), {
            code: "typecheck/type-mismatch",
            message: `${name} expects a Fiber from fork, found ${got}`,
            expected: "Fiber",
            got,
          });
        }
        return name === "join"
          ? buildOperationalEffect(fiber.success, fiber.errors, emptyEffectSet)
          : buildOperationalEffect(tNil, emptyEffectSet, emptyEffectSet);
      }

      case "sleep": {
        if (expr.args.length !== 1) {
          return yield* ctx.fail(origin, { code: "typecheck/arity", message: "sleep expects 1 duration argument" });
        }
        yield* checkDurationArg(env, expr.args[0]!, inferExpr);
        return buildOperationalEffect(tNil);
      }

      case "timeout": {
        if (expr.args.length !== 2) {
          return yield* ctx.fail(origin, { code: "typecheck/arity", message: "timeout expects an effect and a duration" });
        }
        const body = yield* requireEffect(yield* inferExpr(env, expr.args[0]!), originOf(expr.args[0]!, "timeout"));
        yield* checkDurationArg(applyEnv(yield* Ref.get(ctx.subst), env), expr.args[1]!, inferExpr);
        return buildOperationalEffect(
          body.success,
          unionEffectSets(body.errors, effectSetOf(["TimeoutError"], expr.span)),
          body.requirements,
        );
      }

      case "retry":
      case "repeat": {
        if (expr.args.length < 3) {
          return yield* ctx.fail(origin, {
            code: "mechanics/retry-policy",
            message: `${name} needs an effect and a policy such as :times 3 or :schedule (spaced 100).`,
          });
        }
        const body = yield* requireEffect(yield* inferExpr(env, expr.args[0]!), originOf(expr.args[0]!, name));
        const options = yield* splitKeywordOptions(expr.args, 1, origin);
        const times = options.get(":times");
        const schedule = options.get(":schedule");
        if (!times && !schedule) {
          return yield* ctx.fail(origin, {
            code: "mechanics/retry-policy",
            message: `${name} needs a policy such as :times 3 or :schedule (spaced 100).`,
          });
        }
        if (times) {
          yield* assignType(yield* inferExpr(applyEnv(yield* Ref.get(ctx.subst), env), times), tInt, originOf(times, "retry-times"));
        }
        if (schedule) {
          yield* assignType(yield* inferExpr(applyEnv(yield* Ref.get(ctx.subst), env), schedule), TCon("Schedule"), originOf(schedule, "retry-schedule"));
        }
        return buildOperationalEffect(body.success, body.errors, body.requirements);
      }

      case "map-error": {
        if (expr.args.length !== 2) {
          return yield* ctx.fail(origin, { code: "typecheck/arity", message: "map-error expects an effect and a mapping function" });
        }
        const body = yield* requireEffect(yield* inferExpr(env, expr.args[0]!), originOf(expr.args[0]!, "map-error"));
        if (body.errors.size === 0) {
          return yield* ctx.fail(origin, {
            code: "mechanics/impossible-catch",
            message: "map-error wraps an effect that cannot fail.",
          });
        }
        const errArgType =
          body.errors.size === 1
            ? TCon([...body.errors.keys()][0]!)
            : TRow(RExtend(":_tag", tStr, REmpty));
        const fnT = applyType(
          yield* Ref.get(ctx.subst),
          yield* checkExpr(
            applyEnv(yield* Ref.get(ctx.subst), env),
            expr.args[1]!,
            TFun(errArgType, yield* ctx.freshTVar),
          ),
        );
        if (fnT._tag !== "TFun") {
          const got = showType(fnT);
          return yield* ctx.fail(originOf(expr.args[1]!, "map-error"), {
            code: "typecheck/type-mismatch",
            message: `map-error expects a function, found ${got}`,
            expected: "Function",
            got,
          });
        }
        const resultT = applyType(yield* Ref.get(ctx.subst), fnT.res);
        const errorTypes = yield* Ref.get(ctx.errorTypes);
        const newErrors: string[] = [];
        if (resultT._tag === "TCon" && (errorTypes.has(resultT.name) || BUILTIN_EFFECT_ERRORS.has(resultT.name))) {
          newErrors.push(resultT.name);
        } else if (resultT._tag === "TApp" && resultT.con._tag === "TCon" && resultT.con.name === "Union") {
          for (const member of resultT.args) {
            if (member._tag === "TCon" && (errorTypes.has(member.name) || BUILTIN_EFFECT_ERRORS.has(member.name))) {
              newErrors.push(member.name);
            } else {
              return yield* ctx.fail(originOf(expr.args[1]!, "map-error"), {
                code: "mechanics/fail-value",
                message: `map-error must return an error declared with error, but returns ${showType(resultT)}.`,
              });
            }
          }
        } else {
          return yield* ctx.fail(originOf(expr.args[1]!, "map-error"), {
            code: "mechanics/fail-value",
            message: `map-error must return an error declared with error, but returns ${showType(resultT)}.`,
          });
        }
        return buildOperationalEffect(body.success, effectSetOf(newErrors, expr.args[1]!.span), body.requirements);
      }

      case "or-else-succeed": {
        if (expr.args.length !== 2) {
          return yield* ctx.fail(origin, { code: "typecheck/arity", message: "or-else-succeed expects an effect and a fallback value" });
        }
        const body = yield* requireEffect(yield* inferExpr(env, expr.args[0]!), originOf(expr.args[0]!, "or-else-succeed"));
        if (body.errors.size === 0) {
          return yield* ctx.fail(origin, {
            code: "mechanics/impossible-catch",
            message: "or-else-succeed wraps an effect that cannot fail.",
          });
        }
        const fallback = yield* inferExpr(applyEnv(yield* Ref.get(ctx.subst), env), expr.args[1]!);
        const success = yield* joinType(body.success, fallback, origin);
        return buildOperationalEffect(success, emptyEffectSet, body.requirements);
      }

      case "or-die": {
        if (expr.args.length !== 1) {
          return yield* ctx.fail(origin, { code: "typecheck/arity", message: "or-die expects 1 effect" });
        }
        const body = yield* requireEffect(yield* inferExpr(env, expr.args[0]!), originOf(expr.args[0]!, "or-die"));
        return buildOperationalEffect(body.success, emptyEffectSet, body.requirements);
      }

      case "option": {
        if (expr.args.length !== 1) {
          return yield* ctx.fail(origin, { code: "typecheck/arity", message: "option expects 1 effect" });
        }
        const body = yield* requireEffect(yield* inferExpr(env, expr.args[0]!), originOf(expr.args[0]!, "option"));
        return buildOperationalEffect(TApp(TCon("Option"), [body.success]), emptyEffectSet, body.requirements);
      }

      case "result": {
        if (expr.args.length !== 1) {
          return yield* ctx.fail(origin, { code: "typecheck/arity", message: "result expects 1 effect" });
        }
        const body = yield* requireEffect(yield* inferExpr(env, expr.args[0]!), originOf(expr.args[0]!, "result"));
        const errT =
          body.errors.size === 0
            ? TCon("Never")
            : body.errors.size === 1
              ? TCon([...body.errors.keys()][0]!)
              : TApp(TCon("Union"), [...body.errors.keys()].map((k) => TCon(k)));
        return buildOperationalEffect(TApp(TCon("Result"), [body.success, errT]), emptyEffectSet, body.requirements);
      }

      case "provide": {
        if (expr.args.length !== 2) {
          return yield* ctx.fail(origin, { code: "typecheck/arity", message: "provide expects an effect and a layer" });
        }
        const body = yield* requireEffect(yield* inferExpr(env, expr.args[0]!), originOf(expr.args[0]!, "provide-effect"));
        const layerT = applyType(yield* Ref.get(ctx.subst), yield* inferExpr(applyEnv(yield* Ref.get(ctx.subst), env), expr.args[1]!));
        const layer = extractLayer(layerT);
        if (!layer) {
          return yield* ctx.fail(originOf(expr.args[1]!, "provide-layer"), {
            code: "mechanics/provide",
            message: `provide expects a Layer, found ${showType(layerT)}`,
          });
        }
        return buildOperationalEffect(
          body.success,
          unionEffectSets(body.errors, reprovenanceEffectSet(layer.errors, expr.span)),
          unionEffectSets(
            subtractProvidedServices(body.requirements, layer.provides),
            reprovenanceEffectSet(layer.requirements, expr.span),
          ),
        );
      }

      case "log": {
        for (const arg of expr.args) {
          yield* inferExpr(applyEnv(yield* Ref.get(ctx.subst), env), arg);
        }
        return buildOperationalEffect(tNil);
      }

      case "config": {
        if (expr.args.length < 2) {
          return yield* ctx.fail(origin, { code: "typecheck/arity", message: "config expects a type and a key name" });
        }
        const typeArg = expr.args[0]!;
        const typeName = typeArg._tag === "Var" ? typeArg.name : undefined;
        const configType =
          typeName === "String" ? tStr
          : typeName === "Int" ? tInt
          : typeName === "Float" ? tFloat
          : typeName === "Bool" || typeName === "Boolean" ? tBool
          : undefined;
        if (!configType) {
          return yield* ctx.fail(originOf(typeArg, "config-type"), {
            code: "mechanics/config-type",
            message: `config reads String, Int, Float, or Bool values, not ${typeName ?? "this"}.`,
          });
        }
        yield* assignType(yield* inferExpr(env, expr.args[1]!), tStr, originOf(expr.args[1]!, "config-key"));
        const options = yield* splitKeywordOptions(expr.args, 2, origin);
        const fallback = options.get(":default");
        if (fallback) {
          yield* checkExpr(applyEnv(yield* Ref.get(ctx.subst), env), fallback, configType);
        }
        return buildOperationalEffect(
          configType,
          fallback ? emptyEffectSet : effectSetOf(["ConfigError"], expr.span),
        );
      }

      case "decode": {
        if (expr.args.length !== 2) {
          return yield* ctx.fail(origin, { code: "typecheck/arity", message: "decode expects a schema type name and an input value" });
        }
        const schemaArg = expr.args[0]!;
        const schemaName = schemaArg._tag === "Var" ? schemaArg.name : undefined;
        const aliases = yield* Ref.get(ctx.typeAliases);
        const nominals = yield* Ref.get(ctx.nominalRecords);
        const adts = yield* Ref.get(ctx.adtRegistry);
        if (!schemaName || (!aliases.has(schemaName) && !nominals.has(schemaName) && !adts.has(schemaName))) {
          return yield* ctx.fail(originOf(schemaArg, "decode-schema"), {
            code: "mechanics/decode-schema",
            message: "decode expects the name of a schema defined with type.",
          });
        }
        yield* inferExpr(env, expr.args[1]!);
        const decodedType = yield* typeExprToType(TESym(schemaArg.span, schemaName), new Map(), new Map());
        return buildOperationalEffect(decodedType, effectSetOf(["SchemaError"], expr.span));
      }

      case "ref-make": {
        if (expr.args.length !== 1) {
          return yield* ctx.fail(origin, { code: "typecheck/arity", message: "ref-make expects 1 initial value" });
        }
        const initT = applyType(yield* Ref.get(ctx.subst), yield* inferExpr(env, expr.args[0]!));
        return buildOperationalEffect(TApp(TCon("Ref"), [initT]));
      }

      case "ref-get":
      case "ref-set":
      case "ref-update": {
        const expectedArity = name === "ref-get" ? 1 : 2;
        if (expr.args.length !== expectedArity) {
          return yield* ctx.fail(origin, { code: "typecheck/arity", message: `${name} expects ${expectedArity} argument(s)` });
        }
        const refT = applyType(yield* Ref.get(ctx.subst), yield* inferExpr(env, expr.args[0]!));
        if (!(refT._tag === "TApp" && refT.con._tag === "TCon" && refT.con.name === "Ref" && refT.args.length === 1)) {
          const got = showType(refT);
          return yield* ctx.fail(originOf(expr.args[0]!, name), {
            code: "typecheck/type-mismatch",
            message: `${name} expects a Ref from ref-make, found ${got}`,
            expected: "Ref",
            got,
          });
        }
        const itemT = refT.args[0]!;
        if (name === "ref-get") return buildOperationalEffect(itemT);
        if (name === "ref-set") {
          yield* checkExpr(applyEnv(yield* Ref.get(ctx.subst), env), expr.args[1]!, itemT);
          return buildOperationalEffect(tNil);
        }
        yield* checkExpr(applyEnv(yield* Ref.get(ctx.subst), env), expr.args[1]!, TFun(itemT, itemT));
        return buildOperationalEffect(tNil);
      }

      // -----------------------------------------------------------------
      // Stream operations
      // -----------------------------------------------------------------

      case "stream-of": {
        if (expr.args.length !== 1) {
          return yield* ctx.fail(origin, { code: "typecheck/arity", message: "stream-of expects 1 list argument" });
        }
        const listT = applyType(yield* Ref.get(ctx.subst), yield* inferExpr(env, expr.args[0]!));
        const itemT = yield* ctx.freshTVar;
        yield* assignType(listT, TApp(tList, [itemT]), originOf(expr.args[0]!, "stream-of"));
        return buildStream(applyType(yield* Ref.get(ctx.subst), itemT));
      }

      case "stream-range": {
        if (expr.args.length !== 2) {
          return yield* ctx.fail(origin, { code: "typecheck/arity", message: "stream-range expects start and end integers" });
        }
        yield* assignType(yield* inferExpr(env, expr.args[0]!), tInt, originOf(expr.args[0]!, "stream-range"));
        yield* assignType(yield* inferExpr(applyEnv(yield* Ref.get(ctx.subst), env), expr.args[1]!), tInt, originOf(expr.args[1]!, "stream-range"));
        return buildStream(tInt);
      }

      case "stream-map": {
        if (expr.args.length !== 2) {
          return yield* ctx.fail(origin, { code: "typecheck/arity", message: "stream-map expects a stream and a mapping function" });
        }
        const streamT = applyType(yield* Ref.get(ctx.subst), yield* inferExpr(env, expr.args[0]!));
        const stream = extractStream(streamT);
        if (!stream) {
          const got = showType(streamT);
          return yield* ctx.fail(originOf(expr.args[0]!, "stream-map"), {
            code: "typecheck/type-mismatch",
            message: `stream-map expects a Stream, found ${got}`,
            expected: "Stream",
            got,
          });
        }
        const outT = yield* ctx.freshTVar;
        yield* checkExpr(applyEnv(yield* Ref.get(ctx.subst), env), expr.args[1]!, TFun(stream.item, outT));
        return buildStream(applyType(yield* Ref.get(ctx.subst), outT), stream.errors, stream.requirements);
      }

      case "stream-filter": {
        if (expr.args.length !== 2) {
          return yield* ctx.fail(origin, { code: "typecheck/arity", message: "stream-filter expects a stream and a predicate" });
        }
        const streamT = applyType(yield* Ref.get(ctx.subst), yield* inferExpr(env, expr.args[0]!));
        const stream = extractStream(streamT);
        if (!stream) {
          const got = showType(streamT);
          return yield* ctx.fail(originOf(expr.args[0]!, "stream-filter"), {
            code: "typecheck/type-mismatch",
            message: `stream-filter expects a Stream, found ${got}`,
            expected: "Stream",
            got,
          });
        }
        yield* checkExpr(applyEnv(yield* Ref.get(ctx.subst), env), expr.args[1]!, TFun(stream.item, tBool));
        return buildStream(stream.item, stream.errors, stream.requirements);
      }

      case "stream-take": {
        if (expr.args.length !== 2) {
          return yield* ctx.fail(origin, { code: "typecheck/arity", message: "stream-take expects a stream and a count" });
        }
        const streamT = applyType(yield* Ref.get(ctx.subst), yield* inferExpr(env, expr.args[0]!));
        const stream = extractStream(streamT);
        if (!stream) {
          const got = showType(streamT);
          return yield* ctx.fail(originOf(expr.args[0]!, "stream-take"), {
            code: "typecheck/type-mismatch",
            message: `stream-take expects a Stream, found ${got}`,
            expected: "Stream",
            got,
          });
        }
        yield* assignType(yield* inferExpr(applyEnv(yield* Ref.get(ctx.subst), env), expr.args[1]!), tInt, originOf(expr.args[1]!, "stream-take"));
        return buildStream(stream.item, stream.errors, stream.requirements);
      }

      case "stream-map-effect": {
        if (expr.args.length < 2 || expr.args.length > 3) {
          return yield* ctx.fail(origin, { code: "typecheck/arity", message: "stream-map-effect expects a stream, callback, and optional concurrency" });
        }
        const streamT = applyType(yield* Ref.get(ctx.subst), yield* inferExpr(env, expr.args[0]!));
        const stream = extractStream(streamT);
        if (!stream) {
          const got = showType(streamT);
          return yield* ctx.fail(originOf(expr.args[0]!, "stream-map-effect"), {
            code: "typecheck/type-mismatch",
            message: `stream-map-effect expects a Stream, found ${got}`,
            expected: "Stream",
            got,
          });
        }
        if (expr.args[2]) {
          yield* checkConcurrencyOption(applyEnv(yield* Ref.get(ctx.subst), env), expr.args[2], inferExpr);
        }
        const fnT = applyType(
          yield* Ref.get(ctx.subst),
          yield* checkExpr(applyEnv(yield* Ref.get(ctx.subst), env), expr.args[1]!, TFun(stream.item, yield* ctx.freshTVar)),
        );
        if (fnT._tag !== "TFun") {
          const got = showType(fnT);
          return yield* ctx.fail(originOf(expr.args[1]!, "stream-map-effect"), {
            code: "typecheck/type-mismatch",
            message: `stream-map-effect callback must be a function, found ${got}`,
            expected: "Function",
            got,
          });
        }
        const eff = yield* requireEffect(fnT.res, originOf(expr.args[1]!, "stream-map-effect"));
        return buildStream(
          eff.success,
          unionEffectSets(stream.errors, eff.errors),
          unionEffectSets(stream.requirements, eff.requirements),
        );
      }

      case "stream-run-collect": {
        if (expr.args.length !== 1) {
          return yield* ctx.fail(origin, { code: "typecheck/arity", message: "stream-run-collect expects 1 stream" });
        }
        const streamT = applyType(yield* Ref.get(ctx.subst), yield* inferExpr(env, expr.args[0]!));
        const stream = extractStream(streamT);
        if (!stream) {
          const got = showType(streamT);
          return yield* ctx.fail(originOf(expr.args[0]!, "stream-run-collect"), {
            code: "typecheck/type-mismatch",
            message: `stream-run-collect expects a Stream, found ${got}`,
            expected: "Stream",
            got,
          });
        }
        return buildOperationalEffect(TApp(tList, [stream.item]), stream.errors, stream.requirements);
      }

      case "stream-run-fold": {
        if (expr.args.length !== 3) {
          return yield* ctx.fail(origin, { code: "typecheck/arity", message: "stream-run-fold expects a stream, initial value, and reducer" });
        }
        const streamT = applyType(yield* Ref.get(ctx.subst), yield* inferExpr(env, expr.args[0]!));
        const stream = extractStream(streamT);
        if (!stream) {
          const got = showType(streamT);
          return yield* ctx.fail(originOf(expr.args[0]!, "stream-run-fold"), {
            code: "typecheck/type-mismatch",
            message: `stream-run-fold expects a Stream, found ${got}`,
            expected: "Stream",
            got,
          });
        }
        const accT = applyType(yield* Ref.get(ctx.subst), yield* inferExpr(applyEnv(yield* Ref.get(ctx.subst), env), expr.args[1]!));
        yield* checkExpr(
          applyEnv(yield* Ref.get(ctx.subst), env),
          expr.args[2]!,
          fnType([accT, stream.item], accT),
        );
        return buildOperationalEffect(applyType(yield* Ref.get(ctx.subst), accT), stream.errors, stream.requirements);
      }

      case "stream-run-for-each": {
        if (expr.args.length !== 2) {
          return yield* ctx.fail(origin, { code: "typecheck/arity", message: "stream-run-for-each expects a stream and a callback" });
        }
        const streamT = applyType(yield* Ref.get(ctx.subst), yield* inferExpr(env, expr.args[0]!));
        const stream = extractStream(streamT);
        if (!stream) {
          const got = showType(streamT);
          return yield* ctx.fail(originOf(expr.args[0]!, "stream-run-for-each"), {
            code: "typecheck/type-mismatch",
            message: `stream-run-for-each expects a Stream, found ${got}`,
            expected: "Stream",
            got,
          });
        }
        const fnT = applyType(
          yield* Ref.get(ctx.subst),
          yield* checkExpr(applyEnv(yield* Ref.get(ctx.subst), env), expr.args[1]!, TFun(stream.item, yield* ctx.freshTVar)),
        );
        if (fnT._tag !== "TFun") {
          const got = showType(fnT);
          return yield* ctx.fail(originOf(expr.args[1]!, "stream-run-for-each"), {
            code: "typecheck/type-mismatch",
            message: `stream-run-for-each callback must be a function, found ${got}`,
            expected: "Function",
            got,
          });
        }
        const eff = yield* requireEffect(fnT.res, originOf(expr.args[1]!, "stream-run-for-each"));
        return buildOperationalEffect(
          tNil,
          unionEffectSets(stream.errors, eff.errors),
          unionEffectSets(stream.requirements, eff.requirements),
        );
      }

      // -----------------------------------------------------------------
      // Layer combinators
      // -----------------------------------------------------------------

      case "layer-merge": {
        if (expr.args.length < 2) {
          return yield* ctx.fail(origin, { code: "typecheck/arity", message: "layer-merge expects at least 2 layers" });
        }
        let provides: EffectProvenance = emptyEffectSet;
        let errors: EffectProvenance = emptyEffectSet;
        let requirements: EffectProvenance = emptyEffectSet;
        for (const arg of expr.args) {
          const lt = applyType(yield* Ref.get(ctx.subst), yield* inferExpr(applyEnv(yield* Ref.get(ctx.subst), env), arg));
          const layer = extractLayer(lt);
          if (!layer) {
            return yield* ctx.fail(originOf(arg, "layer-merge"), {
              code: "mechanics/provide",
              message: `layer-merge expects a Layer, found ${showType(lt)}`,
            });
          }
          provides = unionEffectSets(provides, layer.provides);
          errors = unionEffectSets(errors, layer.errors);
          requirements = unionEffectSets(requirements, layer.requirements);
        }
        return buildLayer(provides, errors, requirements);
      }

      case "layer-provide":
      case "layer-provide-merge": {
        if (expr.args.length !== 2) {
          return yield* ctx.fail(origin, { code: "typecheck/arity", message: `${name} expects target and source layers` });
        }
        const targetT = applyType(yield* Ref.get(ctx.subst), yield* inferExpr(env, expr.args[0]!));
        const sourceT = applyType(yield* Ref.get(ctx.subst), yield* inferExpr(applyEnv(yield* Ref.get(ctx.subst), env), expr.args[1]!));
        const target = extractLayer(targetT);
        const source = extractLayer(sourceT);
        if (!target || !source) {
          return yield* ctx.fail(origin, {
            code: "mechanics/provide",
            message: `${name} expects two Layer arguments`,
          });
        }
        const provides = name === "layer-provide-merge"
          ? unionEffectSets(target.provides, source.provides)
          : target.provides;
        const errors = unionEffectSets(target.errors, source.errors);
        const requirements = unionEffectSets(subtractProvidedServices(target.requirements, source.provides), source.requirements);
        return buildLayer(provides, errors, requirements);
      }

      default:
        return undefined;
    }
  });

// ---------------------------------------------------------------------------
// Layer declarations
// ---------------------------------------------------------------------------

export const inferDefLayer = (
  env: TypeEnv,
  expr: CoreExpr & { _tag: "DefLayer" },
  inferExpr: InferFn,
): Effect.Effect<Type, InferenceError, InferContext> =>
  Effect.gen(function* () {
    const ctx = yield* InferContext;
    const origin = originOf(expr, "layer");
    let inferredLayer: Type;

    if (expr.body.kind === "compose") {
      const composed = applyType(yield* Ref.get(ctx.subst), yield* inferExpr(env, expr.body.expr));
      if (!extractLayer(composed)) {
        return yield* ctx.fail(origin, {
          code: "mechanics/provide",
          message: `layer ${expr.name} must evaluate to a Layer, found ${showType(composed)}`,
        });
      }
      inferredLayer = composed;
    } else {
      const services = yield* Ref.get(ctx.serviceRegistry);
      const declaredMethods = services.get(expr.body.service);
      if (!declaredMethods) {
        return yield* ctx.fail(
          { nodeId: `${expr.id}:service`, span: expr.body.serviceSpan, kind: "layer-service" },
          { code: "mechanics/provide", message: `Unknown service ${expr.body.service} in layer ${expr.name}.` },
        );
      }

      let layerEnv = new Map(env);
      let setupErrors: EffectProvenance = emptyEffectSet;
      let layerReqs: EffectProvenance = emptyEffectSet;

      for (const step of expr.body.setup) {
        const s = yield* Ref.get(ctx.subst);
        layerEnv = applyEnv(s, layerEnv);
        const valT = applyType(yield* Ref.get(ctx.subst), yield* inferExpr(layerEnv, step.binding.expr));
        const eff = extractOperationalEffect(valT, step.binding.span);
        if (step.kind === "let") {
          if (eff) {
            return yield* ctx.fail(
              { nodeId: step.binding.id, span: step.binding.span, kind: "layer-setup-let" },
              { code: "mechanics/let-effect", message: `:let in layer :setup cannot bind an Effect directly.` },
            );
          }
          layerEnv.set(step.binding.name, mono(valT));
        } else if (eff) {
          setupErrors = unionEffectSets(setupErrors, eff.errors);
          layerReqs = unionEffectSets(layerReqs, withoutKey(eff.requirements, "Scope"));
          layerEnv.set(step.binding.name, mono(eff.success));
        } else {
          layerEnv.set(step.binding.name, mono(valT));
        }
      }

      const helpers = expr.body.methods.filter((m) => !declaredMethods.has(m.name));
      const serviceImpls = expr.body.methods.filter((m) => declaredMethods.has(m.name));

      for (const helper of helpers) {
        const helperEnv = applyEnv(yield* Ref.get(ctx.subst), layerEnv);
        const paramTypes: Type[] = [];
        for (const p of helper.params ?? []) {
          const tv = yield* ctx.freshTVar;
          paramTypes.push(tv);
          helperEnv.set(p.name, mono(tv));
        }
        const bodyT = applyType(yield* Ref.get(ctx.subst), yield* inferExpr(helperEnv, helper.body));
        const helperSubst = yield* Ref.get(ctx.subst);
        const helperType = helper.params ? fnType(paramTypes.map((p) => applyType(helperSubst, p)), bodyT) : bodyT;
        layerEnv.set(helper.name, mono(helperType));
      }

      const implementedNames = new Set(serviceImpls.map((m) => m.name));
      for (const requiredMethod of declaredMethods.keys()) {
        if (!implementedNames.has(requiredMethod)) {
          return yield* ctx.fail(origin, {
            code: "mechanics/provide",
            message: `layer ${expr.name} does not implement method ${requiredMethod} of service ${expr.body.service}.`,
          });
        }
      }

      for (const impl of serviceImpls) {
        const declared = declaredMethods.get(impl.name)!;
        const paramTypes: Type[] = [];
        let cursor = declared;
        while (cursor._tag === "TFun") {
          paramTypes.push(cursor.arg);
          cursor = cursor.res;
        }
        const expectedEff = extractOperationalEffect(cursor);
        const implParams = impl.params ?? [];
        if (implParams.length !== paramTypes.length) {
          return yield* ctx.fail(
            { nodeId: `${expr.id}:${impl.name}`, span: impl.span, kind: "layer-method" },
            {
              code: "mechanics/arity",
              message: `Method ${impl.name} of ${expr.body.service} expects ${paramTypes.length} parameter(s), got ${implParams.length}.`,
            },
          );
        }
        const methodEnv = applyEnv(yield* Ref.get(ctx.subst), layerEnv);
        for (let i = 0; i < implParams.length; i++) {
          methodEnv.set(implParams[i]!.name, mono(paramTypes[i]!));
        }
        const bodyT = applyType(yield* Ref.get(ctx.subst), yield* inferExpr(methodEnv, impl.body));
        const bodyEff = extractOperationalEffect(bodyT, impl.span) ?? {
          success: bodyT,
          errors: emptyEffectSet,
          requirements: emptyEffectSet,
        };
        if (expectedEff) {
          yield* assignType(
            bodyEff.success,
            expectedEff.success,
            { nodeId: `${expr.id}:${impl.name}`, span: impl.span, kind: "layer-method" },
          );
          const errDiags = checkEffectSetInclusion(
            bodyEff.errors,
            expectedEff.errors,
            "error",
            `layer method ${expr.name}.${impl.name}`,
            impl.span,
          );
          if (errDiags.length > 0) {
            return yield* ctx.fail(
              { nodeId: `${expr.id}:${impl.name}`, span: impl.span, kind: "layer-method" },
              { code: errDiags[0]!.code, message: errDiags[0]!.message },
            );
          }
        }
        layerReqs = unionEffectSets(layerReqs, bodyEff.requirements);
      }

      inferredLayer = buildLayer(effectSetOf([expr.body.service], expr.body.serviceSpan), setupErrors, layerReqs);
    }

    if (expr.signature) {
      const sigT = yield* typeExprToType(expr.signature, new Map(), new Map());
      const actual = extractLayer(inferredLayer);
      const expected = extractLayer(sigT);
      if (!actual || !expected) {
        yield* assignType(inferredLayer, sigT, origin);
        return sigT;
      }
      for (const prov of expected.provides.keys()) {
        if (!actual.provides.has(prov)) {
          return yield* ctx.fail(origin, {
            code: "mechanics/provide",
            message: `layer ${expr.name} signature declares :provides ${prov}, which is not provided.`,
          });
        }
      }
      const errDiags = checkEffectSetInclusion(actual.errors, expected.errors, "error", `layer ${expr.name}`, expr.span);
      if (errDiags.length > 0) {
        return yield* ctx.fail(origin, { code: errDiags[0]!.code, message: errDiags[0]!.message });
      }
      const reqDiags = checkEffectSetInclusion(actual.requirements, expected.requirements, "requirement", `layer ${expr.name}`, expr.span);
      if (reqDiags.length > 0) {
        return yield* ctx.fail(origin, { code: reqDiags[0]!.code, message: reqDiags[0]!.message });
      }
      return sigT;
    }

    return inferredLayer;
  });

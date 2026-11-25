import { Effect } from "effect";
import { parseManyToSExpr, type ParseError } from "../reader/index.js";
import type { CoreExpr, CLam } from "./core-expr.js";
import { resetNodeIds } from "./core-expr.js";
import { InferenceError } from "./errors.js";
import { lowerProgram } from "./lower.js";
import type { InferOptions, InferResult } from "./index.js";
import { inferSource } from "./index.js";
import type { ERow } from "./types.js";
import { buildERow, EEmpty, flattenERow } from "./types.js";

const ASSERT_PREFIX = "assert:";
const UNKNOWN_ATTRIBUTE = "*";
const MAX_CLOSURE_DEPTH = 24;

export type GrantFact = readonly [who: string, can: "can", attr: string];

export interface CheckAuthorityOptions extends InferOptions {
  readonly author: string;
  readonly grants: readonly GrantFact[];
}

export interface AuthorityManifest {
  readonly effect: ERow;
  readonly labels: readonly string[];
  readonly attributes: readonly string[];
}

export interface AuthorityInferenceResult extends InferResult {
  readonly authority: AuthorityManifest;
}

export type AuthorityCheckResult =
  | { readonly ok: true; readonly authority: AuthorityManifest }
  | { readonly ok: false; readonly missing: readonly string[]; readonly authority: AuthorityManifest };

type AbsValue =
  | { readonly _tag: "Unknown" }
  | { readonly _tag: "Str"; readonly value: string }
  | { readonly _tag: "Facts"; readonly attrs: ReadonlySet<string> }
  | {
      readonly _tag: "Closure";
      readonly params: readonly string[];
      readonly body: CoreExpr;
      readonly env: AbsEnv;
    };

type AbsEnv = ReadonlyMap<string, AbsValue>;

const Unknown: AbsValue = { _tag: "Unknown" };
const emptyFacts = (): AbsValue => ({ _tag: "Facts", attrs: new Set() });
const facts = (attrs: Iterable<string>): AbsValue => ({ _tag: "Facts", attrs: new Set(attrs) });

function unionFacts(values: readonly AbsValue[]): AbsValue {
  const attrs = new Set<string>();
  for (const value of values) {
    if (value._tag !== "Facts") continue;
    for (const attr of value.attrs) attrs.add(attr);
  }
  return facts(attrs);
}

function literalString(value: AbsValue): string | undefined {
  return value._tag === "Str" ? value.value : undefined;
}

function attrFromExpr(expr: CoreExpr, env: AbsEnv, depth: number): string {
  const value = evalAuthorityExpr(expr, env, depth + 1);
  return literalString(value) ?? UNKNOWN_ATTRIBUTE;
}

function valueEffects(value: AbsValue, depth = 0): ReadonlySet<string> {
  if (depth > MAX_CLOSURE_DEPTH) return new Set([UNKNOWN_ATTRIBUTE]);

  switch (value._tag) {
    case "Facts":
      return value.attrs;
    case "Closure": {
      const env = new Map(value.env);
      for (const param of value.params) env.set(param, Unknown);
      return valueEffects(evalAuthorityExpr(value.body, env, depth + 1), depth + 1);
    }
    case "Str":
    case "Unknown":
      return new Set();
  }
}

function closureParams(expr: CLam): readonly string[] {
  return expr.restParam
    ? [...expr.params.map((p) => p.name), expr.restParam.name]
    : expr.params.map((p) => p.name);
}

function applyClosure(fn: AbsValue, args: readonly CoreExpr[], env: AbsEnv, depth: number): AbsValue {
  if (fn._tag !== "Closure" || depth > MAX_CLOSURE_DEPTH) return Unknown;

  const callEnv = new Map(fn.env);
  for (let i = 0; i < fn.params.length; i++) {
    callEnv.set(fn.params[i]!, args[i] ? evalAuthorityExpr(args[i]!, env, depth + 1) : Unknown);
  }

  return evalAuthorityExpr(fn.body, callEnv, depth + 1);
}

function evalVector(expr: CoreExpr & { readonly _tag: "App" }, env: AbsEnv, depth: number): AbsValue {
  const itemValues = expr.args.map((arg) => evalAuthorityExpr(arg, env, depth + 1));
  if (itemValues.some((value) => value._tag === "Facts" && value.attrs.size > 0)) {
    return unionFacts(itemValues);
  }

  if (expr.args.length === 3) {
    return facts([attrFromExpr(expr.args[1]!, env, depth + 1)]);
  }

  return unionFacts(itemValues);
}

function evalBuiltinApp(
  name: string,
  expr: CoreExpr & { readonly _tag: "App" },
  env: AbsEnv,
  depth: number,
): AbsValue | undefined {
  switch (name) {
    case "__vector":
      return evalVector(expr, env, depth);

    case "concat":
      return unionFacts(expr.args.map((arg) => evalAuthorityExpr(arg, env, depth + 1)));

    case "conj":
      return unionFacts(expr.args.map((arg) => evalAuthorityExpr(arg, env, depth + 1)));

    case "filter":
      return expr.args[1] ? evalAuthorityExpr(expr.args[1], env, depth + 1) : emptyFacts();

    case "map":
    case "flat-map": {
      if (!expr.args[0]) return emptyFacts();
      const mapper = evalAuthorityExpr(expr.args[0], env, depth + 1);
      return mapper._tag === "Closure" ? applyClosure(mapper, [], env, depth + 1) : emptyFacts();
    }

    default:
      return undefined;
  }
}

function evalAuthorityExpr(expr: CoreExpr, env: AbsEnv, depth = 0): AbsValue {
  if (depth > MAX_CLOSURE_DEPTH) return Unknown;

  switch (expr._tag) {
    case "Lit":
      if (expr.lit._tag === "LString" || expr.lit._tag === "LKeyword") {
        return { _tag: "Str", value: expr.lit.value };
      }
      return Unknown;

    case "Var":
      return env.get(expr.name) ?? Unknown;

    case "Lam":
      return { _tag: "Closure", params: closureParams(expr), body: expr.body, env: new Map(env) };

    case "Let": {
      const letEnv = new Map(env);
      for (const binding of expr.bindings) {
        letEnv.set(binding.name, evalAuthorityExpr(binding.expr, letEnv, depth + 1));
      }
      return evalAuthorityExpr(expr.body, letEnv, depth + 1);
    }

    case "If":
      return unionFacts([
        evalAuthorityExpr(expr.then, env, depth + 1),
        evalAuthorityExpr(expr.else_, env, depth + 1),
      ]);

    case "App": {
      if (expr.fn._tag === "Var") {
        const builtin = evalBuiltinApp(expr.fn.name, expr, env, depth + 1);
        if (builtin) return builtin;
      }

      return applyClosure(evalAuthorityExpr(expr.fn, env, depth + 1), expr.args, env, depth + 1);
    }

    case "Ascribe":
      return evalAuthorityExpr(expr.expr, env, depth + 1);

    case "Def":
      return evalAuthorityExpr(expr.expr, env, depth + 1);

    case "Record":
    case "Get":
    case "EffectDo":
    case "EffectFail":
    case "EffectCatch":
    case "DSLForm":
    case "TypeDef":
    case "Match":
    case "DefClass":
    case "Instance":
    case "DefService":
    case "DefLayer":
      return Unknown;
  }
}

function analyzeAuthority(coreExprs: readonly CoreExpr[]): AuthorityManifest {
  const env = new Map<string, AbsValue>();
  let last: AbsValue = emptyFacts();

  for (const expr of coreExprs) {
    if (expr._tag === "Def") {
      const value = evalAuthorityExpr(expr.expr, env);
      env.set(expr.name, value);
      last = value;
      continue;
    }

    last = evalAuthorityExpr(expr, env);
  }

  const attributes = Array.from(valueEffects(last)).sort();
  const labels = attributes.map((attr) => `${ASSERT_PREFIX}${attr}`);
  return {
    effect: buildERow(new Set(labels), EEmpty),
    labels,
    attributes,
  };
}

export function assertAttributesFromEffect(effect: ERow): readonly string[] {
  const flat = flattenERow(effect);
  return Array.from(flat.labels)
    .filter((label) => label.startsWith(ASSERT_PREFIX))
    .map((label) => label.slice(ASSERT_PREFIX.length))
    .sort();
}

export function inferAuthoritySource(
  source: string,
  options?: InferOptions,
): Effect.Effect<AuthorityInferenceResult, InferenceError | ParseError> {
  return Effect.gen(function* () {
    const inferred = yield* inferSource(source, options);
    const dslProvider = options?.dslProvider;
    const exprs = yield* parseManyToSExpr(source);

    resetNodeIds();
    const coreExprs = yield* Effect.try({
      try: () => lowerProgram(exprs, dslProvider),
      catch: (e) => (e instanceof InferenceError ? e : new InferenceError({ message: String(e) })),
    });
    return {
      ...inferred,
      authority: analyzeAuthority(coreExprs),
    };
  });
}

export function checkAuthority(
  source: string,
  options: CheckAuthorityOptions,
): Effect.Effect<AuthorityCheckResult, InferenceError | ParseError> {
  return Effect.gen(function* () {
    const { author, grants, ...inferOptions } = options;
    const inferred = yield* inferAuthoritySource(source, inferOptions);
    const granted = new Set(
      grants
        .filter((grant) => grant[0] === author && grant[1] === "can")
        .map((grant) => grant[2]),
    );
    const missing = inferred.authority.attributes.filter((attr) => !granted.has(attr));

    if (missing.length === 0) return { ok: true as const, authority: inferred.authority };
    return { ok: false as const, missing, authority: inferred.authority };
  });
}

/**
 * RFC 0028 Stage 1: Finite workflow & evidence safety laws with fixed-point
 * bounded exploration and shortest counterexample traces.
 *
 * Browser-safe: contains zero `node:*` imports.
 */

import type { JsonValue } from "../artifact/artifact.js";
import { canonicalJson, sha256 } from "../artifact/canonical-json.js";
import { bootstrapFromSources, type BootstrappedPrelude } from "../descriptor/bootstrap.js";
import {
  elaborateProgram,
  type DeclarationSyntax,
  type ElaboratedDeclaration,
} from "../descriptor/elaborate.js";
import type { Span } from "../diagnostic/diagnostic.js";
import { preludeSource, preludeSources } from "../Preludes.js";
import { parse, toSExprMany } from "../reader/index.js";
import type { SExpr } from "../reader/types.js";
import type {
  EvidenceTrustAccount,
  VerificationEvidencePayload,
} from "../store/types.js";

// ---------------------------------------------------------------------------
// Constants & Trust Account Metadata
// ---------------------------------------------------------------------------

export const TRANSITION_SEMANTICS_VERSION = "workflow-laws-semantics/v1" as const;
export const MODEL_HASH_VERSION = "workflow-model:v1" as const;
export const SOURCE_HASH_VERSION = "workflow-source:v1" as const;

/**
 * Trusted components participating in RFC 0028 Stage 1 verification until an
 * independent RFC 0022 trusted core checker exists.
 */
export const DEFAULT_TRUSTED_COMPONENTS: readonly string[] = [
  "@formalang/ts/reader",
  "@formalang/ts/descriptor-elaborator",
  `@formalang/ts/verification/bounded-explorer (${TRANSITION_SEMANTICS_VERSION})`,
];

/**
 * Documented pure, decidable expression operations permitted in finite
 * workflow guards, updates, initial states, and safety laws.
 * Arbitrary hooks, native calls, effects, recursion, and floats are rejected.
 */
export const SUPPORTED_DECIDABLE_OPS: ReadonlySet<string> = new Set([
  // Boolean & control
  "and",
  "or",
  "not",
  "if",
  "cond",
  "implies",
  // Structural equality & integer ordering
  "=",
  "!=",
  "not=",
  "<",
  "<=",
  ">",
  ">=",
  // Bounded safe-integer arithmetic
  "+",
  "-",
  // Map / record operations
  "get",
  "assoc",
  "dissoc",
  "contains?",
  "nil?",
  "some?",
  "keys",
  "vals",
  // Finite collection operations
  "count",
  "empty?",
  "conj",
  "includes?",
  "every?",
  "some",
  "any?",
  "filter",
  "map",
  // Local bindings & pure inline lambdas for finite collection combinators
  "let",
  "fn",
]);

// ---------------------------------------------------------------------------
// Data Model Types
// ---------------------------------------------------------------------------

export type WorkflowValue =
  | null
  | boolean
  | number
  | string
  | readonly WorkflowValue[]
  | { readonly [key: string]: WorkflowValue };

export interface WorkflowParamBinding {
  readonly name: string;
  readonly domain: string;
}

export interface WorkflowTransitionSpec {
  readonly name: string;
  readonly params: readonly WorkflowParamBinding[];
  readonly guard?: SExpr | undefined;
  readonly update: SExpr;
  readonly span?: Span | undefined;
}

export interface WorkflowLawSpec {
  readonly name: string;
  readonly description?: string | undefined;
  readonly when?: SExpr | undefined;
  readonly holds: SExpr;
  readonly span?: Span | undefined;
}

export interface WorkflowModelSpec {
  readonly name: string;
  readonly domains: Readonly<Record<string, readonly WorkflowValue[]>>;
  readonly initialStates: readonly WorkflowValue[];
  readonly transitions: readonly WorkflowTransitionSpec[];
  readonly laws: readonly WorkflowLawSpec[];
  readonly assumptions: readonly string[];
  readonly sourceId?: string | undefined;
  readonly sourceText?: string | undefined;
}

export interface BoundedExplorationOptions {
  /** Maximum distinct reachable states to explore before returning inconclusive. Default: 10_000. */
  readonly maxStates?: number | undefined;
  /** Maximum BFS depth to explore. Omit or set to null/Infinity for unbounded depth up to fixed point. */
  readonly maxDepth?: number | null | undefined;
  /** Maximum transition edges to explore before returning inconclusive. Default: 100_000. */
  readonly maxEdges?: number | undefined;
  /** Optional wall-clock budget in milliseconds. Omitted by default for determinism. */
  readonly maxTimeMs?: number | undefined;
}

export type BoundedVerificationVerdict =
  | "holds-in-model"
  | "counterexample"
  | "inconclusive";

export type InconclusiveReason =
  | "unsupported-operation"
  | "depth-budget-exhausted"
  | "state-budget-exhausted"
  | "edge-budget-exhausted"
  | "time-budget-exhausted"
  | "invalid-model";

export interface UnsupportedOperationDetail {
  readonly operation: string;
  readonly reason: string;
  readonly context: string;
  readonly span?: Span | undefined;
}

export interface CounterexampleStep {
  readonly stepIndex: number;
  readonly transition: string;
  readonly params: Readonly<Record<string, WorkflowValue>>;
  readonly fromState: WorkflowValue;
  readonly toState: WorkflowValue;
  readonly transitionSpan?: Span | undefined;
}

export interface CounterexampleTrace {
  readonly violatedLaw: string;
  readonly lawDescription?: string | undefined;
  readonly lawSpan?: Span | undefined;
  readonly initialState: WorkflowValue;
  readonly violatingState: WorkflowValue;
  readonly steps: readonly CounterexampleStep[];
  readonly length: number;
}

export interface VacuousLawReport {
  readonly name: string;
  readonly description?: string | undefined;
  readonly span?: Span | undefined;
  readonly reason: string;
}

export interface UnreachableTransitionReport {
  readonly name: string;
  readonly span?: Span | undefined;
  readonly reason: string;
}

export interface BoundedExplorationBounds {
  readonly maxStates: number;
  readonly maxDepth: number | null;
  readonly maxEdges: number;
  readonly maxTimeMs?: number | undefined;
}

export interface BoundedExplorationStats {
  readonly stateCount: number;
  readonly edgeCount: number;
  readonly maxDepthReached: number;
  readonly transitionFireCounts: Readonly<Record<string, number>>;
  readonly lawPremiseCounts: Readonly<Record<string, number>>;
}

export interface BoundedVerificationReport {
  readonly verdict: BoundedVerificationVerdict;
  readonly fixedPointReached: boolean;
  readonly inconclusiveReason?: InconclusiveReason | undefined;
  readonly inconclusiveMessage?: string | undefined;
  readonly unsupportedOperations: readonly UnsupportedOperationDetail[];
  readonly modelName: string;
  readonly modelHash: string;
  readonly sourceHash?: string | undefined;
  readonly transitionSemanticsVersion: typeof TRANSITION_SEMANTICS_VERSION;
  readonly trustedComponents: readonly string[];
  readonly domains: Readonly<Record<string, readonly WorkflowValue[]>>;
  readonly initialStates: readonly WorkflowValue[];
  readonly assumptions: readonly string[];
  readonly bounds: BoundedExplorationBounds;
  readonly stats: BoundedExplorationStats;
  readonly vacuousLaws: readonly VacuousLawReport[];
  readonly unreachableTransitions: readonly UnreachableTransitionReport[];
  readonly counterexample?: CounterexampleTrace | undefined;
}

// ---------------------------------------------------------------------------
// Canonicalization & Structural Helpers
// ---------------------------------------------------------------------------

function toJsonValue(value: WorkflowValue): JsonValue {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => toJsonValue(item as WorkflowValue));
  }
  const out: Record<string, JsonValue> = {};
  for (const key of Object.keys(value).sort()) {
    out[key] = toJsonValue((value as Record<string, WorkflowValue>)[key]!);
  }
  return out;
}

/** Deterministic canonical JSON string for a finite workflow state or value. */
export function canonicalizeState(state: WorkflowValue): string {
  return canonicalJson(toJsonValue(state));
}

function valuesEqual(a: WorkflowValue, b: WorkflowValue): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!valuesEqual(a[i]!, b[i]!)) return false;
    }
    return true;
  }
  if (typeof a === "object" && typeof b === "object") {
    const recA = a as Readonly<Record<string, WorkflowValue>>;
    const recB = b as Readonly<Record<string, WorkflowValue>>;
    const keysA = Object.keys(recA);
    const keysB = Object.keys(recB);
    if (keysA.length !== keysB.length) return false;
    for (const key of keysA) {
      if (!Object.prototype.hasOwnProperty.call(recB, key)) return false;
      if (!valuesEqual(recA[key]!, recB[key]!)) return false;
    }
    return true;
  }
  return false;
}

function isTruthy(value: WorkflowValue): boolean {
  return value !== false && value !== null;
}

function stripKeyColon(key: string): string {
  return key.startsWith(":") ? key.slice(1) : key;
}

function sexprToCanonicalJson(expr: SExpr): JsonValue {
  switch (expr._tag) {
    case "Sym":
      return { sym: expr.name };
    case "Str":
      return { str: expr.value };
    case "Num":
      return { num: expr.value };
    case "Bool":
      return { bool: expr.value };
    case "List":
      return { list: expr.items.map(sexprToCanonicalJson) };
    case "Vector":
      return { vec: expr.items.map(sexprToCanonicalJson) };
    case "Set":
      return { set: expr.items.map(sexprToCanonicalJson) };
    case "Map":
      return {
        map: expr.pairs.map(([k, v]) => [sexprToCanonicalJson(k), sexprToCanonicalJson(v)]),
      };
    case "Error":
      return { error: expr.message };
  }
}

function computeModelHash(model: WorkflowModelSpec): string {
  const canonicalPayload: JsonValue = {
    version: MODEL_HASH_VERSION,
    semanticsVersion: TRANSITION_SEMANTICS_VERSION,
    name: model.name,
    domains: Object.fromEntries(
      Object.entries(model.domains)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, vals]) => [k, vals.map(toJsonValue)]),
    ),
    initialStates: model.initialStates.map(toJsonValue),
    transitions: model.transitions.map((t) => ({
      name: t.name,
      params: t.params.map((p) => ({ name: p.name, domain: p.domain })),
      guard: t.guard ? sexprToCanonicalJson(t.guard) : null,
      update: sexprToCanonicalJson(t.update),
    })),
    laws: model.laws.map((l) => ({
      name: l.name,
      description: l.description ?? null,
      when: l.when ? sexprToCanonicalJson(l.when) : null,
      holds: sexprToCanonicalJson(l.holds),
    })),
    assumptions: [...model.assumptions],
  };
  return `${MODEL_HASH_VERSION}:${sha256(canonicalJson(canonicalPayload))}`;
}

function spanFromSExpr(expr: SExpr, sourceId?: string): Span {
  return {
    sourceId: expr.loc.sourceId ?? sourceId ?? "workflow-model.lisp",
    startOffset: expr.loc.start,
    endOffset: expr.loc.end,
  };
}

// ---------------------------------------------------------------------------
// Static Validation of the Pure Decidable Expression Subset
// ---------------------------------------------------------------------------

function validateDecidableExpr(
  expr: SExpr,
  context: string,
  sourceId: string | undefined,
  issues: UnsupportedOperationDetail[],
): void {
  switch (expr._tag) {
    case "Bool":
    case "Str":
      return;
    case "Num":
      if (!Number.isSafeInteger(expr.value) || expr.numericKind === "float") {
        issues.push({
          operation: String(expr.value),
          reason: "Floating-point or non-safe-integer numeric literals are outside the decidable finite subset.",
          context,
          span: spanFromSExpr(expr, sourceId),
        });
      }
      return;
    case "Sym":
      return;
    case "Vector":
      for (const item of expr.items) {
        validateDecidableExpr(item, context, sourceId, issues);
      }
      return;
    case "Map":
      for (const [k, v] of expr.pairs) {
        validateDecidableExpr(k, context, sourceId, issues);
        validateDecidableExpr(v, context, sourceId, issues);
      }
      return;
    case "Set":
      issues.push({
        operation: "set-literal",
        reason: "Set literals are not supported in the finite workflow expression subset; use vectors or maps.",
        context,
        span: spanFromSExpr(expr, sourceId),
      });
      return;
    case "Error":
      issues.push({
        operation: "parse-error",
        reason: expr.message,
        context,
        span: spanFromSExpr(expr, sourceId),
      });
      return;
    case "List": {
      if (expr.items.length === 0) {
        issues.push({
          operation: "()",
          reason: "Empty list call is not valid in the decidable subset.",
          context,
          span: spanFromSExpr(expr, sourceId),
        });
        return;
      }
      const head = expr.items[0]!;
      if (head._tag !== "Sym") {
        issues.push({
          operation: head._tag,
          reason: "Dynamic or higher-order call targets are outside the pure decidable expression subset.",
          context,
          span: spanFromSExpr(expr, sourceId),
        });
        return;
      }
      const op = head.name;
      if (!SUPPORTED_DECIDABLE_OPS.has(op)) {
        issues.push({
          operation: op,
          reason: `Unsupported operation "${op}" is outside the pure decidable workflow expression subset (arbitrary hooks, effects, recursion, and native calls are rejected).`,
          context,
          span: spanFromSExpr(head, sourceId),
        });
        return;
      }
      if (op === "let") {
        const bindings = expr.items[1];
        if (!bindings || bindings._tag !== "Vector" || bindings.items.length % 2 !== 0) {
          issues.push({
            operation: "let",
            reason: "let requires an even-length binding vector [name expr ...].",
            context,
            span: spanFromSExpr(expr, sourceId),
          });
          return;
        }
        for (let i = 0; i < bindings.items.length; i += 2) {
          if (bindings.items[i]!._tag !== "Sym") {
            issues.push({
              operation: "let",
              reason: "let binding names must be plain symbols.",
              context,
              span: spanFromSExpr(bindings.items[i]!, sourceId),
            });
          }
          validateDecidableExpr(bindings.items[i + 1]!, context, sourceId, issues);
        }
        for (let i = 2; i < expr.items.length; i++) {
          validateDecidableExpr(expr.items[i]!, context, sourceId, issues);
        }
        return;
      }
      if (op === "fn") {
        const params = expr.items[1];
        if (!params || params._tag !== "Vector" || expr.items.length !== 3) {
          issues.push({
            operation: "fn",
            reason: "fn must have the form (fn [param ...] body) with a single pure body expression.",
            context,
            span: spanFromSExpr(expr, sourceId),
          });
          return;
        }
        for (const p of params.items) {
          if (p._tag !== "Sym") {
            issues.push({
              operation: "fn",
              reason: "fn parameter names must be symbols.",
              context,
              span: spanFromSExpr(p, sourceId),
            });
          }
        }
        validateDecidableExpr(expr.items[2]!, context, sourceId, issues);
        return;
      }
      for (let i = 1; i < expr.items.length; i++) {
        validateDecidableExpr(expr.items[i]!, context, sourceId, issues);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Pure Decidable Expression Evaluator
// ---------------------------------------------------------------------------

class UnsupportedEvalError extends Error {
  readonly operation: string;
  readonly span?: Span | undefined;

  constructor(operation: string, message: string, span?: Span) {
    super(message);
    this.name = "UnsupportedEvalError";
    this.operation = operation;
    this.span = span;
  }
}

type EvalEnv = Readonly<Record<string, WorkflowValue>>;

function lookupSymbol(name: string, env: EvalEnv, span?: Span): WorkflowValue {
  if (name === "nil") return null;
  if (name === "true") return true;
  if (name === "false") return false;
  if (name.startsWith(":")) return name;
  if (Object.prototype.hasOwnProperty.call(env, name)) {
    return env[name]!;
  }
  // Support dotted field access like `state.revision` or `ev.worker`
  if (name.includes(".")) {
    const parts = name.split(".");
    const root = parts[0]!;
    if (!Object.prototype.hasOwnProperty.call(env, root)) {
      throw new UnsupportedEvalError(name, `Unbound symbol "${root}" in "${name}".`, span);
    }
    let current: WorkflowValue = env[root]!;
    for (let i = 1; i < parts.length; i++) {
      if (current === null || typeof current !== "object" || Array.isArray(current)) {
        return null;
      }
      const field = parts[i]!;
      const rec = current as Readonly<Record<string, WorkflowValue>>;
      current = Object.prototype.hasOwnProperty.call(rec, field) ? rec[field]! : null;
    }
    return current;
  }
  throw new UnsupportedEvalError(name, `Unbound symbol "${name}".`, span);
}

function evalLambda(
  fnExpr: SExpr,
  argValues: readonly WorkflowValue[],
  env: EvalEnv,
  sourceId?: string,
): WorkflowValue {
  if (fnExpr._tag !== "List" || fnExpr.items[0]?._tag !== "Sym" || fnExpr.items[0].name !== "fn") {
    throw new UnsupportedEvalError(
      "fn",
      "Collection combinator expects an inline (fn [x] body) expression.",
      spanFromSExpr(fnExpr, sourceId),
    );
  }
  const paramsNode = fnExpr.items[1];
  const body = fnExpr.items[2];
  if (!paramsNode || paramsNode._tag !== "Vector" || !body) {
    throw new UnsupportedEvalError("fn", "Invalid fn expression.", spanFromSExpr(fnExpr, sourceId));
  }
  const childEnv: Record<string, WorkflowValue> = { ...env };
  for (let i = 0; i < paramsNode.items.length; i++) {
    const p = paramsNode.items[i]!;
    if (p._tag === "Sym") {
      childEnv[p.name] = argValues[i] ?? null;
    }
  }
  return evalDecidableExpr(body, childEnv, sourceId);
}

function evalDecidableExpr(
  expr: SExpr,
  env: EvalEnv,
  sourceId?: string,
): WorkflowValue {
  switch (expr._tag) {
    case "Bool":
      return expr.value;
    case "Str":
      return expr.value;
    case "Num":
      if (!Number.isSafeInteger(expr.value) || expr.numericKind === "float") {
        throw new UnsupportedEvalError(
          String(expr.value),
          "Non-integer numbers are outside the decidable finite subset.",
          spanFromSExpr(expr, sourceId),
        );
      }
      return expr.value;
    case "Sym":
      return lookupSymbol(expr.name, env, spanFromSExpr(expr, sourceId));
    case "Vector":
      return expr.items.map((item) => evalDecidableExpr(item, env, sourceId));
    case "Map": {
      const out: Record<string, WorkflowValue> = {};
      for (const [kExpr, vExpr] of expr.pairs) {
        const kVal = evalDecidableExpr(kExpr, env, sourceId);
        if (typeof kVal !== "string") {
          throw new UnsupportedEvalError(
            "map-key",
            `Map keys must evaluate to strings or keywords, got ${typeof kVal}.`,
            spanFromSExpr(kExpr, sourceId),
          );
        }
        out[stripKeyColon(kVal)] = evalDecidableExpr(vExpr, env, sourceId);
      }
      return out;
    }
    case "Set":
    case "Error":
      throw new UnsupportedEvalError(
        expr._tag,
        `Unsupported syntax node: ${expr._tag}`,
        spanFromSExpr(expr, sourceId),
      );
    case "List": {
      const head = expr.items[0];
      if (!head || head._tag !== "Sym") {
        throw new UnsupportedEvalError(
          "call",
          "Dynamic call target is not supported.",
          spanFromSExpr(expr, sourceId),
        );
      }
      const op = head.name;
      const args = expr.items.slice(1);
      const span = spanFromSExpr(expr, sourceId);

      switch (op) {
        case "not":
          return !isTruthy(evalDecidableExpr(args[0]!, env, sourceId));
        case "and": {
          let last: WorkflowValue = true;
          for (const arg of args) {
            last = evalDecidableExpr(arg, env, sourceId);
            if (!isTruthy(last)) return last;
          }
          return last;
        }
        case "or": {
          let last: WorkflowValue = false;
          for (const arg of args) {
            last = evalDecidableExpr(arg, env, sourceId);
            if (isTruthy(last)) return last;
          }
          return last;
        }
        case "implies": {
          const premise = isTruthy(evalDecidableExpr(args[0]!, env, sourceId));
          if (!premise) return true;
          return isTruthy(evalDecidableExpr(args[1]!, env, sourceId));
        }
        case "if": {
          const test = isTruthy(evalDecidableExpr(args[0]!, env, sourceId));
          if (test) return evalDecidableExpr(args[1]!, env, sourceId);
          return args[2] ? evalDecidableExpr(args[2], env, sourceId) : null;
        }
        case "cond": {
          for (let i = 0; i + 1 < args.length; i += 2) {
            const testExpr = args[i]!;
            const branchExpr = args[i + 1]!;
            if (testExpr._tag === "Sym" && testExpr.name === ":else") {
              return evalDecidableExpr(branchExpr, env, sourceId);
            }
            if (isTruthy(evalDecidableExpr(testExpr, env, sourceId))) {
              return evalDecidableExpr(branchExpr, env, sourceId);
            }
          }
          return null;
        }
        case "let": {
          const bindings = args[0]!;
          if (bindings._tag !== "Vector") {
            throw new UnsupportedEvalError("let", "let requires a binding vector.", span);
          }
          const localEnv: Record<string, WorkflowValue> = { ...env };
          for (let i = 0; i < bindings.items.length; i += 2) {
            const nameNode = bindings.items[i]!;
            const valNode = bindings.items[i + 1]!;
            if (nameNode._tag !== "Sym") {
              throw new UnsupportedEvalError("let", "let binding name must be a symbol.", span);
            }
            localEnv[nameNode.name] = evalDecidableExpr(valNode, localEnv, sourceId);
          }
          let result: WorkflowValue = null;
          for (let i = 1; i < args.length; i++) {
            result = evalDecidableExpr(args[i]!, localEnv, sourceId);
          }
          return result;
        }
        case "=": {
          if (args.length < 2) return true;
          const first = evalDecidableExpr(args[0]!, env, sourceId);
          for (let i = 1; i < args.length; i++) {
            if (!valuesEqual(first, evalDecidableExpr(args[i]!, env, sourceId))) {
              return false;
            }
          }
          return true;
        }
        case "!=":
        case "not=": {
          if (args.length !== 2) {
            throw new UnsupportedEvalError(op, `${op} requires exactly 2 arguments.`, span);
          }
          return !valuesEqual(
            evalDecidableExpr(args[0]!, env, sourceId),
            evalDecidableExpr(args[1]!, env, sourceId),
          );
        }
        case "<":
        case "<=":
        case ">":
        case ">=": {
          const a = evalDecidableExpr(args[0]!, env, sourceId);
          const b = evalDecidableExpr(args[1]!, env, sourceId);
          if (typeof a !== "number" || typeof b !== "number") {
            throw new UnsupportedEvalError(op, `${op} requires integer operands.`, span);
          }
          if (op === "<") return a < b;
          if (op === "<=") return a <= b;
          if (op === ">") return a > b;
          return a >= b;
        }
        case "+":
        case "-": {
          const nums = args.map((arg) => {
            const v = evalDecidableExpr(arg, env, sourceId);
            if (typeof v !== "number") {
              throw new UnsupportedEvalError(op, `${op} requires integer operands.`, span);
            }
            return v;
          });
          if (op === "+") return nums.reduce((acc, n) => acc + n, 0);
          if (nums.length === 1) return -nums[0]!;
          return nums.slice(1).reduce((acc, n) => acc - n, nums[0]!);
        }
        case "nil?":
          return evalDecidableExpr(args[0]!, env, sourceId) === null;
        case "some?":
          return evalDecidableExpr(args[0]!, env, sourceId) !== null;
        case "get": {
          const target = evalDecidableExpr(args[0]!, env, sourceId);
          const key = evalDecidableExpr(args[1]!, env, sourceId);
          const fallback = args[2] ? evalDecidableExpr(args[2], env, sourceId) : null;
          if (target === null || typeof target !== "object") return fallback;
          if (Array.isArray(target)) {
            if (typeof key === "number" && key >= 0 && key < target.length) {
              return target[key]!;
            }
            return fallback;
          }
          if (typeof key !== "string") return fallback;
          const field = stripKeyColon(key);
          const rec = target as Readonly<Record<string, WorkflowValue>>;
          return Object.prototype.hasOwnProperty.call(rec, field) ? rec[field]! : fallback;
        }
        case "assoc": {
          const target = evalDecidableExpr(args[0]!, env, sourceId);
          const base: Record<string, WorkflowValue> =
            target !== null && typeof target === "object" && !Array.isArray(target)
              ? { ...(target as Record<string, WorkflowValue>) }
              : {};
          for (let i = 1; i + 1 < args.length; i += 2) {
            const k = evalDecidableExpr(args[i]!, env, sourceId);
            const v = evalDecidableExpr(args[i + 1]!, env, sourceId);
            if (typeof k !== "string") {
              throw new UnsupportedEvalError("assoc", "assoc key must be a string or keyword.", span);
            }
            base[stripKeyColon(k)] = v;
          }
          return base;
        }
        case "dissoc": {
          const target = evalDecidableExpr(args[0]!, env, sourceId);
          if (target === null || typeof target !== "object" || Array.isArray(target)) {
            return target;
          }
          const copy: Record<string, WorkflowValue> = {
            ...(target as Record<string, WorkflowValue>),
          };
          for (let i = 1; i < args.length; i++) {
            const k = evalDecidableExpr(args[i]!, env, sourceId);
            if (typeof k === "string") {
              delete copy[stripKeyColon(k)];
            }
          }
          return copy;
        }
        case "contains?": {
          const coll = evalDecidableExpr(args[0]!, env, sourceId);
          const key = evalDecidableExpr(args[1]!, env, sourceId);
          if (coll === null || typeof coll !== "object") return false;
          if (Array.isArray(coll)) {
            return coll.some((item) => valuesEqual(item, key));
          }
          if (typeof key !== "string") return false;
          return Object.prototype.hasOwnProperty.call(coll, stripKeyColon(key));
        }
        case "includes?": {
          const coll = evalDecidableExpr(args[0]!, env, sourceId);
          const item = evalDecidableExpr(args[1]!, env, sourceId);
          if (!Array.isArray(coll)) return false;
          return coll.some((el) => valuesEqual(el, item));
        }
        case "keys": {
          const target = evalDecidableExpr(args[0]!, env, sourceId);
          if (target === null || typeof target !== "object" || Array.isArray(target)) {
            return [];
          }
          return Object.keys(target).sort();
        }
        case "vals": {
          const target = evalDecidableExpr(args[0]!, env, sourceId);
          if (target === null || typeof target !== "object" || Array.isArray(target)) {
            return [];
          }
          const rec = target as Readonly<Record<string, WorkflowValue>>;
          return Object.keys(rec)
            .sort()
            .map((k) => rec[k]!);
        }
        case "count": {
          const coll = evalDecidableExpr(args[0]!, env, sourceId);
          if (Array.isArray(coll) || typeof coll === "string") return coll.length;
          if (coll !== null && typeof coll === "object") return Object.keys(coll).length;
          return 0;
        }
        case "empty?": {
          const coll = evalDecidableExpr(args[0]!, env, sourceId);
          if (coll === null) return true;
          if (Array.isArray(coll) || typeof coll === "string") return coll.length === 0;
          if (typeof coll === "object") return Object.keys(coll).length === 0;
          return false;
        }
        case "conj": {
          const coll = evalDecidableExpr(args[0]!, env, sourceId);
          const added = args.slice(1).map((a) => evalDecidableExpr(a, env, sourceId));
          if (Array.isArray(coll)) return [...coll, ...added];
          if (coll === null) return added;
          throw new UnsupportedEvalError("conj", "conj expects a vector or nil.", span);
        }
        case "every?": {
          const pred = args[0]!;
          const coll = evalDecidableExpr(args[1]!, env, sourceId);
          if (!Array.isArray(coll)) return false;
          return coll.every((el) => isTruthy(evalLambda(pred, [el], env, sourceId)));
        }
        case "some":
        case "any?": {
          const pred = args[0]!;
          const coll = evalDecidableExpr(args[1]!, env, sourceId);
          if (!Array.isArray(coll)) return false;
          return coll.some((el) => isTruthy(evalLambda(pred, [el], env, sourceId)));
        }
        case "filter": {
          const pred = args[0]!;
          const coll = evalDecidableExpr(args[1]!, env, sourceId);
          if (!Array.isArray(coll)) return [];
          return coll.filter((el) => isTruthy(evalLambda(pred, [el], env, sourceId)));
        }
        case "map": {
          const fnExpr = args[0]!;
          const coll = evalDecidableExpr(args[1]!, env, sourceId);
          if (!Array.isArray(coll)) return [];
          return coll.map((el) => evalLambda(fnExpr, [el], env, sourceId));
        }
        default:
          throw new UnsupportedEvalError(
            op,
            `Unsupported operation "${op}" in finite workflow evaluator.`,
            span,
          );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Prelude Bootstrapping & Source Lowering
// ---------------------------------------------------------------------------

/**
 * Bootstrap the `workflow-laws.lisp` prelude on top of `compiler.lisp`.
 * Accepts explicit source text (useful before or without regenerated embedded
 * prelude sources) or falls back to the embedded `workflow-laws.lisp` if present.
 */
export function bootstrapWorkflowLawsPrelude(
  workflowLawsSource?: string,
): BootstrappedPrelude {
  const source =
    workflowLawsSource ??
    (preludeSources as Readonly<Record<string, string>>)["workflow-laws.lisp"];
  if (!source) {
    throw new Error(
      "workflow-laws.lisp source is not embedded yet; pass workflowLawsSource explicitly.",
    );
  }
  return bootstrapFromSources(preludeSource("compiler.lisp"), source);
}

export interface ParseWorkflowModelOptions {
  readonly sourceId?: string | undefined;
  readonly workflowLawsSource?: string | undefined;
  readonly prelude?: BootstrappedPrelude | undefined;
}

export interface ParseWorkflowModelResult {
  readonly ok: boolean;
  readonly model?: WorkflowModelSpec | undefined;
  readonly diagnostics: readonly {
    readonly code: string;
    readonly message: string;
    readonly span?: Span | undefined;
  }[];
}

function parseParamBindings(
  paramsExpr: SExpr | undefined,
  sourceId: string | undefined,
): readonly WorkflowParamBinding[] {
  if (!paramsExpr) return [];
  if (paramsExpr._tag !== "Map") {
    throw new UnsupportedEvalError(
      "params",
      "Transition :params must be a map {:paramName DomainName ...}.",
      spanFromSExpr(paramsExpr, sourceId),
    );
  }
  const bindings: WorkflowParamBinding[] = [];
  for (const [kExpr, vExpr] of paramsExpr.pairs) {
    if (kExpr._tag !== "Sym" || vExpr._tag !== "Sym") {
      throw new UnsupportedEvalError(
        "params",
        "Transition :params keys and domain references must be symbols/keywords.",
        spanFromSExpr(kExpr, sourceId),
      );
    }
    bindings.push({
      name: stripKeyColon(kExpr.name),
      domain: vExpr.name,
    });
  }
  return bindings;
}

function lowerWorkflowModelDeclaration(
  decl: ElaboratedDeclaration,
  sourceText: string,
  sourceId: string,
): WorkflowModelSpec {
  const syntax: DeclarationSyntax = decl.syntax;
  const nameNode = syntax.holes["name"]?.[0]?.expression;
  const modelName = nameNode?._tag === "Sym" ? nameNode.name : "WorkflowModel";

  const assumptions: string[] = [];
  const rawAssumptions = (decl.payload as Record<string, unknown>)["assumptions"];
  if (Array.isArray(rawAssumptions)) {
    for (const item of rawAssumptions) {
      if (typeof item === "string") assumptions.push(item);
    }
  }

  const domains: Record<string, readonly WorkflowValue[]> = {};
  const initialStates: WorkflowValue[] = [];
  const transitions: WorkflowTransitionSpec[] = [];
  const laws: WorkflowLawSpec[] = [];

  const itemHoles = syntax.holes["item"] ?? [];
  for (const itemSyntax of itemHoles) {
    const expr = itemSyntax.expression;
    if (expr._tag !== "List" || expr.items[0]?._tag !== "Sym") continue;
    const kind = expr.items[0].name;
    if (kind === "domain") {
      const domNameNode = itemSyntax.holes["name"]?.[0]?.expression;
      const valuesNode = itemSyntax.holes["values"]?.[0]?.expression;
      if (domNameNode?._tag === "Sym" && valuesNode) {
        const evaluated = evalDecidableExpr(valuesNode, {}, sourceId);
        if (!Array.isArray(evaluated)) {
          throw new UnsupportedEvalError(
            "domain",
            `Domain "${domNameNode.name}" must evaluate to a finite vector of values.`,
            itemSyntax.span,
          );
        }
        domains[domNameNode.name] = evaluated;
      }
    } else if (kind === "initial") {
      const initNode = itemSyntax.holes["expr"]?.[0]?.expression;
      if (initNode) {
        initialStates.push(evalDecidableExpr(initNode, {}, sourceId));
      }
    } else if (kind === "transition") {
      const tNameNode = itemSyntax.holes["name"]?.[0]?.expression;
      const paramsNode = itemSyntax.holes["params"]?.[0]?.expression;
      const guardNode = itemSyntax.holes["guard"]?.[0]?.expression;
      const updateNode = itemSyntax.holes["update"]?.[0]?.expression;
      if (tNameNode?._tag === "Sym" && updateNode) {
        transitions.push({
          name: tNameNode.name,
          params: parseParamBindings(paramsNode, sourceId),
          guard: guardNode,
          update: updateNode,
          span: itemSyntax.span,
        });
      }
    } else if (kind === "law") {
      const lNameNode = itemSyntax.holes["name"]?.[0]?.expression;
      const whenNode = itemSyntax.holes["when"]?.[0]?.expression;
      const holdsNode = itemSyntax.holes["holds"]?.[0]?.expression;
      const descNode = itemSyntax.holes["description"]?.[0]?.expression;
      if (lNameNode?._tag === "Sym" && holdsNode) {
        laws.push({
          name: lNameNode.name,
          description: descNode?._tag === "Str" ? descNode.value : undefined,
          when: whenNode,
          holds: holdsNode,
          span: itemSyntax.span,
        });
      }
    }
  }

  return {
    name: modelName,
    domains,
    initialStates,
    transitions,
    laws,
    assumptions,
    sourceId,
    sourceText,
  };
}

/**
 * Parse and elaborate a Forma `(workflow-model ...)` source program using
 * `preludes/workflow-laws.lisp` into a `WorkflowModelSpec` linked to authored spans.
 */
export function parseWorkflowModelFromSource(
  source: string,
  options: ParseWorkflowModelOptions = {},
): ParseWorkflowModelResult {
  const sourceId = options.sourceId ?? "workflow-model.lisp";
  const parsed = parse(source);
  if (parsed.errors.length > 0) {
    return {
      ok: false,
      diagnostics: parsed.errors.map((err) => ({
        code: "workflow-laws/parse",
        message: err.message,
      })),
    };
  }
  const prelude =
    options.prelude ?? bootstrapWorkflowLawsPrelude(options.workflowLawsSource);
  const elaborated = elaborateProgram(source, { prelude, sourceId });
  if (!elaborated.ok) {
    return {
      ok: false,
      diagnostics: elaborated.diagnostics.map((d) => ({
        code: d.code,
        message: d.message,
        span: d.span,
      })),
    };
  }
  const modelDecls = elaborated.declarations.filter(
    (d) => d.formName === "workflow-model",
  );
  if (modelDecls.length !== 1) {
    return {
      ok: false,
      diagnostics: [
        {
          code: "workflow-laws/cardinality",
          message: `Expected exactly one (workflow-model ...) declaration; found ${modelDecls.length}.`,
        },
      ],
    };
  }
  try {
    const model = lowerWorkflowModelDeclaration(modelDecls[0]!, source, sourceId);
    return { ok: true, model, diagnostics: [] };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const span = error instanceof UnsupportedEvalError ? error.span : undefined;
    return {
      ok: false,
      diagnostics: [{ code: "workflow-laws/lower", message, span }],
    };
  }
}

/** Helper to parse a single Forma expression string for programmatic model construction. */
export function parseWorkflowExpr(source: string, sourceId = "expr.lisp"): SExpr {
  const parsed = parse(source);
  if (parsed.errors.length > 0) {
    throw new Error(`Parse error in "${source}": ${parsed.errors[0]!.message}`);
  }
  const exprs = toSExprMany(parsed.redTree, sourceId);
  if (exprs.length !== 1) {
    throw new Error(`Expected exactly one expression in "${source}", got ${exprs.length}.`);
  }
  return exprs[0]!;
}

// ---------------------------------------------------------------------------
// Parameter Domain Enumeration
// ---------------------------------------------------------------------------

function enumerateParamAssignments(
  params: readonly WorkflowParamBinding[],
  domains: Readonly<Record<string, readonly WorkflowValue[]>>,
): readonly Readonly<Record<string, WorkflowValue>>[] {
  if (params.length === 0) return [{}];
  let acc: Record<string, WorkflowValue>[] = [{}];
  for (const param of params) {
    const domainValues = domains[param.domain];
    if (!domainValues) {
      throw new UnsupportedEvalError(
        param.domain,
        `Transition parameter "${param.name}" references undeclared domain "${param.domain}".`,
      );
    }
    const next: Record<string, WorkflowValue>[] = [];
    for (const partial of acc) {
      for (const value of domainValues) {
        next.push({ ...partial, [param.name]: value });
      }
    }
    acc = next;
  }
  return acc;
}

// ---------------------------------------------------------------------------
// Fixed-Point Bounded Reachable-State Explorer
// ---------------------------------------------------------------------------

interface PredecessorEdge {
  readonly fromStateId: number;
  readonly transition: string;
  readonly params: Readonly<Record<string, WorkflowValue>>;
  readonly transitionSpan?: Span | undefined;
}

function reconstructTrace(
  violatingStateId: number,
  law: WorkflowLawSpec,
  states: readonly WorkflowValue[],
  predecessors: ReadonlyMap<number, PredecessorEdge>,
): CounterexampleTrace {
  const reverseEdges: { edge: PredecessorEdge; toStateId: number }[] = [];
  let cursor = violatingStateId;
  while (predecessors.has(cursor)) {
    const edge = predecessors.get(cursor)!;
    reverseEdges.push({ edge, toStateId: cursor });
    cursor = edge.fromStateId;
  }
  reverseEdges.reverse();
  const steps: CounterexampleStep[] = reverseEdges.map(({ edge, toStateId }, idx) => ({
    stepIndex: idx + 1,
    transition: edge.transition,
    params: edge.params,
    fromState: states[edge.fromStateId]!,
    toState: states[toStateId]!,
    transitionSpan: edge.transitionSpan,
  }));
  return {
    violatedLaw: law.name,
    lawDescription: law.description,
    lawSpan: law.span,
    initialState: states[cursor]!,
    violatingState: states[violatingStateId]!,
    steps,
    length: steps.length,
  };
}

/**
 * Explore reachable states of a finite workflow model via BFS to a fixed point
 * (or until a violation is found or a budget/depth bound is exhausted).
 *
 * Guarantees:
 * - `"holds-in-model"` is returned ONLY when fixed-point exploration completes
 *   without truncating any unvisited state or edge.
 * - `"counterexample"` returns a shortest reachable trace linked to authored
 *   transitions.
 * - `"inconclusive"` is returned on unsupported operations, invalid models, or
 *   when depth/state/edge/time bounds prevent reaching a fixed point.
 * - Vacuous laws and unreachable transitions are always reported explicitly.
 */
export function exploreWorkflowModel(
  model: WorkflowModelSpec,
  options: BoundedExplorationOptions = {},
): BoundedVerificationReport {
  const maxStates = options.maxStates ?? 10_000;
  const maxDepth =
    options.maxDepth === undefined || options.maxDepth === null || !Number.isFinite(options.maxDepth)
      ? null
      : Math.max(0, Math.floor(options.maxDepth));
  const maxEdges = options.maxEdges ?? 100_000;
  const maxTimeMs = options.maxTimeMs;

  const modelHash = computeModelHash(model);
  const sourceHash =
    model.sourceText !== undefined
      ? `${SOURCE_HASH_VERSION}:${sha256(model.sourceText)}`
      : undefined;

  const bounds: BoundedExplorationBounds = {
    maxStates,
    maxDepth,
    maxEdges,
    ...(maxTimeMs !== undefined ? { maxTimeMs } : {}),
  };

  const transitionFireCounts: Record<string, number> = {};
  for (const t of model.transitions) transitionFireCounts[t.name] = 0;

  const lawPremiseCounts: Record<string, number> = {};
  for (const l of model.laws) lawPremiseCounts[l.name] = 0;

  const buildVacuousAndUnreachable = (): {
    vacuousLaws: VacuousLawReport[];
    unreachableTransitions: UnreachableTransitionReport[];
  } => ({
    vacuousLaws: model.laws
      .filter((l) => (lawPremiseCounts[l.name] ?? 0) === 0)
      .map((l) => ({
        name: l.name,
        description: l.description,
        span: l.span,
        reason: l.when
          ? `Law "${l.name}" premise (:when) never held in any explored reachable state.`
          : `Law "${l.name}" was never evaluated because no reachable states were explored.`,
      })),
    unreachableTransitions: model.transitions
      .filter((t) => (transitionFireCounts[t.name] ?? 0) === 0)
      .map((t) => ({
        name: t.name,
        span: t.span,
        reason: `Transition "${t.name}" never fired from any explored reachable state.`,
      })),
  });

  const makeReport = (
    partial: Pick<
      BoundedVerificationReport,
      | "verdict"
      | "fixedPointReached"
      | "inconclusiveReason"
      | "inconclusiveMessage"
      | "unsupportedOperations"
      | "counterexample"
    >,
    stateCount: number,
    edgeCount: number,
    maxDepthReached: number,
  ): BoundedVerificationReport => {
    const { vacuousLaws, unreachableTransitions } = buildVacuousAndUnreachable();
    return {
      ...partial,
      modelName: model.name,
      modelHash,
      ...(sourceHash !== undefined ? { sourceHash } : {}),
      transitionSemanticsVersion: TRANSITION_SEMANTICS_VERSION,
      trustedComponents: DEFAULT_TRUSTED_COMPONENTS,
      domains: model.domains,
      initialStates: model.initialStates,
      assumptions: model.assumptions,
      bounds,
      stats: {
        stateCount,
        edgeCount,
        maxDepthReached,
        transitionFireCounts: { ...transitionFireCounts },
        lawPremiseCounts: { ...lawPremiseCounts },
      },
      vacuousLaws,
      unreachableTransitions,
    };
  };

  // 1. Validate model structure & decidable expression subset statically.
  if (model.initialStates.length === 0) {
    return makeReport(
      {
        verdict: "inconclusive",
        fixedPointReached: false,
        inconclusiveReason: "invalid-model",
        inconclusiveMessage: "Workflow model must declare at least one initial state.",
        unsupportedOperations: [],
      },
      0,
      0,
      0,
    );
  }

  const unsupportedOperations: UnsupportedOperationDetail[] = [];
  for (const t of model.transitions) {
    if (t.guard) {
      validateDecidableExpr(
        t.guard,
        `transition:${t.name}:guard`,
        model.sourceId,
        unsupportedOperations,
      );
    }
    validateDecidableExpr(
      t.update,
      `transition:${t.name}:update`,
      model.sourceId,
      unsupportedOperations,
    );
    for (const p of t.params) {
      if (!Object.prototype.hasOwnProperty.call(model.domains, p.domain)) {
        unsupportedOperations.push({
          operation: p.domain,
          reason: `Transition "${t.name}" parameter "${p.name}" references undeclared domain "${p.domain}".`,
          context: `transition:${t.name}:params`,
          span: t.span,
        });
      }
    }
  }
  for (const l of model.laws) {
    if (l.when) {
      validateDecidableExpr(
        l.when,
        `law:${l.name}:when`,
        model.sourceId,
        unsupportedOperations,
      );
    }
    validateDecidableExpr(
      l.holds,
      `law:${l.name}:holds`,
      model.sourceId,
      unsupportedOperations,
    );
  }

  if (unsupportedOperations.length > 0) {
    return makeReport(
      {
        verdict: "inconclusive",
        fixedPointReached: false,
        inconclusiveReason: "unsupported-operation",
        inconclusiveMessage: `Model contains ${unsupportedOperations.length} unsupported or non-decidable operation(s).`,
        unsupportedOperations,
      },
      0,
      0,
      0,
    );
  }

  // Precompute finite parameter combinations per transition.
  const transitionAssignments = new Map<
    string,
    readonly Readonly<Record<string, WorkflowValue>>[]
  >();
  for (const t of model.transitions) {
    transitionAssignments.set(t.name, enumerateParamAssignments(t.params, model.domains));
  }

  // 2. Initialize BFS queue with canonicalized initial states.
  const startTime = maxTimeMs !== undefined ? Date.now() : 0;
  const visited = new Map<string, number>();
  const states: WorkflowValue[] = [];
  const depths: number[] = [];
  const predecessors = new Map<number, PredecessorEdge>();
  const queue: number[] = [];

  let edgeCount = 0;
  let maxDepthReached = 0;

  const checkLawsOnState = (
    stateId: number,
  ): { violated?: WorkflowLawSpec; error?: UnsupportedOperationDetail } => {
    const state = states[stateId]!;
    const env: EvalEnv = { state };
    for (const law of model.laws) {
      try {
        const premiseHolds = law.when
          ? isTruthy(evalDecidableExpr(law.when, env, model.sourceId))
          : true;
        if (!premiseHolds) continue;
        lawPremiseCounts[law.name] = (lawPremiseCounts[law.name] ?? 0) + 1;
        const consequentHolds = isTruthy(
          evalDecidableExpr(law.holds, env, model.sourceId),
        );
        if (!consequentHolds) {
          return { violated: law };
        }
      } catch (err) {
        if (err instanceof UnsupportedEvalError) {
          return {
            error: {
              operation: err.operation,
              reason: err.message,
              context: `law:${law.name}`,
              span: err.span ?? law.span,
            },
          };
        }
        throw err;
      }
    }
    return {};
  };

  for (const initState of model.initialStates) {
    const key = canonicalizeState(initState);
    if (visited.has(key)) continue;
    if (states.length >= maxStates) {
      return makeReport(
        {
          verdict: "inconclusive",
          fixedPointReached: false,
          inconclusiveReason: "state-budget-exhausted",
          inconclusiveMessage: `State budget (${maxStates}) exhausted while seeding initial states.`,
          unsupportedOperations: [],
        },
        states.length,
        edgeCount,
        maxDepthReached,
      );
    }
    const id = states.length;
    visited.set(key, id);
    states.push(initState);
    depths.push(0);
    queue.push(id);

    const check = checkLawsOnState(id);
    if (check.error) {
      return makeReport(
        {
          verdict: "inconclusive",
          fixedPointReached: false,
          inconclusiveReason: "unsupported-operation",
          inconclusiveMessage: check.error.reason,
          unsupportedOperations: [check.error],
        },
        states.length,
        edgeCount,
        maxDepthReached,
      );
    }
    if (check.violated) {
      return makeReport(
        {
          verdict: "counterexample",
          fixedPointReached: false,
          unsupportedOperations: [],
          counterexample: reconstructTrace(id, check.violated, states, predecessors),
        },
        states.length,
        edgeCount,
        maxDepthReached,
      );
    }
  }

  // 3. BFS exploration to fixed point (or violation / budget exhaustion).
  let depthTruncated = false;
  let queueHead = 0;

  while (queueHead < queue.length) {
    if (maxTimeMs !== undefined && Date.now() - startTime > maxTimeMs) {
      return makeReport(
        {
          verdict: "inconclusive",
          fixedPointReached: false,
          inconclusiveReason: "time-budget-exhausted",
          inconclusiveMessage: `Time budget (${maxTimeMs}ms) exhausted before reaching fixed point.`,
          unsupportedOperations: [],
        },
        states.length,
        edgeCount,
        maxDepthReached,
      );
    }

    const currentId = queue[queueHead++]!;
    const currentState = states[currentId]!;
    const currentDepth = depths[currentId]!;
    if (currentDepth > maxDepthReached) maxDepthReached = currentDepth;

    for (const transition of model.transitions) {
      const assignments = transitionAssignments.get(transition.name) ?? [];
      for (const params of assignments) {
        const env: EvalEnv = { state: currentState, ...params };
        let enabled = true;
        try {
          if (transition.guard) {
            enabled = isTruthy(evalDecidableExpr(transition.guard, env, model.sourceId));
          }
        } catch (err) {
          if (err instanceof UnsupportedEvalError) {
            return makeReport(
              {
                verdict: "inconclusive",
                fixedPointReached: false,
                inconclusiveReason: "unsupported-operation",
                inconclusiveMessage: err.message,
                unsupportedOperations: [
                  {
                    operation: err.operation,
                    reason: err.message,
                    context: `transition:${transition.name}:guard`,
                    span: err.span ?? transition.span,
                  },
                ],
              },
              states.length,
              edgeCount,
              maxDepthReached,
            );
          }
          throw err;
        }
        if (!enabled) continue;

        let nextState: WorkflowValue;
        try {
          nextState = evalDecidableExpr(transition.update, env, model.sourceId);
        } catch (err) {
          if (err instanceof UnsupportedEvalError) {
            return makeReport(
              {
                verdict: "inconclusive",
                fixedPointReached: false,
                inconclusiveReason: "unsupported-operation",
                inconclusiveMessage: err.message,
                unsupportedOperations: [
                  {
                    operation: err.operation,
                    reason: err.message,
                    context: `transition:${transition.name}:update`,
                    span: err.span ?? transition.span,
                  },
                ],
              },
              states.length,
              edgeCount,
              maxDepthReached,
            );
          }
          throw err;
        }

        const nextKey = canonicalizeState(nextState);
        const alreadyVisited = visited.has(nextKey);

        // If we are at maxDepth and this edge reaches a new unvisited state,
        // we cannot claim a fixed point: mark depthTruncated and do not enqueue.
        if (maxDepth !== null && currentDepth >= maxDepth) {
          if (!alreadyVisited) {
            depthTruncated = true;
          }
          continue;
        }

        if (edgeCount >= maxEdges) {
          return makeReport(
            {
              verdict: "inconclusive",
              fixedPointReached: false,
              inconclusiveReason: "edge-budget-exhausted",
              inconclusiveMessage: `Edge budget (${maxEdges}) exhausted before reaching fixed point.`,
              unsupportedOperations: [],
            },
            states.length,
            edgeCount,
            maxDepthReached,
          );
        }

        edgeCount++;
        transitionFireCounts[transition.name] =
          (transitionFireCounts[transition.name] ?? 0) + 1;

        if (!alreadyVisited) {
          if (states.length >= maxStates) {
            return makeReport(
              {
                verdict: "inconclusive",
                fixedPointReached: false,
                inconclusiveReason: "state-budget-exhausted",
                inconclusiveMessage: `State budget (${maxStates}) exhausted before reaching fixed point.`,
                unsupportedOperations: [],
              },
              states.length,
              edgeCount,
              maxDepthReached,
            );
          }

          const nextId = states.length;
          visited.set(nextKey, nextId);
          states.push(nextState);
          const nextDepth = currentDepth + 1;
          depths.push(nextDepth);
          if (nextDepth > maxDepthReached) maxDepthReached = nextDepth;
          predecessors.set(nextId, {
            fromStateId: currentId,
            transition: transition.name,
            params,
            transitionSpan: transition.span,
          });

          const check = checkLawsOnState(nextId);
          if (check.error) {
            return makeReport(
              {
                verdict: "inconclusive",
                fixedPointReached: false,
                inconclusiveReason: "unsupported-operation",
                inconclusiveMessage: check.error.reason,
                unsupportedOperations: [check.error],
              },
              states.length,
              edgeCount,
              maxDepthReached,
            );
          }
          if (check.violated) {
            return makeReport(
              {
                verdict: "counterexample",
                fixedPointReached: false,
                unsupportedOperations: [],
                counterexample: reconstructTrace(nextId, check.violated, states, predecessors),
              },
              states.length,
              edgeCount,
              maxDepthReached,
            );
          }

          queue.push(nextId);
        }
      }
    }
  }

  // 4. Queue drained: distinguish true fixed-point completion from depth-truncated prefix.
  if (depthTruncated) {
    return makeReport(
      {
        verdict: "inconclusive",
        fixedPointReached: false,
        inconclusiveReason: "depth-budget-exhausted",
        inconclusiveMessage: `Depth bound (${maxDepth}) reached with unvisited successor states; fixed point was not reached.`,
        unsupportedOperations: [],
      },
      states.length,
      edgeCount,
      maxDepthReached,
    );
  }

  return makeReport(
    {
      verdict: "holds-in-model",
      fixedPointReached: true,
      unsupportedOperations: [],
    },
    states.length,
    edgeCount,
    maxDepthReached,
  );
}

// ---------------------------------------------------------------------------
// End-to-End Source Verification Convenience Helper
// ---------------------------------------------------------------------------

export interface VerifyWorkflowSourceOptions
  extends ParseWorkflowModelOptions,
    BoundedExplorationOptions {}

/**
 * Parse, elaborate via `workflow-laws.lisp`, and run bounded fixed-point
 * exploration over a Forma `(workflow-model ...)` source program.
 */
export function verifyWorkflowSource(
  source: string,
  options: VerifyWorkflowSourceOptions = {},
): BoundedVerificationReport {
  const parsed = parseWorkflowModelFromSource(source, options);
  if (!parsed.ok || !parsed.model) {
    const sourceHash = `${SOURCE_HASH_VERSION}:${sha256(source)}`;
    return {
      verdict: "inconclusive",
      fixedPointReached: false,
      inconclusiveReason: "invalid-model",
      inconclusiveMessage: parsed.diagnostics.map((d) => d.message).join("; "),
      unsupportedOperations: parsed.diagnostics.map((d) => ({
        operation: d.code,
        reason: d.message,
        context: "elaborate",
        span: d.span,
      })),
      modelName: "invalid",
      modelHash: `${MODEL_HASH_VERSION}:${sha256(source)}`,
      sourceHash,
      transitionSemanticsVersion: TRANSITION_SEMANTICS_VERSION,
      trustedComponents: DEFAULT_TRUSTED_COMPONENTS,
      domains: {},
      initialStates: [],
      assumptions: [],
      bounds: {
        maxStates: options.maxStates ?? 10_000,
        maxDepth:
          options.maxDepth === undefined || options.maxDepth === null || !Number.isFinite(options.maxDepth)
            ? null
            : Math.max(0, Math.floor(options.maxDepth)),
        maxEdges: options.maxEdges ?? 100_000,
        ...(options.maxTimeMs !== undefined ? { maxTimeMs: options.maxTimeMs } : {}),
      },
      stats: {
        stateCount: 0,
        edgeCount: 0,
        maxDepthReached: 0,
        transitionFireCounts: {},
        lawPremiseCounts: {},
      },
      vacuousLaws: [],
      unreachableTransitions: [],
    };
  }
  return exploreWorkflowModel(parsed.model, options);
}

// ---------------------------------------------------------------------------
// RFC 0029 EvidenceCache Integration
// ---------------------------------------------------------------------------

/**
 * Convert a `BoundedVerificationReport` into an RFC 0029
 * `VerificationEvidencePayload` suitable for direct storage in `EvidenceCache`.
 */
export function toVerificationEvidencePayload(
  report: BoundedVerificationReport,
): VerificationEvidencePayload {
  const bounds: Record<string, unknown> = {
    modelName: report.modelName,
    modelHash: report.modelHash,
    ...(report.sourceHash !== undefined ? { sourceHash: report.sourceHash } : {}),
    transitionSemanticsVersion: report.transitionSemanticsVersion,
    domains: report.domains,
    maxStates: report.bounds.maxStates,
    maxDepth: report.bounds.maxDepth,
    maxEdges: report.bounds.maxEdges,
    fixedPointReached: report.fixedPointReached,
    stateCount: report.stats.stateCount,
    edgeCount: report.stats.edgeCount,
    maxDepthReached: report.stats.maxDepthReached,
    vacuousLaws: report.vacuousLaws.map((l) => l.name),
    unreachableTransitions: report.unreachableTransitions.map((t) => t.name),
  };

  const assumptions = [
    ...report.assumptions,
    `transition-semantics:${report.transitionSemanticsVersion}`,
    ...report.trustedComponents.map((component) => `trusted-component:${component}`),
  ];

  return {
    result: report.verdict,
    bounds,
    assumptions,
    ...(report.counterexample !== undefined ? { counterexample: report.counterexample } : {}),
  };
}

/**
 * Default RFC 0029 `EvidenceTrustAccount` for bounded workflow verification reports.
 */
export function defaultVerificationTrustAccount(
  report?: BoundedVerificationReport,
): EvidenceTrustAccount {
  return {
    producer: "@formalang/ts/verification/bounded-explorer",
    version: TRANSITION_SEMANTICS_VERSION,
    profile: "finite-workflow-laws-v1",
    deterministic: report?.bounds.maxTimeMs === undefined,
    assumptions: report ? [...report.assumptions] : undefined,
    notes:
      "Finite-model bounded exploration only; holds-in-model is not a general theorem proof outside declared finite domains.",
  };
}

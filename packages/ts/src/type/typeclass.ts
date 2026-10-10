/**
 * Type class system: instance resolution, coherence checking, and constraint solving.
 *
 * Supports:
 *   - Single-parameter and multi-parameter type classes
 *   - Higher-kinded type parameters (e.g., Functor f where f : * -> *)
 *   - Super class constraints (e.g., Eq a => Ord a)
 *   - Instance resolution with backtracking and depth limit
 *   - Overlap detection
 */
import { Effect, Ref } from "effect";
import type { Type, Constraint } from "./types.js";
import { applyType, type Subst } from "./substitution.js";
import { InferContext } from "./context.js";
import type { Origin } from "./errors.js";
import { InferenceError } from "./errors.js";

// ---------------------------------------------------------------------------
// Instance resolution
// ---------------------------------------------------------------------------

const MAX_RESOLUTION_DEPTH = 20;

/**
 * Attempt to match a type against an instance head using one-way matching.
 * Returns a substitution mapping instance variables to concrete types,
 * or undefined if no match.
 */
function matchType(pattern: Type, target: Type): Map<string, Type> | undefined {
  const result = new Map<string, Type>();

  function go(p: Type, t: Type): boolean {
    if (p._tag === "TVar") {
      const existing = result.get(p.id);
      if (existing) {
        return typesEqual(existing, t);
      }
      result.set(p.id, t);
      return true;
    }
    if (p._tag === "TCon" && t._tag === "TCon") {
      return p.name === t.name;
    }
    if (p._tag === "TFun" && t._tag === "TFun") {
      return (
        go(p.arg, t.arg) &&
        go(p.res, t.res) &&
        (p.rest && t.rest ? go(p.rest, t.rest) : p.rest === t.rest)
      );
    }
    if (p._tag === "TVariadic" && t._tag === "TVariadic") {
      return go(p.rest, t.rest) && go(p.res, t.res);
    }
    if (p._tag === "TApp" && t._tag === "TApp") {
      if (!go(p.con, t.con)) return false;
      if (p.args.length !== t.args.length) return false;
      for (let i = 0; i < p.args.length; i++) {
        if (!go(p.args[i]!, t.args[i]!)) return false;
      }
      return true;
    }
    return false;
  }

  return go(pattern, target) ? result : undefined;
}

function typesEqual(a: Type, b: Type): boolean {
  if (a._tag !== b._tag) return false;
  switch (a._tag) {
    case "TVar":
      return b._tag === "TVar" && a.id === b.id;
    case "TCon":
      return b._tag === "TCon" && a.name === b.name;
    case "TFun":
      return (
        b._tag === "TFun" &&
        typesEqual(a.arg, b.arg) &&
        typesEqual(a.res, b.res) &&
        (a.rest && b.rest ? typesEqual(a.rest, b.rest) : a.rest === b.rest)
      );
    case "TVariadic":
      return b._tag === "TVariadic" && typesEqual(a.rest, b.rest) && typesEqual(a.res, b.res);
    case "TApp":
      if (b._tag !== "TApp") return false;
      if (!typesEqual(a.con, b.con)) return false;
      if (a.args.length !== b.args.length) return false;
      return a.args.every((arg, i) => typesEqual(arg, b.args[i]!));
    case "TRow":
      return false; // Row equality is complex, skip for now
  }
}

/**
 * Resolve a single constraint by searching the instance registry.
 * Returns the required sub-constraints (from the instance's context).
 *
 * For example, resolving `Eq (List a)` might find:
 *   instance Eq a => Eq (List a)
 * which returns the sub-constraint `Eq a`.
 */
export function resolveConstraint(
  constraint: Constraint,
  origin: Origin,
  depth: number = 0,
): Effect.Effect<readonly Constraint[], InferenceError, InferContext> {
  return Effect.gen(function* () {
    if (depth > MAX_RESOLUTION_DEPTH) {
      const ctx = yield* InferContext;
      return yield* ctx.fail(origin, {
        code: "typecheck/instance-depth", message: `Instance resolution depth exceeded for ${constraint.className}`,
      });
    }

    const ctx = yield* InferContext;
    const s = yield* Ref.get(ctx.subst);
    const resolvedArgs = constraint.args.map((a) => applyType(s, a));

    // Check if any arg is still a unification variable — defer resolution
    for (const arg of resolvedArgs) {
      if (arg._tag === "TVar") {
        // Can't resolve yet — return as-is (deferred constraint)
        return [{ className: constraint.className, args: resolvedArgs }];
      }
    }

    const registry = yield* Ref.get(ctx.instanceRegistry);
    const instances = registry.get(constraint.className) ?? [];

    for (const inst of instances) {
      // Try to match instance args against resolved constraint args
      if (inst.args.length !== resolvedArgs.length) continue;

      let match: Map<string, Type> | undefined = new Map();
      let matched = true;
      for (let i = 0; i < inst.args.length; i++) {
        const m = matchType(inst.args[i]!, resolvedArgs[i]!);
        if (!m) {
          matched = false;
          break;
        }
        // Merge matches
        for (const [k, v] of m) {
          const existing = match.get(k);
          if (existing && !typesEqual(existing, v)) {
            matched = false;
            break;
          }
          match.set(k, v);
        }
        if (!matched) break;
      }

      if (matched && match) {
        // Apply the match to instance constraints to get sub-constraints
        const sub: Subst = { tvars: match, rvars: new Map(), evars: new Map() };
        const subConstraints = inst.constraints.map((c) => ({
          className: c.className,
          args: c.args.map((a) => applyType(sub, a)),
        }));

        // Recursively resolve sub-constraints
        const allSub: Constraint[] = [];
        for (const sc of subConstraints) {
          const resolved = yield* resolveConstraint(sc, origin, depth + 1);
          allSub.push(...resolved);
        }
        return allSub;
      }
    }

    // No matching instance found
    return yield* ctx.fail(origin, {
      code: "typecheck/missing-instance", message: `No instance found for ${constraint.className} ${resolvedArgs.map(showTypeSimple).join(" ")}`,
    });
  });
}

function showTypeSimple(t: Type): string {
  switch (t._tag) {
    case "TVar":
      return t.id;
    case "TCon":
      return t.name;
    case "TApp":
      return `(${showTypeSimple(t.con)} ${t.args.map(showTypeSimple).join(" ")})`;
    case "TFun":
      return t.rest
        ? `(-> ${showTypeSimple(t.arg)} & ${showTypeSimple(t.rest)} ${showTypeSimple(t.res)})`
        : `(-> ${showTypeSimple(t.arg)} ${showTypeSimple(t.res)})`;
    case "TVariadic":
      return `(-> & ${showTypeSimple(t.rest)} ${showTypeSimple(t.res)})`;
    case "TRow":
      return "{...}";
  }
}

/**
 * Resolve all constraints, returning any that couldn't be resolved
 * (deferred due to unresolved type variables).
 */
export function resolveConstraints(
  constraints: readonly Constraint[],
  origin: Origin,
): Effect.Effect<readonly Constraint[], InferenceError, InferContext> {
  return Effect.gen(function* () {
    const deferred: Constraint[] = [];
    for (const c of constraints) {
      const remaining = yield* resolveConstraint(c, origin);
      deferred.push(...remaining);
    }
    return deferred;
  });
}

/**
 * Check for overlapping instances (coherence check).
 * Two instances overlap if their heads can be unified.
 */
export function checkCoherence(
  className: string,
  newArgs: readonly Type[],
): Effect.Effect<void, InferenceError, InferContext> {
  return Effect.gen(function* () {
    const ctx = yield* InferContext;
    const registry = yield* Ref.get(ctx.instanceRegistry);
    const existing = registry.get(className) ?? [];

    for (const inst of existing) {
      if (inst.args.length !== newArgs.length) continue;

      // Check if the new instance overlaps with existing
      let overlaps = true;
      for (let i = 0; i < inst.args.length; i++) {
        if (!couldOverlap(inst.args[i]!, newArgs[i]!)) {
          overlaps = false;
          break;
        }
      }

      if (overlaps) {
        return yield* ctx.fail(
          { nodeId: "", span: { start: 0, end: 0 }, kind: "instance" },
          {
            code: "typecheck/overlapping-instance", message: `Overlapping instance for ${className}`,
          },
        );
      }
    }
  });
}

/**
 * Conservative overlap check: could these two types match the same concrete type?
 */
function couldOverlap(a: Type, b: Type): boolean {
  // A type variable can match anything
  if (a._tag === "TVar" || b._tag === "TVar") return true;
  if (a._tag !== b._tag) return false;
  if (a._tag === "TCon" && b._tag === "TCon") return a.name === b.name;
  if (a._tag === "TApp" && b._tag === "TApp") {
    if (!couldOverlap(a.con, b.con)) return false;
    if (a.args.length !== b.args.length) return false;
    return a.args.every((arg, i) => couldOverlap(arg, b.args[i]!));
  }
  return true;
}

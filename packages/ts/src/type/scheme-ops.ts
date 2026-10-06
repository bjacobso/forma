/**
 * Scheme operations: generalize, instantiate, and related helpers.
 */
import { Effect, Ref } from "effect";
import type { Type, Scheme, Row, ERow } from "./types.js";
import { ftvType, frvType, fevType, Scheme as mkScheme } from "./types.js";
import { applyType, freeVarsEnv, type TypeEnv, type Subst } from "./substitution.js";
import { InferContext } from "./context.js";
import type { PendingConstraint } from "./context.js";
import type { Origin } from "./errors.js";

// ---------------------------------------------------------------------------
// Generalize & instantiate
// ---------------------------------------------------------------------------

export function generalize(env: TypeEnv, t: Type): Scheme {
  const envFree = freeVarsEnv(env);
  const typeTv = ftvType(t);
  const typeRv = frvType(t);
  const typeEv = fevType(t);

  const tvars: string[] = [];
  for (const v of typeTv) {
    if (!envFree.tvars.has(v)) tvars.push(v);
  }
  const rvars: string[] = [];
  for (const v of typeRv) {
    if (!envFree.rvars.has(v)) rvars.push(v);
  }
  const evars: string[] = [];
  for (const v of typeEv) {
    if (!envFree.evars.has(v)) evars.push(v);
  }
  return mkScheme(tvars, rvars, t, evars);
}

export function constraintTypeVars(pending: PendingConstraint): Set<string> {
  const vars = new Set<string>();
  for (const arg of pending.constraint.args) {
    ftvType(arg, vars);
  }
  return vars;
}

export const generalizeBinding = (
  env: TypeEnv,
  t: Type,
  pendingStart: number,
): Effect.Effect<Scheme, never, InferContext> =>
  Effect.gen(function* () {
    const ctx = yield* InferContext;
    const pending = yield* Ref.get(ctx.pendingConstraints);
    const retainedPending = pending.slice(0, pendingStart);
    const bindingPending = pending.slice(pendingStart);
    const scheme = generalize(env, t);

    if (bindingPending.length === 0 || scheme.tvars.length === 0) {
      return scheme;
    }

    const generalizedVars = new Set(scheme.tvars);
    const schemeConstraints = [];
    const deferredPending: PendingConstraint[] = [];

    for (const pendingConstraint of bindingPending) {
      const vars = constraintTypeVars(pendingConstraint);
      const onlyGeneralizedVars = Array.from(vars).every((v) => generalizedVars.has(v));
      const usesGeneralizedVars = Array.from(vars).some((v) => generalizedVars.has(v));

      if (usesGeneralizedVars && onlyGeneralizedVars) {
        schemeConstraints.push(pendingConstraint.constraint);
      } else {
        deferredPending.push(pendingConstraint);
      }
    }

    if (deferredPending.length !== bindingPending.length) {
      yield* Ref.set(ctx.pendingConstraints, [...retainedPending, ...deferredPending]);
    }

    return schemeConstraints.length === 0 ? scheme : { ...scheme, constraints: schemeConstraints };
  });

export const instantiate = (scheme: Scheme): Effect.Effect<Type, never, InferContext> =>
  Effect.gen(function* () {
    if (scheme.tvars.length === 0 && scheme.rvars.length === 0 && scheme.evars.length === 0)
      return scheme.type;

    const ctx = yield* InferContext;
    const tSub = new Map<string, Type>();
    for (const v of scheme.tvars) {
      tSub.set(v, yield* ctx.freshTVar);
    }
    const rSub = new Map<string, Row>();
    for (const v of scheme.rvars) {
      rSub.set(v, yield* ctx.freshRowVar);
    }
    const eSub = new Map<string, ERow>();
    for (const v of scheme.evars) {
      eSub.set(v, yield* ctx.freshEVar);
    }

    return applyType({ tvars: tSub, rvars: rSub, evars: eSub }, scheme.type);
  });

/**
 * Instantiate a scheme AND push its constraints (with fresh vars applied)
 * onto the pending constraints list for later discharge.
 */
export const instantiateWithConstraints = (
  scheme: Scheme,
  origin: Origin,
): Effect.Effect<Type, never, InferContext> =>
  Effect.gen(function* () {
    if (
      scheme.tvars.length === 0 &&
      scheme.rvars.length === 0 &&
      scheme.evars.length === 0 &&
      scheme.constraints.length === 0
    )
      return scheme.type;

    const ctx = yield* InferContext;
    const tSub = new Map<string, Type>();
    for (const v of scheme.tvars) {
      tSub.set(v, yield* ctx.freshTVar);
    }
    const rSub = new Map<string, Row>();
    for (const v of scheme.rvars) {
      rSub.set(v, yield* ctx.freshRowVar);
    }
    const eSub = new Map<string, ERow>();
    for (const v of scheme.evars) {
      eSub.set(v, yield* ctx.freshEVar);
    }

    const sub: Subst = { tvars: tSub, rvars: rSub, evars: eSub };

    // Push constraints with fresh vars applied
    if (scheme.constraints.length > 0) {
      const freshConstraints: PendingConstraint[] = scheme.constraints.map((c) => ({
        constraint: {
          className: c.className,
          args: c.args.map((a) => applyType(sub, a)),
        },
        origin,
      }));
      yield* Ref.update(ctx.pendingConstraints, (list) => [...list, ...freshConstraints]);
    }

    return applyType(sub, scheme.type);
  });

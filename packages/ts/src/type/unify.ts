/**
 * Unification for types and rows using the InferContext service.
 *
 * Always applies the current substitution before operating, writes new
 * bindings through the Ref<Subst>, includes occurs checks, and supports
 * row unification with open/closed record semantics.
 */
import { Effect, Ref } from "effect";
import type { Type, Row, ERow } from "./types.js";
import { showType, flattenRow, buildRow, flattenERow, buildERow, EEmpty } from "./types.js";
import { TApp, TCon, TFun } from "./types.js";
import type { Subst } from "./substitution.js";
import {
  applyType,
  applyRow,
  applyERow,
  occursInType,
  occursInRow,
  occursInERow,
} from "./substitution.js";
import { InferContext } from "./context.js";
import type { Origin } from "./errors.js";
import { InferenceError } from "./errors.js";

// ---------------------------------------------------------------------------
// Bind helpers — mutate Subst through InferContext
// ---------------------------------------------------------------------------

const bindTVar = (id: string, t: Type, origin: Origin) =>
  Effect.gen(function* () {
    const ctx = yield* InferContext;
    const s = yield* Ref.get(ctx.subst);

    const tApplied = applyType(s, t);
    if (tApplied._tag === "TVar" && tApplied.id === id) return;

    if (occursInType(id, tApplied)) {
      return yield* ctx.fail(origin, {
        message: `Infinite type: ${id} occurs in ${showType(tApplied)}`,
        tvar: id,
        in: showType(tApplied),
      });
    }

    yield* Ref.update(ctx.subst, (cur: Subst): Subst => {
      const next = new Map(cur.tvars);
      next.set(id, tApplied);
      return { tvars: next, rvars: cur.rvars, evars: cur.evars };
    });
  });

const bindRVar = (id: string, r: Row, origin: Origin) =>
  Effect.gen(function* () {
    const ctx = yield* InferContext;
    const s = yield* Ref.get(ctx.subst);

    const rApplied = applyRow(s, r);
    if (rApplied._tag === "RVar" && rApplied.id === id) return;

    if (occursInRow(id, rApplied)) {
      return yield* ctx.fail(origin, {
        message: "Row occurs check failed",
        rvar: id,
      });
    }

    yield* Ref.update(ctx.subst, (cur: Subst): Subst => {
      const next = new Map(cur.rvars);
      next.set(id, rApplied);
      return { tvars: cur.tvars, rvars: next, evars: cur.evars };
    });
  });

const bindEVar = (id: string, e: ERow, origin: Origin) =>
  Effect.gen(function* () {
    const ctx = yield* InferContext;
    const s = yield* Ref.get(ctx.subst);

    const eApplied = applyERow(s, e);
    if (eApplied._tag === "EVar" && eApplied.id === id) return;

    if (occursInERow(id, eApplied)) {
      return yield* ctx.fail(origin, {
        message: "Effect row occurs check failed",
        evar: id,
      });
    }

    yield* Ref.update(ctx.subst, (cur: Subst): Subst => {
      const next = new Map(cur.evars);
      next.set(id, eApplied);
      return { tvars: cur.tvars, rvars: cur.rvars, evars: next };
    });
  });

// ---------------------------------------------------------------------------
// unify (types)
// ---------------------------------------------------------------------------

export const unify = (
  t1: Type,
  t2: Type,
  origin: Origin,
): Effect.Effect<void, InferenceError, InferContext> =>
  Effect.gen(function* () {
    const ctx = yield* InferContext;
    const s0 = yield* Ref.get(ctx.subst);

    const a = applyType(s0, t1);
    const b = applyType(s0, t2);

    // TVar binding
    if (a._tag === "TVar") return yield* bindTVar(a.id, b, origin);
    if (b._tag === "TVar") return yield* bindTVar(b.id, a, origin);

    // Unknown is a gradual type — it unifies with anything
    if (a._tag === "TCon" && a.name === "Unknown") return;
    if (b._tag === "TCon" && b.name === "Unknown") return;

    // TCon must match
    if (a._tag === "TCon" && b._tag === "TCon") {
      if (a.name === b.name) return;
      return yield* ctx.fail(origin, {
        message: `Type mismatch: ${showType(a)} vs ${showType(b)}`,
        expected: showType(a),
        got: showType(b),
      });
    }

    // TFun: unify arg, res, and effects
    if (a._tag === "TFun" && b._tag === "TFun") {
      yield* unify(a.arg, b.arg, origin);
      yield* unify(a.res, b.res, origin);
      if (a.rest && b.rest) {
        yield* unify(a.rest, b.rest, origin);
      }
      // Missing annotations mean a pure arrow.
      if (a.effect || b.effect) {
        yield* unifyERows(a.effect ?? EEmpty, b.effect ?? EEmpty, origin);
      }
      return;
    }

    if (a._tag === "TVariadic" && b._tag === "TVariadic") {
      yield* unify(a.rest, b.rest, origin);
      yield* unify(a.res, b.res, origin);
      if (a.effect || b.effect) {
        yield* unifyERows(a.effect ?? EEmpty, b.effect ?? EEmpty, origin);
      }
      return;
    }

    // TApp: unify constructor and all args
    if (a._tag === "TApp" && b._tag === "TApp") {
      yield* unify(a.con, b.con, origin);
      if (isFiniteTypeSet(a.con) && isFiniteTypeSet(b.con)) {
        yield* unifyFiniteTypeSetArgs(a.args, b.args, origin);
        return;
      }
      yield* unifyTypeAppArgs(a, b, origin);
      return;
    }

    // TRow: delegate to row unification
    if (a._tag === "TRow" && b._tag === "TRow") {
      yield* unifyRows(a.row, b.row, origin);
      return;
    }

    return yield* ctx.fail(origin, {
      message: `Cannot unify ${showType(a)} with ${showType(b)}`,
      expected: showType(a),
      got: showType(b),
    });
  });

function isFiniteTypeSet(type: Type): boolean {
  return type._tag === "TCon" && (type.name === "ErrorSet" || type.name === "RequirementSet");
}

const sortTypeSetArgs = (args: readonly Type[]): readonly Type[] =>
  [...args].sort((left, right) => showType(left).localeCompare(showType(right)));

const unifyFiniteTypeSetArgs = (
  left: readonly Type[],
  right: readonly Type[],
  origin: Origin,
): Effect.Effect<void, InferenceError, InferContext> =>
  Effect.gen(function* () {
    const ctx = yield* InferContext;
    const sortedLeft = sortTypeSetArgs(left);
    const sortedRight = sortTypeSetArgs(right);
    const commonLength = Math.min(sortedLeft.length, sortedRight.length);
    for (let i = 0; i < commonLength; i++) {
      yield* unify(sortedLeft[i]!, sortedRight[i]!, origin);
    }
    if (sortedLeft.length !== sortedRight.length) {
      return yield* ctx.fail(origin, {
        message: "Type application arity mismatch",
        left: showType(TApp(TCon("Set"), left)),
        right: showType(TApp(TCon("Set"), right)),
      });
    }
  });

const unifyTypeAppArgs = (
  left: Type & { readonly _tag: "TApp" },
  right: Type & { readonly _tag: "TApp" },
  origin: Origin,
): Effect.Effect<void, InferenceError, InferContext> =>
  Effect.gen(function* () {
    const ctx = yield* InferContext;
    if (left.args.length !== right.args.length) {
      return yield* ctx.fail(origin, {
        message: "Type application arity mismatch",
        left: showType(left),
        right: showType(right),
      });
    }
    for (let i = 0; i < left.args.length; i++) {
      yield* unify(left.args[i]!, right.args[i]!, origin);
    }
  });

// ---------------------------------------------------------------------------
// unifyRows
// ---------------------------------------------------------------------------

export const unifyRows = (
  r1: Row,
  r2: Row,
  origin: Origin,
): Effect.Effect<void, InferenceError, InferContext> =>
  Effect.gen(function* () {
    const ctx = yield* InferContext;
    const s0 = yield* Ref.get(ctx.subst);

    const a0 = applyRow(s0, r1);
    const b0 = applyRow(s0, r2);

    // RVar binding cases
    if (a0._tag === "RVar") return yield* bindRVar(a0.id, b0, origin);
    if (b0._tag === "RVar") return yield* bindRVar(b0.id, a0, origin);

    // Both empty
    if (a0._tag === "REmpty" && b0._tag === "REmpty") return;

    // Flatten and compare
    const A = flattenRow(a0);
    const B = flattenRow(b0);

    // Unify shared keys
    for (const [k, tA] of A.fields) {
      const tB = B.fields.get(k);
      if (tB) yield* unify(tA, tB, origin);
    }

    // Keys only in A / only in B
    const onlyA = new Map<string, Type>();
    for (const [k, tA] of A.fields) {
      if (!B.fields.has(k)) onlyA.set(k, tA);
    }
    const onlyB = new Map<string, Type>();
    for (const [k, tB] of B.fields) {
      if (!A.fields.has(k)) onlyB.set(k, tB);
    }

    const s1 = yield* Ref.get(ctx.subst);
    const aTail = applyRow(s1, A.tail);
    const bTail = applyRow(s1, B.tail);

    if (aTail._tag === "RVar" && bTail._tag === "RVar" && aTail.id === bTail.id
      && (onlyA.size > 0 || onlyB.size > 0)) {
      return yield* ctx.fail(origin, { message: "Incompatible fields on records sharing the same row tail" });
    }

    // Closed record missing fields => error
    if (onlyB.size > 0 && aTail._tag === "REmpty") {
      return yield* ctx.fail(origin, {
        message: "Missing field(s) in record",
        missingIn: "left",
        fields: Array.from(onlyB.keys()).sort(),
      });
    }
    if (onlyA.size > 0 && bTail._tag === "REmpty") {
      return yield* ctx.fail(origin, {
        message: "Missing field(s) in record",
        missingIn: "right",
        fields: Array.from(onlyA.keys()).sort(),
      });
    }

    // Unify tails accounting for extra fields on each side
    if (onlyA.size === 0 && onlyB.size === 0) {
      yield* unifyRows(aTail, bTail, origin);
    } else if (onlyB.size === 0) {
      // B's tail must accommodate A's extra fields + A's tail
      yield* unifyRows(bTail, buildRow(onlyA, aTail), origin);
    } else if (onlyA.size === 0) {
      // A's tail must accommodate B's extra fields + B's tail
      yield* unifyRows(aTail, buildRow(onlyB, bTail), origin);
    } else {
      // Both have extra fields — introduce a fresh common tail
      const freshTail = yield* ctx.freshRowVar;
      yield* unifyRows(aTail, buildRow(onlyB, freshTail), origin);
      yield* unifyRows(bTail, buildRow(onlyA, freshTail), origin);
    }
  });

// ---------------------------------------------------------------------------
// unifyERows (effect rows)
// ---------------------------------------------------------------------------

export const unifyERows = (
  e1: ERow,
  e2: ERow,
  origin: Origin,
): Effect.Effect<void, InferenceError, InferContext> =>
  Effect.gen(function* () {
    const ctx = yield* InferContext;
    const s0 = yield* Ref.get(ctx.subst);

    const a0 = applyERow(s0, e1);
    const b0 = applyERow(s0, e2);

    // EVar binding
    if (a0._tag === "EVar") return yield* bindEVar(a0.id, b0, origin);
    if (b0._tag === "EVar") return yield* bindEVar(b0.id, a0, origin);

    // Both empty
    if (a0._tag === "EEmpty" && b0._tag === "EEmpty") return;

    // Flatten and compare
    const A = flattenERow(a0);
    const B = flattenERow(b0);

    // Labels only in A / only in B / shared
    const onlyA = new Set<string>();
    for (const l of A.labels) {
      if (!B.labels.has(l)) onlyA.add(l);
    }
    const onlyB = new Set<string>();
    for (const l of B.labels) {
      if (!A.labels.has(l)) onlyB.add(l);
    }

    const s1 = yield* Ref.get(ctx.subst);
    const aTail = applyERow(s1, A.tail);
    const bTail = applyERow(s1, B.tail);

    // Closed effect row missing labels => error
    if (onlyB.size > 0 && aTail._tag === "EEmpty") {
      return yield* ctx.fail(origin, {
        message: `Missing effect(s): ${Array.from(onlyB).sort().join(", ")}`,
      });
    }
    if (onlyA.size > 0 && bTail._tag === "EEmpty") {
      return yield* ctx.fail(origin, {
        message: `Missing effect(s): ${Array.from(onlyA).sort().join(", ")}`,
      });
    }

    // Unify tails accounting for extra labels
    if (onlyA.size === 0 && onlyB.size === 0) {
      yield* unifyERows(aTail, bTail, origin);
    } else if (onlyB.size === 0) {
      yield* unifyERows(bTail, buildERow(onlyA, aTail), origin);
    } else if (onlyA.size === 0) {
      yield* unifyERows(aTail, buildERow(onlyB, bTail), origin);
    } else {
      const freshTail = yield* ctx.freshEVar;
      yield* unifyERows(aTail, buildERow(onlyB, freshTail), origin);
      yield* unifyERows(bTail, buildERow(onlyA, freshTail), origin);
    }
  });

// ---------------------------------------------------------------------------
// Convenience: unify for function application
// ---------------------------------------------------------------------------

/**
 * Apply a function type to an argument, returning the result type.
 * If fnT is not a function, unifies with `arg -> freshVar`.
 */
export const applyFn = (
  fnT: Type,
  argT: Type,
  origin: Origin,
): Effect.Effect<Type, InferenceError, InferContext> =>
  Effect.gen(function* () {
    const ctx = yield* InferContext;
    const retT = yield* ctx.freshTVar;
    yield* unify(fnT, TFun(argT, retT), origin);
    const s = yield* Ref.get(ctx.subst);
    return applyType(s, retT);
  });

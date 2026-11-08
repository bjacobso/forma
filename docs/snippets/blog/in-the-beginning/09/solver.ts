import { Effect, Schema } from "effect";
import { Span } from "../02/sexp.ts";
import {
  type CheckError as Part5Error,
  CyclicType,
  Mismatch,
} from "../05/errors.ts";
import {
  children,
  fun,
  row,
  showType,
  type TFun,
  type TRow,
  type Type,
} from "./types.ts";

// #region unhandled
// A new type error: an effect that nothing around it allows.
export class Unhandled extends Schema.TaggedError<Unhandled>()(
  "Unhandled",
  { effect: Schema.String, span: Span },
) {
  override get message() {
    return `unhandled effect: ${this.effect}`;
  }
}

export type CheckError = Part5Error | Unhandled;
// #endregion unhandled

type Check<A> = Effect.Effect<A, CheckError>;

// Part 5's arity rule, for this post's function types.
export const paramsFor = (f: TFun, n: number) =>
  n === f.params.length || (f.rest && n > f.params.length)
    ? Array.from({ length: n }, (_, i) => f.params[i] ?? f.rest!)
    : undefined;

// Part 5's solver, extended to rows.
export const makeSolver = () => {
  const solved = new Map<number, Type>();
  let next = 0;
  const fresh = (): Type => ({ _tag: "TVar", id: next++ });

  // #region resolve
  const resolve = (t: Type): Type => {
    switch (t._tag) {
      case "TVar": {
        const known = solved.get(t.id);
        return known ? resolve(known) : t;
      }
      case "TFun": {
        const params = t.params.map(resolve);
        const rest = t.rest && resolve(t.rest);
        const effects = resolve(t.effects);
        return fun(params, resolve(t.result), effects, rest);
      }
      case "TRow": {
        // A tail that turned out to be a row adds its labels.
        const tail = t.tail && resolve(t.tail);
        if (tail?._tag !== "TRow") return row(t.labels, tail);
        const labels = new Set([...t.labels, ...tail.labels]);
        return row([...labels], tail.tail);
      }
      default:
        return t;
    }
  };
  // #endregion resolve

  const occurs = (id: number, t: Type): boolean =>
    t._tag === "TVar"
      ? t.id === id
      : children(t).some((inner) => occurs(id, resolve(inner)));

  const mismatch = (expected: Type, got: Type, span: Span) => {
    const names = new Map<number, string>();
    return new Mismatch({
      expected: showType(resolve(expected), names),
      got: showType(resolve(got), names),
      span,
    });
  };

  const bind = (id: number, t: Type, span: Span): Check<void> => {
    if (!occurs(id, t)) {
      return Effect.sync(() => void solved.set(id, t));
    }
    const names = new Map<number, string>();
    const variable = showType({ _tag: "TVar", id }, names);
    const type = showType(resolve(t), names);
    return Effect.fail(new CyclicType({ variable, type, span }));
  };

  const unify = (want: Type, got: Type, span: Span): Check<void> =>
    Effect.gen(function* () {
      const a = resolve(want);
      const b = resolve(got);
      if (a._tag === "TVar") {
        if (b._tag === "TVar" && a.id === b.id) return;
        return yield* bind(a.id, b, span);
      }
      if (b._tag === "TVar") return yield* bind(b.id, a, span);
      if (a._tag === "TRow" && b._tag === "TRow") {
        return yield* rows(a, b, span);
      }
      if (a._tag !== "TFun" || b._tag !== "TFun") {
        if (a._tag === b._tag) return;
        return yield* mismatch(a, b, span);
      }
      const bs = a.rest
        ? b.rest && b.params.length === a.params.length && b.params
        : paramsFor(b, a.params.length);
      if (!bs) return yield* mismatch(a, b, span);
      if (a.rest && b.rest) yield* unify(a.rest, b.rest, span);
      for (const [i, p] of a.params.entries()) {
        yield* unify(p, bs[i]!, span);
      }
      yield* unify(a.result, b.result, span);
      // New: calling one must do no more than calling the other.
      yield* unify(a.effects, b.effects, span);
    });

  // #region rows
  // Two rows are equal as sets of labels. Labels one row has and
  // the other lacks must fit in the other's tail. A row without a
  // tail is closed: nothing more fits, so the extra label is an
  // unhandled effect.
  const rows = (a: TRow, b: TRow, span: Span): Check<void> =>
    Effect.gen(function* () {
      const onlyA = a.labels.filter((l) => !b.labels.includes(l));
      const onlyB = b.labels.filter((l) => !a.labels.includes(l));
      if (!b.tail && onlyA[0]) {
        return yield* new Unhandled({ effect: onlyA[0], span });
      }
      if (!a.tail && onlyB[0]) {
        return yield* new Unhandled({ effect: onlyB[0], span });
      }
      if (!a.tail || !b.tail) {
        if (a.tail) yield* unify(a.tail, row(onlyB, null), span);
        if (b.tail) yield* unify(b.tail, row(onlyA, null), span);
        return;
      }
      if (sameVar(a.tail, b.tail)) {
        if (onlyA.length + onlyB.length === 0) return;
        return yield* mismatch(a, b, span);
      }
      // {A | r1} = {B | r2}: r1 gets B's extras, r2 gets A's,
      // and both keep a new tail for anything else.
      const rest = fresh();
      yield* unify(a.tail, row(onlyB, rest), span);
      yield* unify(b.tail, row(onlyA, rest), span);
    });
  // #endregion rows

  return { fresh, resolve, unify };
};

const sameVar = (a: Type, b: Type) =>
  a._tag === "TVar" && b._tag === "TVar" && a.id === b.id;

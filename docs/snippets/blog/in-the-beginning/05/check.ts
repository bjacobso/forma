import { Effect } from "effect";
import type { Span } from "../02/sexp.ts";
import type { Expr } from "../04/expr.ts";
import {
  ArityError,
  type CheckError,
  CyclicType,
  Mismatch,
  UnboundName,
} from "./errors.ts";
import { data, fun, num, showType, type TFun, type Type } from "./types.ts";

type Check<A> = Effect.Effect<A, CheckError>;

// #region arity
// The parameter types for a call with n arguments, if n is allowed.
const paramsFor = (f: TFun, n: number) =>
  n === f.params.length || (f.rest && n > f.params.length)
    ? Array.from({ length: n }, (_, i) => f.params[i] ?? f.rest!)
    : undefined;
// #endregion arity

// #region solver
// One checking run: a supply of fresh type variables, and what has
// been learned about them so far.
const makeSolver = () => {
  const solved = new Map<number, Type>();
  let next = 0;
  const fresh = (): Type => ({ _tag: "TVar", id: next++ });

  // Replace solved variables, all the way down.
  const resolve = (t: Type): Type => {
    if (t._tag === "TVar") {
      const known = solved.get(t.id);
      return known ? resolve(known) : t;
    }
    if (t._tag !== "TFun") return t;
    const rest = t.rest && resolve(t.rest);
    return fun(t.params.map(resolve), resolve(t.result), rest);
  };

  const occurs = (id: number, t: Type): boolean =>
    t._tag === "TVar" ? t.id === id
    : t._tag !== "TFun" ? false
    : [...t.params, t.result, ...(t.rest ? [t.rest] : [])].some(
        (inner) => occurs(id, resolve(inner)),
      );

  const mismatch = (expected: Type, got: Type, span: Span) => {
    const names = new Map<number, string>();
    return new Mismatch({
      expected: showType(resolve(expected), names),
      got: showType(resolve(got), names),
      span,
    });
  };

  // Learn that variable `id` is `t`, unless `t` contains it.
  const bind = (id: number, t: Type, span: Span): Check<void> => {
    if (!occurs(id, t)) {
      return Effect.sync(() => void solved.set(id, t));
    }
    const names = new Map<number, string>();
    const variable = showType({ _tag: "TVar", id }, names);
    const type = showType(resolve(t), names);
    return Effect.fail(new CyclicType({ variable, type, span }));
  };

  // Make two types equal, or explain why they can't be.
  const unify = (want: Type, got: Type, span: Span): Check<void> =>
    Effect.gen(function* () {
      const a = resolve(want);
      const b = resolve(got);
      if (a._tag === "TVar") {
        if (b._tag === "TVar" && a.id === b.id) return;
        return yield* bind(a.id, b, span);
      }
      if (b._tag === "TVar") return yield* bind(b.id, a, span);
      if (a._tag !== "TFun" || b._tag !== "TFun") {
        if (a._tag === b._tag) return;
        return yield* mismatch(a, b, span);
      }
      // A variadic function can stand in for a fixed one.
      const bs = a.rest
        ? b.rest && b.params.length === a.params.length && b.params
        : paramsFor(b, a.params.length);
      if (!bs) return yield* mismatch(a, b, span);
      if (a.rest && b.rest) yield* unify(a.rest, b.rest, span);
      for (const [i, p] of a.params.entries()) {
        yield* unify(p, bs[i]!, span);
      }
      yield* unify(a.result, b.result, span);
    });

  return { fresh, resolve, unify };
};
// #endregion solver

// #region scope
// A type scope maps each name to a way of getting its type. Most
// names always give the same type; a polymorphic primitive gives a
// fresh copy each time it's mentioned.
type TypeOf = (fresh: () => Type) => Type;
export interface TypeScope {
  readonly names: ReadonlyMap<string, TypeOf>;
  readonly parent: TypeScope | undefined;
}

const find = (
  scope: TypeScope | undefined,
  name: string,
): TypeOf | undefined =>
  scope === undefined ? undefined
  : (scope.names.get(name) ?? find(scope.parent, name));

const arithmetic = () => fun([], num, num);
export const globalTypes: TypeScope = {
  names: new Map<string, TypeOf>([
    ["+", arithmetic],
    ["*", arithmetic],
    ["/", arithmetic],
    ["pi", () => num],
    ["print", (fresh) => {
      const a = fresh();
      return fun([a], a);
    }],
  ]),
  parent: undefined,
};
// #endregion scope

// #region infer
export const check = (
  expr: Expr,
  scope = globalTypes,
): Check<Type> =>
  Effect.gen(function* () {
    // A new solver for every run of this Effect.
    const { fresh, resolve, unify } = makeSolver();

    const infer = (e: Expr, scope: TypeScope): Check<Type> =>
      Effect.gen(function* () {
        switch (e._tag) {
          case "Num":
            return num;
          case "Quote":
            return data;
          case "Ref": {
            const typeOf = find(scope, e.name);
            if (typeOf) return typeOf(fresh);
            const { name: symbol, span } = e;
            return yield* new UnboundName({ symbol, span });
          }
          case "Lambda": {
            // Each parameter starts as a fresh, unknown type.
            const params = e.params.map(() => fresh());
            const names = new Map(
              e.params.map((p, i) => [p.name, () => params[i]!]),
            );
            const body = { names, parent: scope };
            return fun(params, yield* infer(e.body, body));
          }
          case "Call":
            return yield* inferCall(e, scope);
        }
      });

    const inferCall = (
      e: Extract<Expr, { _tag: "Call" }>,
      scope: TypeScope,
    ): Check<Type> =>
      Effect.gen(function* () {
        const f = resolve(yield* infer(e.fn, scope));
        const args: Type[] = [];
        for (const arg of e.args) {
          args.push(yield* infer(arg, scope));
        }
        if (f._tag === "TVar") {
          // Calling an unknown: now we know it's a function.
          const result = fresh();
          yield* unify(f, fun(args, result), e.fn.span);
          return result;
        }
        if (f._tag !== "TFun") {
          const expected = "a function";
          const got = showType(f);
          const { span } = e.fn;
          return yield* new Mismatch({ expected, got, span });
        }
        const params = paramsFor(f, args.length);
        if (!params) {
          const expected = f.params.length;
          const got = args.length;
          const { span } = e;
          return yield* new ArityError({ expected, got, span });
        }
        for (const [i, arg] of e.args.entries()) {
          yield* unify(params[i]!, args[i]!, arg.span);
        }
        return f.result;
      });

    return resolve(yield* infer(expr, scope));
  });
// #endregion infer

import { Effect } from "effect";
import type { Sexp, Span } from "../02/sexp.ts";
import {
  execute,
  globals,
  type Primitive,
  type Value,
} from "../06/execute.ts";
import {
  type Core,
  type Elab,
  fail,
  type Form,
  type Kernel,
  type Prelude,
  type Scheme,
} from "./kernel.ts";
import { data, fun, num, row, type Type, unit } from "./types.ts";

type Inside = (k: Kernel) => Elab;

const call = (k: Kernel, name: string, args: Core[], span: Span) =>
  Effect.flatMap(k.prelude(name, span), (fn) =>
    k.apply(fn, args, span),
  );

// #region now
// A function that the form calls right where it's written. Its body
// may do what the code around it may do, so an effect it isn't
// allowed is reported inside the body, where it happens.
const now = (
  k: Kernel,
  names: ReadonlyArray<string>,
  schemes: ReadonlyArray<Scheme>,
  inside: Inside,
  span: Span,
): Elab =>
  Effect.map(k.within(names, schemes, inside), (body): Core => {
    const params = schemes.map((s) => s.type);
    const type = fun(params, body.type, k.effects);
    return { _tag: "Lambda", params: names, body, type, span };
  });
// #endregion now

// Part 8's quote, lambda, let, and if. lambda builds its function
// with k.lambda, and let and if build theirs with now.
const quote: Form = ({ items, span }) => {
  const [, datum, ...extra] = items;
  if (!datum || extra.length > 0) {
    return fail("quote takes exactly one argument", span);
  }
  return Effect.succeed({ _tag: "Datum", datum, type: data, span });
};

const lambda: Form = ({ items, span }, k) =>
  Effect.gen(function* () {
    const [, list, body, ...extra] = items;
    if (list?._tag !== "List" || !body || extra.length > 0) {
      const message = "lambda takes a parameter list and one body";
      return yield* fail(message, span);
    }
    const params: string[] = [];
    for (const param of list.items) {
      if (param._tag !== "Sym") {
        const message = "a parameter must be a symbol";
        return yield* fail(message, param.span);
      }
      if (params.includes(param.name)) {
        const message = `${param.name} is already a parameter`;
        return yield* fail(message, param.span);
      }
      params.push(param.name);
    }
    const schemes = params.map(() => ({ vars: [], type: k.fresh() }));
    return yield* k.lambda(params, schemes, (k) => k.elaborate(body), span);
  });

const let_: Form = ({ items, span }, k) => {
  const [, bindings, body, ...extra] = items;
  if (bindings?._tag !== "List" || !body || extra.length > 0) {
    return fail("let takes a binding list and one body", span);
  }
  return bind(bindings.items, body, span, k);
};

const bind = (
  bindings: ReadonlyArray<Sexp>,
  body: Sexp,
  span: Span,
  k: Kernel,
): Elab =>
  Effect.gen(function* () {
    const [first, ...more] = bindings;
    if (!first) return yield* k.elaborate(body);
    const [name, value, ...extra] =
      first._tag === "List" ? first.items : [];
    if (name?._tag !== "Sym" || !value || extra.length > 0) {
      return yield* fail("a binding is (name value)", first.span);
    }
    const bound = yield* k.elaborate(value);
    const scheme = k.generalize(bound.type);
    const inside = (k: Kernel) => bind(more, body, span, k);
    const fn = yield* now(k, [name.name], [scheme], inside, span);
    return yield* k.apply(fn, [bound], span);
  });

const branch = (
  k: Kernel,
  test: Core,
  yes: Inside,
  no: Inside,
  span: Span,
): Elab =>
  Effect.gen(function* () {
    const yesFn = yield* now(k, [], [], yes, span);
    const noFn = yield* now(k, [], [], no, span);
    const picked = yield* call(k, "choose", [test, yesFn, noFn], span);
    return yield* k.apply(picked, [], span);
  });

const if_: Form = ({ items, span }, k) =>
  Effect.gen(function* () {
    const [, test, yes, no, ...extra] = items;
    if (!test || !yes || !no || extra.length > 0) {
      return yield* fail("if takes a test and two branches", span);
    }
    const checked = yield* k.check(test, num);
    const type = k.fresh();
    return yield* branch(
      k,
      checked,
      (k) => k.check(yes, type),
      (k) => k.check(no, type),
      span,
    );
  });

// #region do
// Run `first` for what it does, then `next`. It's the same core as
// ((lambda (#do) next) first), and no program can name #do.
const then = (k: Kernel, first: Core, next: Inside, span: Span) => {
  const scheme = { vars: [], type: first.type };
  const fn = now(k, ["#do"], [scheme], next, span);
  return Effect.flatMap(fn, (fn) => k.apply(fn, [first], span));
};

// (do a b ... z) runs each in order. Its value is z's.
const do_: Form = ({ items: [, ...exprs], span }, k) =>
  exprs.length === 0
    ? fail("do needs at least one expression", span)
    : steps(exprs, k, span);

const steps = (
  exprs: ReadonlyArray<Sexp>,
  k: Kernel,
  span: Span,
): Elab =>
  Effect.gen(function* () {
    const [first, ...rest] = exprs;
    const value = yield* k.elaborate(first!);
    if (rest.length === 0) return value;
    return yield* then(k, value, (k) => steps(rest, k, span), span);
  });
// #endregion do

// #region when
// (when test body) runs body unless test is 0. Either way its value
// is unit, the empty list, of type Unit.
const nothing = (span: Span): Core => {
  const datum = { _tag: "List", items: [], span } as const;
  return { _tag: "Datum", datum, type: unit, span };
};

const when: Form = ({ items, span }, k) =>
  Effect.gen(function* () {
    const [, test, body, ...extra] = items;
    if (!test || !body || extra.length > 0) {
      return yield* fail("when takes a test and a body", span);
    }
    const checked = yield* k.check(test, num);
    const done = () => Effect.succeed(nothing(span));
    return yield* branch(
      k,
      checked,
      (k) =>
        Effect.flatMap(k.elaborate(body), (value) =>
          then(k, value, done, span),
        ),
      done,
      span,
    );
  });
// #endregion when

// #region delaying
// (catch body fallback) and (race a b) pass their parts to a
// prelude function as functions with no parameters. The prelude
// function decides when each part runs, and whether it runs at all.
const delaying =
  (name: string, usage: string): Form =>
  ({ items: [, ...parts], span }, k) =>
    Effect.gen(function* () {
      if (parts.length !== 2) return yield* fail(usage, span);
      const thunks: Core[] = [];
      for (const part of parts) {
        const inside = (k: Kernel) => k.elaborate(part);
        thunks.push(yield* k.lambda([], [], inside, part.span));
      }
      return yield* call(k, name, thunks, span);
    });
// #endregion delaying

// #region values
// Every function's effects are open: {Output | 'e} means it prints,
// and its caller may also be doing anything else.
const a: Type = { _tag: "TVar", id: 0 };
const e: Type = { _tag: "TVar", id: 1 };
const does = (...labels: string[]) => row(labels, e);
const thunk = (effects: Type) => fun([], a, effects);

const types = new Map<string, Type>([
  ["+", fun([], num, does(), num)],
  ["*", fun([], num, does(), num)],
  ["/", fun([], num, does("DivByZero"), num)],
  ["<", fun([num, num], num, does())],
  ["print", fun([a], a, does("Output"))],
  ["sleep", fun([num], unit, does("Async"))],
  ["choose", fun([num, a, a], a, does())],
  // Handling DivByZero takes it out of the row.
  ["recover", fun([thunk(row(["DivByZero"], e)), thunk(e)], a, e)],
  ["fastest", fun([thunk(e), thunk(e)], a, does("Async"))],
]);
// #endregion values

// #region runtime
// Call a function with no parameters, from inside a primitive.
const force = (f: Value | undefined) =>
  typeof f === "object" && f._tag === "Closure"
    ? execute(f.body, { slots: [], parent: f.env })
  : typeof f === "object" && f._tag === "Primitive" ? f.apply([])
  : Effect.die(new Error("ill-typed core: not a function"));

const nil: Value = {
  _tag: "List",
  items: [],
  span: { start: 0, end: 0 },
};

const added = new Map<string, Primitive["apply"]>([
  ["<", ([x, y]) =>
    Effect.succeed(Number(x?.value) < Number(y?.value) ? 1 : 0)],
  ["choose", ([test, yes, no]) =>
    Effect.succeed((test?.value === 0 ? no : yes)!.value)],
  ["sleep", ([ms]) =>
    Effect.as(Effect.sleep(Number(ms?.value)), nil)],
  // A typed error, caught by tag.
  ["recover", ([tried, caught]) =>
    Effect.catchTag(force(tried?.value), "DivByZero", () =>
      force(caught?.value),
    )],
  // Run both at once. The first to succeed wins, and the other
  // is interrupted.
  ["fastest", ([x, y]) =>
    Effect.race(force(x?.value), force(y?.value))],
]);
// #endregion runtime

const implementation = (name: string): Value => {
  const apply = added.get(name);
  return apply ? { _tag: "Primitive", name, apply } : globals.get(name)!;
};

const scheme = (type: Type): Scheme => ({ vars: [0, 1], type });

export const standard: Prelude = {
  forms: new Map([
    ["quote", quote],
    ["lambda", lambda],
    ["let", let_],
    ["if", if_],
    ["do", do_],
    ["when", when],
    ["catch", delaying("recover", "catch takes a body and a fallback")],
    ["race", delaying("fastest", "race takes two expressions")],
  ]),
  values: new Map(
    [...types].map(([name, type]) => [
      name,
      { scheme: scheme(type), value: implementation(name) },
    ]),
  ),
};

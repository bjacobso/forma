import { Effect } from "effect";
import type { Sexp, Span } from "../02/sexp.ts";
import { data, fun, num, type Type } from "../05/types.ts";
import type { Core } from "../06/core.ts";
import { globals, type Value } from "../06/execute.ts";
import {
  type Elab,
  fail,
  type Form,
  type Kernel,
  type Prelude,
  type Scheme,
} from "./kernel.ts";

// #region call
// Call a prelude function from inside a form.
export const call = (
  k: Kernel,
  name: string,
  args: Core[],
  span: Span,
): Elab =>
  Effect.flatMap(k.prelude(name, span), (fn) =>
    k.apply(fn, args, span),
  );
// #endregion call

// #region quote
// Part 4's parser handled quote and lambda. Now they're forms.
const quote: Form = ({ items, span }) => {
  const [, datum, ...extra] = items;
  if (!datum || extra.length > 0) {
    return fail("quote takes exactly one argument", span);
  }
  return Effect.succeed({ _tag: "Datum", datum, type: data, span });
};
// #endregion quote

// #region lambda
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
    // Parameters get one type each: a scheme with no variables.
    const types = params.map(() => k.fresh());
    const schemes = types.map((type) => ({ vars: [], type }));
    const inner = yield* k.within(params, schemes, (k) =>
      k.elaborate(body),
    );
    const type = fun(types, inner.type);
    return { _tag: "Lambda", params, body: inner, type, span };
  });
// #endregion lambda

// #region let
// (let ((name value) ...) body). Each value is elaborated, then its
// type is generalized before the next binding or the body sees it.
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
    const params = [name.name];
    const rest = yield* k.within(params, [scheme], (k) =>
      bind(more, body, span, k),
    );
    // The same core as ((lambda (name) rest) value).
    const fn: Core = {
      _tag: "Lambda",
      params,
      body: rest,
      type: fun([bound.type], rest.type),
      span,
    };
    const { type } = rest;
    return { _tag: "Call", fn, args: [bound], type, span };
  });
// #endregion let

// #region branch
// Core has no conditional, and doesn't need one. choose picks one
// of two functions with no parameters, and calling it runs only
// that branch: ((choose test (lambda () yes) (lambda () no))).
type Inside = (k: Kernel) => Elab;

export const branch = (
  k: Kernel,
  test: Core,
  yes: Inside,
  no: Inside,
  span: Span,
): Elab =>
  Effect.gen(function* () {
    const thunk = (inside: Inside) =>
      Effect.map(k.within([], [], inside), (body): Core => {
        const type = fun([], body.type);
        return { _tag: "Lambda", params: [], body, type, span };
      });
    const args = [test, yield* thunk(yes), yield* thunk(no)];
    const picked = yield* call(k, "choose", args, span);
    return yield* k.apply(picked, [], span);
  });
// #endregion branch

// #region if
// (if test yes no): the test is a number, 0 meaning false, and the
// branches have one type between them.
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
// #endregion if

// #region match
// (match n (0 a) (1 b) (_ c)): compare a number with literal cases,
// in order. The last case must be _, so every number has an answer.
interface Case {
  readonly pattern: Sexp;
  readonly result: Sexp;
}

const match: Form = ({ items, span }, k) =>
  Effect.gen(function* () {
    const [, subject, ...rest] = items;
    if (!subject) return yield* fail("match needs a subject", span);
    const cases: Case[] = [];
    for (const c of rest) {
      const [pattern, result, ...extra] =
        c._tag === "List" ? c.items : [];
      const wild = pattern?._tag === "Sym" && pattern.name === "_";
      const literal = pattern?._tag === "Num";
      if (!result || extra.length > 0 || !(wild || literal)) {
        const message = "a case is (number result) or (_ result)";
        return yield* fail(message, c.span);
      }
      if (cases.at(-1)?.pattern._tag === "Sym") {
        return yield* fail("nothing can follow the _ case", c.span);
      }
      cases.push({ pattern, result });
    }
    if (cases.at(-1)?.pattern._tag !== "Sym") {
      const message = "match needs a last (_ result) case";
      return yield* fail(message, span);
    }
    // Bind the subject once, to a name no program can write.
    const value = yield* k.check(subject, num);
    const type = k.fresh();
    const name: Sexp = { _tag: "Sym", name: "#match", span };
    const scheme = { vars: [], type: num };
    const body = yield* k.within(["#match"], [scheme], (k) =>
      compare(cases, name, type, k),
    );
    const fn: Core = {
      _tag: "Lambda",
      params: ["#match"],
      body,
      type: fun([num], body.type),
      span,
    };
    return yield* k.apply(fn, [value], span);
  });

// One case at a time: a branch on (= subject pattern), with the
// remaining cases in the "no" branch.
const compare = (
  cases: ReadonlyArray<Case>,
  name: Sexp,
  type: Type,
  k: Kernel,
): Elab =>
  Effect.gen(function* () {
    const { pattern, result } = cases[0]!;
    if (pattern._tag === "Sym") return yield* k.check(result, type);
    const { span } = pattern;
    const subject = yield* k.elaborate(name);
    const literal = yield* k.elaborate(pattern);
    const test = yield* call(k, "=", [subject, literal], span);
    return yield* branch(
      k,
      test,
      (k) => k.check(result, type),
      (k) => compare(cases.slice(1), name, type, k),
      span,
    );
  });
// #endregion match

// #region values
// The values every program starts with. Part 6's built-ins keep
// their implementations; the prelude adds -, =, <, and choose.
const a: Type = { _tag: "TVar", id: 0 };
const mono = (type: Type) => ({ vars: [], type });
const poly = (type: Type) => ({ vars: [0], type });

const value = (name: string, scheme: Scheme, value: Value) =>
  [name, { scheme, value }] as const;
const builtin = (name: string, scheme: Scheme) =>
  value(name, scheme, globals.get(name)!);

// A new primitive on two numbers. The checker already proved that
// both arguments are numbers.
type Binary = (x: number, y: number) => number;
const binary = (name: string, f: Binary) =>
  value(name, mono(fun([num, num], num)), {
    _tag: "Primitive",
    name,
    apply: ([x, y]) =>
      Effect.succeed(f(Number(x?.value), Number(y?.value))),
  });

export const arithmetic = new Map([
  builtin("+", mono(fun([], num, num))),
  builtin("*", mono(fun([], num, num))),
  builtin("/", mono(fun([], num, num))),
  binary("-", (x, y) => x - y),
]);

export const standard: Prelude = {
  forms: new Map([
    ["quote", quote],
    ["lambda", lambda],
    ["let", let_],
    ["if", if_],
    ["match", match],
  ]),
  values: new Map([
    ...arithmetic,
    builtin("pi", mono(num)),
    builtin("print", poly(fun([a], a))),
    binary("=", (x, y) => (x === y ? 1 : 0)),
    binary("<", (x, y) => (x < y ? 1 : 0)),
    // choose: (Num, 'a, 'a) -> 'a returns one of its arguments.
    value("choose", poly(fun([num, a, a], a)), {
      _tag: "Primitive",
      name: "choose",
      apply: ([test, yes, no]) =>
        Effect.succeed((test?.value === 0 ? no : yes)!.value),
    }),
  ]),
};
// #endregion values

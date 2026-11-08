import { Effect, Schema } from "effect";
import type { Diagnostic } from "../02/read.ts";
import type { Sexp, Span } from "../02/sexp.ts";
import { makeSolver, paramsFor } from "../05/check.ts";
import {
  ArityError,
  type CheckError,
  Mismatch,
  UnboundName,
} from "../05/errors.ts";
import { fun, num, showType, Type } from "../05/types.ts";
import type { Core } from "../06/core.ts";
import type { Env, Value } from "../06/execute.ts";

// #region scheme
// A type scheme is a type plus the variables in it that each use
// may choose afresh. The identity function's scheme has vars [0]
// and type ('a) -> 'a, where 'a is variable 0.
export const Scheme = Schema.Struct({
  vars: Schema.Array(Schema.Number),
  type: Type,
});
export type Scheme = typeof Scheme.Type;
// #endregion scheme

export type Elab = Effect.Effect<Core, CheckError | Diagnostic>;
export type List = Extract<Sexp, { _tag: "List" }>;

export const fail = (message: string, span: Span) =>
  Effect.fail<Diagnostic>({ message, span });

// #region form
// A form gets the whole list it heads, and a kernel for the frame
// it appears in. It returns core, or a diagnostic about its syntax.
export type Form = (form: List, k: Kernel) => Elab;

export interface Kernel {
  // Elaborate a part of the form, or check it has a type.
  readonly elaborate: (x: Sexp) => Elab;
  readonly check: (x: Sexp, type: Type) => Elab;
  // Run `inside` in a new frame that binds `names`.
  readonly within: <A, E>(
    names: ReadonlyArray<string>,
    schemes: ReadonlyArray<Scheme>,
    inside: (k: Kernel) => Effect.Effect<A, E>,
  ) => Effect.Effect<A, E>;
  // A name from the prelude, even where a local shadows it.
  readonly prelude: (name: string, span: Span) => Elab;
  // The kernel's rule for calls, and two tools for typing rules.
  readonly apply: (fn: Core, args: Core[], span: Span) => Elab;
  readonly fresh: () => Type;
  readonly generalize: (type: Type) => Scheme;
}
// #endregion form

// #region prelude
// A language is a prelude: its forms, and the values its programs
// start with, each with a type scheme.
export interface Prelude {
  readonly forms: ReadonlyMap<string, Form>;
  readonly values: ReadonlyMap<string, PreludeValue>;
}
export interface PreludeValue {
  readonly scheme: Scheme;
  readonly value: Value;
}

// The prelude's values are the outermost frame of every program.
export const rootEnv = (prelude: Prelude): Env => ({
  slots: [...prelude.values.values()].map((v) => v.value),
  parent: undefined,
});
// #endregion prelude

interface Frame {
  readonly names: ReadonlyArray<string>;
  readonly schemes: ReadonlyArray<Scheme>;
  readonly parent: Frame | undefined;
}

export const elaborate = (prelude: Prelude, program: Sexp): Elab =>
  Effect.gen(function* () {
    const { fresh, resolve, unify } = makeSolver();
    const root: Frame = {
      names: [...prelude.values.keys()],
      schemes: [...prelude.values.values()].map((v) => v.scheme),
      parent: undefined,
    };

    // #region generalize
    // The unknowns in a type, except the scheme's own variables.
    // Own variables are skipped before anything is resolved: a
    // prelude's variable 0 is not this run's variable 0.
    const unknowns = (t: Type, own: ReadonlyArray<number>) => {
      const found = new Set<number>();
      const walk = (t: Type, own: ReadonlyArray<number>): void => {
        if (t._tag === "TFun") {
          const inner = [...t.params, t.result];
          if (t.rest) inner.push(t.rest);
          return inner.forEach((i) => walk(i, own));
        }
        if (t._tag !== "TVar" || own.includes(t.id)) return;
        const r = resolve(t);
        // A solved variable's answer uses only this run's numbers.
        if (r._tag === "TVar") found.add(r.id);
        else walk(r, []);
      };
      walk(t, own);
      return found;
    };

    // Every unknown in `type` that no enclosing name mentions can
    // be chosen afresh at each use.
    const generalize = (type: Type, frame: Frame): Scheme => {
      const outside = new Set<number>();
      for (let f: Frame | undefined = frame; f; f = f.parent) {
        for (const { vars, type } of f.schemes) {
          unknowns(type, vars).forEach((v) => outside.add(v));
        }
      }
      const free = [...unknowns(type, [])];
      const vars = free.filter((v) => !outside.has(v));
      return { vars, type: resolve(type) };
    };

    // A use gets fresh copies of the scheme's variables.
    const instantiate = ({ vars, type }: Scheme): Type => {
      const copies = new Map(vars.map((v) => [v, fresh()]));
      const copy = (t: Type): Type =>
        t._tag === "TVar" ? (copies.get(t.id) ?? t)
        : t._tag !== "TFun" ? t
        : fun(
            t.params.map(copy),
            copy(t.result),
            t.rest && copy(t.rest),
          );
      // Copy first: a prelude's own variable numbers mean nothing
      // to this run's solver.
      return resolve(copy(type));
    };
    // #endregion generalize

    // #region kernel
    // Numbers, names, and calls. Everything else is a form.
    const go = (x: Sexp, frame: Frame): Elab =>
      Effect.gen(function* () {
        const { span } = x;
        if (x._tag === "Num") {
          return { _tag: "Lit", value: x.value, type: num, span };
        }
        if (x._tag === "Sym") {
          return yield* ref(x.name, span, frame);
        }
        const [head, ...rest] = x.items;
        if (!head) {
          return yield* fail("() is not an expression", span);
        }
        // A form's name means the form, unless a local shadows it.
        if (head._tag === "Sym" && !bound(head.name, frame)) {
          const form = prelude.forms.get(head.name);
          if (form) return yield* form(x, kernel(frame));
        }
        const fn = yield* go(head, frame);
        const args: Core[] = [];
        for (const arg of rest) args.push(yield* go(arg, frame));
        return yield* apply(fn, args, span);
      });

    const kernel = (frame: Frame): Kernel => ({
      elaborate: (x) => go(x, frame),
      check: (x, type) =>
        Effect.tap(go(x, frame), (c) =>
          unify(type, c.type, x.span),
        ),
      within: (names, schemes, inside) =>
        inside(kernel({ names, schemes, parent: frame })),
      prelude: (name, span) => {
        let depth = 0;
        for (let f = frame.parent; f; f = f.parent) depth++;
        return ref(name, span, root, depth);
      },
      apply,
      fresh,
      generalize: (type) => generalize(type, frame),
    });
    // #endregion kernel

    const bound = (name: string, frame: Frame | undefined) => {
      for (let f = frame; f; f = f.parent) {
        if (f.names.includes(name)) return true;
      }
      return false;
    };

    // Part 6's lookup: a name becomes a position in the frames.
    const ref = (
      name: string,
      span: Span,
      frame: Frame,
      start = 0,
    ): Elab => {
      let depth = start;
      for (let f: Frame | undefined = frame; f; f = f.parent) {
        const slot = f.names.indexOf(name);
        if (slot !== -1) {
          const type = instantiate(f.schemes[slot]!);
          const local = { _tag: "Local", name, depth, slot } as const;
          return Effect.succeed({ ...local, type, span });
        }
        depth++;
      }
      if (prelude.forms.has(name)) {
        return fail(`${name} is a form, so it can only be called`, span);
      }
      return Effect.fail(new UnboundName({ symbol: name, span }));
    };

    // Part 6's rule for calls, unchanged.
    const apply = (fn: Core, args: Core[], span: Span): Elab =>
      Effect.gen(function* () {
        const f = resolve(fn.type);
        if (f._tag === "TVar") {
          const type = fresh();
          const types = args.map((arg) => arg.type);
          yield* unify(f, fun(types, type), fn.span);
          return { _tag: "Call", fn, args, type, span };
        }
        if (f._tag !== "TFun") {
          const expected = "a function";
          const got = showType(f);
          const { span } = fn;
          return yield* new Mismatch({ expected, got, span });
        }
        const params = paramsFor(f, args.length);
        if (!params) {
          const expected = f.params.length;
          const got = args.length;
          return yield* new ArityError({ expected, got, span });
        }
        for (const [i, arg] of args.entries()) {
          yield* unify(params[i]!, arg.type, arg.span);
        }
        return { _tag: "Call", fn, args, type: f.result, span };
      });

    const settle = (c: Core): Core => {
      const type = resolve(c.type);
      switch (c._tag) {
        case "Lambda":
          return { ...c, type, body: settle(c.body) };
        case "Call": {
          const args = c.args.map(settle);
          return { ...c, type, fn: settle(c.fn), args };
        }
        default:
          return { ...c, type };
      }
    };

    return settle(yield* go(program, root));
  });

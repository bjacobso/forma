import { Effect, Schema } from "effect";
import type { Diagnostic } from "../02/read.ts";
import type { Sexp, Span } from "../02/sexp.ts";
import { ArityError, Mismatch, UnboundName } from "../05/errors.ts";
import * as Part5 from "../05/types.ts";
import type { Core as Core6, Datum, Global, Lit, Local } from "../06/core.ts";
import type { Env, Value } from "../06/execute.ts";
import { type CheckError, makeSolver, paramsFor } from "./solver.ts";
import { children, fun, num, row, showType, Type } from "./types.ts";

// Part 8's schemes and core, with this post's types in them.
export const Scheme = Schema.Struct({
  vars: Schema.Array(Schema.Number),
  type: Type,
});
export type Scheme = typeof Scheme.Type;

type Retyped<N> = Omit<N, "type"> & { readonly type: Type };
export interface Lambda {
  readonly _tag: "Lambda";
  readonly params: ReadonlyArray<string>;
  readonly body: Core;
  readonly type: Type;
  readonly span: Span;
}
export interface Call {
  readonly _tag: "Call";
  readonly fn: Core;
  readonly args: ReadonlyArray<Core>;
  readonly type: Type;
  readonly span: Span;
}
export type Core =
  | Retyped<typeof Lit.Type>
  | Retyped<typeof Datum.Type>
  | Retyped<typeof Local.Type>
  | Retyped<typeof Global.Type>
  | Lambda
  | Call;

export type Elab = Effect.Effect<Core, CheckError | Diagnostic>;
export type List = Extract<Sexp, { _tag: "List" }>;

export const fail = (message: string, span: Span) =>
  Effect.fail<Diagnostic>({ message, span });

// #region form
export type Form = (form: List, k: Kernel) => Elab;

// Part 8's kernel, with two additions.
export interface Kernel {
  readonly elaborate: (x: Sexp) => Elab;
  readonly check: (x: Sexp, type: Type) => Elab;
  readonly within: <A, E>(
    names: ReadonlyArray<string>,
    schemes: ReadonlyArray<Scheme>,
    inside: (k: Kernel) => Effect.Effect<A, E>,
  ) => Effect.Effect<A, E>;
  // New: a function, whose body `inside` elaborates. The body runs
  // only when the function is called, so it has effects of its own.
  readonly lambda: (
    names: ReadonlyArray<string>,
    schemes: ReadonlyArray<Scheme>,
    inside: (k: Kernel) => Elab,
    span: Span,
  ) => Elab;
  readonly prelude: (name: string, span: Span) => Elab;
  readonly apply: (fn: Core, args: Core[], span: Span) => Elab;
  readonly fresh: () => Type;
  readonly generalize: (type: Type) => Scheme;
  // New: what the code here is allowed to do.
  readonly effects: Type;
}
// #endregion form

export interface Prelude {
  readonly forms: ReadonlyMap<string, Form>;
  readonly values: ReadonlyMap<string, PreludeValue>;
}
export interface PreludeValue {
  readonly scheme: Scheme;
  readonly value: Value;
}

export const rootEnv = (prelude: Prelude): Env => ({
  slots: [...prelude.values.values()].map((v) => v.value),
  parent: undefined,
});

// #region frame
// A frame also records what the code in it is allowed to do: the
// effects of the function whose body it is.
interface Frame {
  readonly names: ReadonlyArray<string>;
  readonly schemes: ReadonlyArray<Scheme>;
  readonly effects: Type;
  readonly parent: Frame | undefined;
}
// #endregion frame

export interface Compiled {
  readonly core: Core;
  readonly effects: Type;
}

export const elaborate = (
  prelude: Prelude,
  program: Sexp,
  allowed: ReadonlyArray<string> | null,
): Effect.Effect<Compiled, CheckError | Diagnostic> =>
  Effect.gen(function* () {
    const { fresh, resolve, unify } = makeSolver();
    // #region root
    // What the whole program may do: whatever it turns out to do,
    // or, when a host says which effects it allows, only those.
    const root: Frame = {
      names: [...prelude.values.keys()],
      schemes: [...prelude.values.values()].map((v) => v.scheme),
      effects: allowed ? row(allowed, null) : fresh(),
      parent: undefined,
    };
    // #endregion root

    // The unknowns in a type, except the scheme's own variables.
    const unknowns = (t: Type, own: ReadonlyArray<number>) => {
      const found = new Set<number>();
      const walk = (t: Type): void => {
        if (t._tag === "TVar" && own.includes(t.id)) return;
        const r = resolve(t);
        if (r._tag === "TVar") found.add(r.id);
        children(r).forEach(walk);
      };
      walk(t);
      return found;
    };

    // Part 8's rule, which now also keeps the unknowns in each
    // frame's effects: they belong to the code around the let.
    const generalize = (type: Type, frame: Frame): Scheme => {
      const outside = new Set<number>();
      const add = (v: number) => outside.add(v);
      for (let f: Frame | undefined = frame; f; f = f.parent) {
        for (const { vars, type } of f.schemes) {
          unknowns(type, vars).forEach(add);
        }
        unknowns(f.effects, []).forEach(add);
      }
      const free = [...unknowns(type, [])];
      const vars = free.filter((v) => !outside.has(v));
      return { vars, type: resolve(type) };
    };

    const instantiate = ({ vars, type }: Scheme): Type => {
      const copies = new Map(vars.map((v) => [v, fresh()]));
      const copy = (t: Type): Type => {
        switch (t._tag) {
          case "TVar":
            return copies.get(t.id) ?? t;
          case "TRow":
            return row(t.labels, t.tail && copy(t.tail));
          case "TFun": {
            const params = t.params.map(copy);
            const rest = t.rest && copy(t.rest);
            return fun(params, copy(t.result), copy(t.effects), rest);
          }
          default:
            return t;
        }
      };
      return resolve(copy(type));
    };

    const go = (x: Sexp, frame: Frame): Elab =>
      Effect.gen(function* () {
        const { span } = x;
        if (x._tag === "Num") {
          return { _tag: "Lit", value: x.value, type: num, span };
        }
        if (x._tag === "Sym") return yield* ref(x.name, span, frame);
        const [head, ...rest] = x.items;
        if (!head) return yield* fail("() is not an expression", span);
        if (head._tag === "Sym" && !bound(head.name, frame)) {
          const form = prelude.forms.get(head.name);
          if (form) return yield* form(x, kernel(frame));
        }
        const fn = yield* go(head, frame);
        const args: Core[] = [];
        for (const arg of rest) args.push(yield* go(arg, frame));
        return yield* apply(fn, args, span, frame);
      });

    // #region kernel
    const kernel = (frame: Frame): Kernel => ({
      elaborate: (x) => go(x, frame),
      check: (x, type) =>
        Effect.tap(go(x, frame), (c) =>
          unify(type, c.type, x.span),
        ),
      // Code in a new frame that runs right here, like a let's
      // body, may do what the code around it may do.
      within: (names, schemes, inside) => {
        const { effects } = frame;
        const inner = { names, schemes, effects, parent: frame };
        return inside(kernel(inner));
      },
      // A function's body runs later: it gets a fresh row of
      // effects, and that row becomes part of the function's type.
      lambda: (names, schemes, inside, span) =>
        Effect.gen(function* () {
          const effects = fresh();
          const inner = { names, schemes, effects, parent: frame };
          const body = yield* inside(kernel(inner));
          const params = schemes.map((s) => s.type);
          const type = fun(params, body.type, effects);
          const lambda = { _tag: "Lambda", params: names } as const;
          return { ...lambda, body, type, span };
        }),
      prelude: (name, span) => {
        let depth = 0;
        for (let f = frame.parent; f; f = f.parent) depth++;
        return ref(name, span, root, depth);
      },
      apply: (fn, args, span) => apply(fn, args, span, frame),
      fresh,
      generalize: (type) => generalize(type, frame),
      effects: frame.effects,
    });
    // #endregion kernel

    const bound = (name: string, frame: Frame | undefined) => {
      for (let f = frame; f; f = f.parent) {
        if (f.names.includes(name)) return true;
      }
      return false;
    };

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

    // #region apply
    // Part 6's rule for calls, plus one step at the end: a call
    // does what the function's type says, and the frame it's in
    // must allow that.
    const apply = (
      fn: Core,
      args: Core[],
      span: Span,
      frame: Frame,
    ): Elab =>
      Effect.gen(function* () {
        const f = resolve(fn.type);
        if (f._tag === "TVar") {
          const type = fresh();
          const types = args.map((arg) => arg.type);
          const called = fun(types, type, frame.effects);
          yield* unify(f, called, fn.span);
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
        yield* unify(f.effects, frame.effects, span);
        return { _tag: "Call", fn, args, type: f.result, span };
      });
    // #endregion apply

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

    const core = settle(yield* go(program, root));
    return { core, effects: resolve(root.effects) };
  });

// #region erase
// The executor never reads a type, so once checking is done the
// effects can go. What's left is Part 6's core. Unit becomes Data:
// at runtime, unit is the empty list.
const eraseType = (t: Type): Part5.Type => {
  switch (t._tag) {
    case "TFun": {
      const params = t.params.map(eraseType);
      const rest = t.rest && eraseType(t.rest);
      return Part5.fun(params, eraseType(t.result), rest);
    }
    case "TUnit":
    case "TRow":
      return Part5.data;
    default:
      return t;
  }
};

export const erase = (c: Core): Core6 => {
  const type = eraseType(c.type);
  switch (c._tag) {
    case "Lambda":
      return { ...c, type, body: erase(c.body) };
    case "Call": {
      const args = c.args.map(erase);
      return { ...c, type, fn: erase(c.fn), args };
    }
    default:
      return { ...c, type };
  }
};
// #endregion erase

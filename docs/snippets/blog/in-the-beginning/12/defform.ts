import { Effect, Result, Schema } from "effect";
import type { Diagnostic } from "../02/read.ts";
import { Sexp, show, type Span } from "../02/sexp.ts";
import {
  type Core,
  elaborate,
  fail,
  type Form,
  type Kernel,
  type Prelude,
} from "../09/kernel.ts";
import { now } from "../09/prelude.ts";
import { data, num } from "../09/types.ts";
import type { FormDoc } from "../10/describe.ts";

// #region declared
// A form declared in the language: its name, its slots, a summary,
// and a template. A slot is a Name (a bare symbol, like acme) or an
// expression of type Num or Data.
export const Slot = Schema.Struct({
  name: Schema.String,
  kind: Schema.Literals(["Name", "Num", "Data"]),
});
export type Slot = typeof Slot.Type;

export const Declared = Schema.Struct({
  name: Schema.String,
  slots: Schema.Array(Slot),
  summary: Schema.String,
  body: Sexp,
});
export type Declared = typeof Declared.Type;
// #endregion declared

type List = Extract<Sexp, { _tag: "List" }>;
const kinds = ["Name", "Num", "Data"] as const;
const headName = (x: Sexp | undefined) =>
  x?._tag === "List" && x.items[0]?._tag === "Sym"
    ? x.items[0].name
    : undefined;

// #region declare
// (defform (name (slot Kind) ...) (doc word ...) `template)
// The reader has no strings, so a doc is a list of words.
export const declare = (form: Sexp) =>
  Effect.gen(function* () {
    const usage =
      "expected (defform (name slot ...) (doc ...) `body)";
    const [keyword, head, doc, template, ...extra] =
      form._tag === "List" ? form.items : [];
    if (
      keyword?._tag !== "Sym" || keyword.name !== "defform" ||
      head?._tag !== "List" || headName(doc) !== "doc" ||
      headName(template) !== "quasiquote" || extra.length > 0
    ) {
      return yield* fail(usage, form.span);
    }
    const [name, ...rest] = head.items;
    if (name?._tag !== "Sym") {
      const message = "a form's name must be a symbol";
      return yield* fail(message, head.span);
    }
    const slots: Slot[] = [];
    for (const item of rest) {
      const [slot, kind, ...more] =
        item._tag === "List" ? item.items : [];
      const known = kinds.find(
        (k) => kind?._tag === "Sym" && kind.name === k,
      );
      if (slot?._tag !== "Sym" || !known || more.length > 0) {
        const message = "a slot is (name Name), (name Num), or "
          + "(name Data)";
        return yield* fail(message, item.span);
      }
      slots.push({ name: slot.name, kind: known });
    }
    const body = (template as List).items[1]!;
    yield* holes(body, slots);
    const words = (doc as List).items.slice(1).map(show);
    const summary = words.join(" ");
    return { name: name.name, slots, summary, body } as Declared;
  });

// Every hole is ,slot for one of the form's slots.
const holes = (
  x: Sexp,
  slots: ReadonlyArray<Slot>,
): Effect.Effect<void, Diagnostic> => {
  if (x._tag !== "List") return Effect.void;
  if (headName(x) === "unquote") {
    const [, slot, ...extra] = x.items;
    const known = slots.some(
      (s) => slot?._tag === "Sym" && s.name === slot.name,
    );
    return known && extra.length === 0
      ? Effect.void
      : fail("a hole is , and the name of a slot", x.span);
  }
  const name = headName(x);
  if (name === "unquote-splicing" || name === "quasiquote") {
    const message = `${name} isn't allowed in a form's template`;
    return fail(message, x.span);
  }
  return Effect.forEach(x.items, (i) => holes(i, slots), {
    discard: true,
  });
};
// #endregion declare

// #region fill
// Fill each hole with value(slot, hole). With `at`, every node the
// template contributes takes that span instead of its own, so
// errors inside it point at the call that used the form.
const fill = (
  x: Sexp,
  slots: ReadonlyArray<Slot>,
  value: (slot: Slot, hole: Sexp) => Sexp,
  at?: Span,
): Sexp => {
  const span = at ?? x.span;
  if (x._tag !== "List") return { ...x, span };
  if (headName(x) === "unquote") {
    const name = (x.items[1] as { name: string }).name;
    return value(slots.find((s) => s.name === name)!, x);
  }
  const items = x.items.map((i) => fill(i, slots, value, at));
  return { ...x, items, span };
};
// #endregion fill

const quoted = (x: Sexp): Sexp => ({
  _tag: "List",
  items: [{ _tag: "Sym", name: "quote", span: x.span }, x],
  span: x.span,
});

// #region verify
// Check a declared form once, when it's loaded. Its holes are
// filled with stand-ins of their kinds, so a mistake in the
// template is reported in the template, to the form's author.
export const verify = (prelude: Prelude, d: Declared) => {
  const standIn = ({ name, kind }: Slot, { span }: Sexp): Sexp =>
    kind === "Num" ? { _tag: "Num", value: 0, span }
    : kind === "Name" ? { _tag: "Sym", name, span }
    : quoted({ _tag: "Sym", name, span });
  const body = fill(d.body, d.slots, standIn);
  return Effect.asVoid(elaborate(prelude, body, null));
};
// #endregion verify

// #region form
// A declared form, as a Part 8 form. The call is checked against
// the declaration first, so its errors point at the call: the
// wrong number of parts, a slot that isn't a name, or an argument
// of the wrong type.
export const toForm = (d: Declared): Form => (call, k) =>
  Effect.gen(function* () {
    const args = call.items.slice(1);
    if (args.length !== d.slots.length) {
      const names = d.slots.map((s) => s.name);
      const message = `${d.name} takes ${listed(names)}`;
      return yield* fail(message, call.span);
    }
    const filled = new Map<string, Sexp>();
    const params: string[] = [];
    const values: Core[] = [];
    for (const [i, slot] of d.slots.entries()) {
      const arg = args[i]!;
      if (slot.kind === "Name") {
        if (arg._tag !== "Sym") {
          const message = `${d.name}'s ${slot.name} must be a name`;
          return yield* fail(message, arg.span);
        }
        filled.set(slot.name, arg);
        continue;
      }
      // Bind the value once, to a name no program can write.
      const type = slot.kind === "Num" ? num : data;
      values.push(yield* k.check(arg, type));
      params.push(`#${slot.name}`);
      const name = `#${slot.name}`;
      filled.set(slot.name, { _tag: "Sym", name, span: arg.span });
    }
    yield* unshadowed(d, k, call.span);
    const value = (s: Slot) => filled.get(s.name)!;
    const body = fill(d.body, d.slots, value, call.span);
    const schemes = values.map((v) => ({ vars: [], type: v.type }));
    const inside = (k: Kernel) => k.elaborate(body);
    const fn = yield* now(k, params, schemes, inside, call.span);
    return yield* k.apply(fn, values, call.span);
  });

const listed = (names: ReadonlyArray<string>) =>
  names.length < 2 ? names.join("")
  : `${names.slice(0, -1).join(", ")}, and ${names.at(-1)}`;
// #endregion form

// #region hygiene
// The names a template uses mean what they mean in the prelude. If
// a local at the call hides one, the call is refused instead of
// quietly meaning something else.
const unshadowed = (d: Declared, k: Kernel, span: Span) =>
  Effect.gen(function* () {
    for (const name of free(d.body)) {
      const sym = { _tag: "Sym", name, span } as const;
      const here = yield* Effect.result(k.elaborate(sym));
      // A form's name that no local hides: not usable as a value.
      if (Result.isFailure(here)) continue;
      const there = yield* Effect.result(k.prelude(name, span));
      const a = here.success;
      const b = Result.isSuccess(there) ? there.success : undefined;
      const same = a._tag === "Local" && b?._tag === "Local" &&
        a.depth === b.depth && a.slot === b.slot;
      if (!same) {
        const used = `the ${name} ${d.name} uses`;
        return yield* fail(`a local ${name} hides ${used}`, span);
      }
    }
  });

// The symbols a template refers to: not quoted, not holes, and not
// bound by a lambda inside the template.
const free = (body: Sexp) => {
  const found = new Set<string>();
  const walk = (x: Sexp, bound: ReadonlySet<string>): void => {
    if (x._tag === "Sym" && !bound.has(x.name)) found.add(x.name);
    if (x._tag !== "List") return;
    const name = headName(x);
    if (name === "quote" || name === "unquote") return;
    const params = x.items[1];
    if (name === "lambda" && params?._tag === "List") {
      const inner = new Set(bound);
      for (const p of params.items) {
        if (p._tag === "Sym") inner.add(p.name);
      }
      return x.items.slice(2).forEach((i) => walk(i, inner));
    }
    x.items.forEach((i) => walk(i, bound));
  };
  walk(body, new Set());
  return found;
};
// #endregion hygiene

// #region doc
// Part 10's description of a form, read off the declaration.
export const toDoc = (d: Declared): FormDoc => {
  const slots = d.slots.map((s) => `(${s.name} ${s.kind})`);
  return {
    syntax: `(${[d.name, ...slots].join(" ")})`,
    summary: d.summary,
    head: 1,
    examples: [],
  };
};
// #endregion doc

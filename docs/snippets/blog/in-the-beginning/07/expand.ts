import { Effect } from "effect";
import type { Diagnostic } from "../02/read.ts";
import type { Sexp, Span } from "../02/sexp.ts";
import type { Macro } from "./macro.ts";

type Sym = Extract<Sexp, { _tag: "Sym" }>;
type Bindings = Map<string, Sexp>;
type Mark = (s: Sym) => Sym;
type Build = Effect.Effect<Sexp, Diagnostic>;

const fail = (message: string, span: Span) =>
  Effect.fail<Diagnostic>({ message, span });

// A symbol's name without the expander's mark: x#3 -> x.
const base = (name: string) => name.split("#")[0]!;
const headName = (x: Sexp) =>
  x._tag === "List" && x.items[0]?._tag === "Sym"
    ? base(x.items[0].name)
    : undefined;

// #region match
// Match a pattern against a call's arguments. A symbol binds
// whatever is there, a list matches a list item by item, and
// `&rest name` binds all the remaining items as one list.
const match = (p: Sexp, form: Sexp, bound: Bindings): boolean => {
  if (p._tag === "Sym") {
    bound.set(p.name, form);
    return true;
  }
  if (p._tag === "Num") {
    return form._tag === "Num" && form.value === p.value;
  }
  if (form._tag !== "List") return false;
  for (const [i, item] of p.items.entries()) {
    if (item._tag === "Sym" && item.name === "&rest") {
      const rest = p.items[i + 1] as Sym;
      const items = form.items.slice(i);
      const { span } = form;
      bound.set(rest.name, { _tag: "List", items, span });
      return true;
    }
    const arg = form.items[i];
    if (!arg || !match(item, arg, bound)) return false;
  }
  return form.items.length === p.items.length;
};
// #endregion match

// #region template
// A template is a pattern variable or a quasiquote. Inside the
// quasiquote everything is copied, except that ,e inserts e and
// ,@e splices it. Each symbol the template copies gets a mark.
const build = (t: Sexp, bound: Bindings, mark: Mark): Build =>
  Effect.gen(function* () {
    if (t._tag === "Sym") {
      const value = bound.get(t.name);
      if (value) return value;
      const message = `${t.name} is not a pattern variable`;
      return yield* fail(message, t.span);
    }
    if (t._tag === "List" && headName(t) === "quasiquote") {
      return yield* copy(t.items[1]!, bound, mark);
    }
    const message = "a template is a pattern variable or `";
    return yield* fail(message, t.span);
  });

const copy = (t: Sexp, bound: Bindings, mark: Mark): Build =>
  Effect.gen(function* () {
    if (t._tag === "Num") return t;
    if (t._tag === "Sym") return mark(t);
    if (headName(t) === "unquote") {
      return yield* build(t.items[1]!, bound, mark);
    }
    const items: Sexp[] = [];
    for (const item of t.items) {
      if (headName(item) !== "unquote-splicing") {
        items.push(yield* copy(item, bound, mark));
        continue;
      }
      const list = yield* build(spliced(item), bound, mark);
      if (list._tag !== "List") {
        return yield* fail(",@ needs a list", item.span);
      }
      items.push(...list.items);
    }
    return { _tag: "List", items, span: t.span };
  });

const spliced = (item: Sexp) =>
  (item as Extract<Sexp, { _tag: "List" }>).items[1]!;
// #endregion template

// #region expand
// Expand macro calls, outside in, until none are left. A macro's
// output is expanded again, so a macro can expand into itself.
const limit = 1000;

export const expandWith =
  (hygienic: boolean) =>
  (macros: ReadonlyMap<string, Macro>, form: Sexp): Build => {
    let expansions = 0;

    const go = (x: Sexp, depth: number): Build =>
      Effect.gen(function* () {
        if (x._tag !== "List") return x;
        const name = headName(x);
        // Quoted data is data, and parameter lists aren't calls.
        if (name === "quote") return x;
        const macro = name ? macros.get(name) : undefined;
        if (!macro) {
          const keep = x.items.slice(0, name === "lambda" ? 2 : 0);
          const rest = x.items.slice(keep.length);
          const each = (i: Sexp) => go(i, depth);
          const items = yield* Effect.forEach(rest, each);
          return { ...x, items: [...keep, ...items] };
        }
        if (depth >= limit) {
          const message = `${macro.name} expands forever`;
          return yield* fail(message, x.span);
        }
        const id = ++expansions;
        const mark: Mark = (s) =>
          hygienic ? { ...s, name: `${s.name}#${id}` } : s;
        const items = x.items.slice(1);
        const call = { _tag: "List", items, span: x.span } as const;
        for (const { pattern, template } of macro.clauses) {
          const bound: Bindings = new Map();
          if (!match(pattern, call, bound)) continue;
          const expansion = yield* build(template, bound, mark);
          return yield* go(expansion, depth + 1);
        }
        const message = `no pattern of ${macro.name} matches`;
        return yield* fail(`${message} this call`, x.span);
      });

    return Effect.map(go(form, 0), (x) => rename(x, new Set()));
  };
// #endregion expand

// #region rename
// After expansion, a marked symbol bound by a marked parameter
// keeps its unique name, so it can't capture the user's names.
// Every other mark is dropped: those symbols mean what they say.
const rename = (x: Sexp, bound: ReadonlySet<string>): Sexp => {
  if (x._tag === "Num") return x;
  if (x._tag === "Sym") {
    return bound.has(x.name) ? x : { ...x, name: base(x.name) };
  }
  const name = headName(x);
  if (name === "quote") return strip(x);
  const params = x.items[1];
  if (name !== "lambda" || params?._tag !== "List") {
    return { ...x, items: x.items.map((i) => rename(i, bound)) };
  }
  const inner = new Set(bound);
  for (const p of params.items) {
    if (p._tag === "Sym") inner.add(p.name);
  }
  return { ...x, items: x.items.map((i) => rename(i, inner)) };
};

// Quoted data has no bindings: drop every mark.
const strip = (x: Sexp): Sexp =>
  x._tag === "Num" ? x
  : x._tag === "Sym" ? { ...x, name: base(x.name) }
  : { ...x, items: x.items.map(strip) };
// #endregion rename

export const expand = expandWith(true);

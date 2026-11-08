import { Effect, Schema } from "effect";
import type { Diagnostic } from "../02/read.ts";
import { Sexp, type Span } from "../02/sexp.ts";

// #region macro
// A macro is data too: a name and a list of clauses. Each clause
// is a pattern for a call's arguments and a template for its
// expansion.
export const Clause = Schema.Struct({
  pattern: Sexp,
  template: Sexp,
});
export const Macro = Schema.Struct({
  name: Schema.String,
  clauses: Schema.Array(Clause),
});
export type Macro = typeof Macro.Type;
// #endregion macro

const fail = (message: string, span: Span) =>
  Effect.fail<Diagnostic>({ message, span });

type List = Extract<Sexp, { _tag: "List" }>;
const isDefmacro = (form: Sexp): form is List =>
  form._tag === "List" &&
  form.items[0]?._tag === "Sym" &&
  form.items[0].name === "defmacro";

// &rest must be followed by exactly one symbol, at the end of a list.
const checkPattern = (p: Sexp): Effect.Effect<void, Diagnostic> =>
  Effect.gen(function* () {
    if (p._tag !== "List") return;
    for (const [i, item] of p.items.entries()) {
      if (item._tag === "Sym" && item.name === "&rest") {
        const rest = p.items[i + 1];
        if (rest?._tag !== "Sym" || i + 2 !== p.items.length) {
          const message = "&rest must be followed by one last symbol";
          return yield* fail(message, item.span);
        }
      }
      yield* checkPattern(item);
    }
  });

// #region define
// (defmacro name (pattern template) ...)
const define = (form: List): Effect.Effect<Macro, Diagnostic> =>
  Effect.gen(function* () {
    const [, name, ...clauses] = form.items;
    if (name?._tag !== "Sym" || clauses.length === 0) {
      const message = "defmacro needs a name and a clause";
      return yield* fail(message, form.span);
    }
    if (name.name === "lambda" || name.name === "quote") {
      const message = `${name.name} can't be redefined`;
      return yield* fail(message, name.span);
    }
    const parsed = [];
    for (const clause of clauses) {
      const [pattern, template, ...extra] =
        clause._tag === "List" ? clause.items : [];
      if (pattern?._tag !== "List" || !template || extra.length) {
        const message = "a clause is (pattern template)";
        return yield* fail(message, clause.span);
      }
      yield* checkPattern(pattern);
      parsed.push({ pattern, template });
    }
    return { name: name.name, clauses: parsed };
  });
// #endregion define

// #region program
// A program is macro definitions followed by one expression.
export const program = (forms: ReadonlyArray<Sexp>) =>
  Effect.gen(function* () {
    const macros = new Map<string, Macro>();
    let body: Sexp | undefined;
    for (const form of forms) {
      if (body) {
        const message = "a program ends with one expression";
        return yield* fail(message, form.span);
      }
      if (!isDefmacro(form)) body = form;
      else {
        const macro = yield* define(form);
        macros.set(macro.name, macro);
      }
    }
    if (!body) {
      return yield* fail("a program needs an expression", {
        start: 0,
        end: 0,
      });
    }
    return { macros, body };
  });
// #endregion program

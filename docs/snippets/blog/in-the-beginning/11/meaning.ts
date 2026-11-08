import { Effect, Schema } from "effect";
import type { Sexp, Span } from "../02/sexp.ts";
import { Core } from "../06/core.ts";
import { readAll } from "../07/read.ts";
import { type Core as Core9, erase, type Prelude } from "../09/kernel.ts";
import { compile } from "../09/run.ts";

// #region meaning
// What a program means, without what it's called. Core already
// turned every name into a position, so dropping names and spans
// leaves only meaning: two programs that differ only in their
// names have equal meanings.
const nowhere: Span = { start: 0, end: 0 };
const data = (x: Sexp): Sexp =>
  x._tag === "List"
    ? { ...x, items: x.items.map(data), span: nowhere }
    : { ...x, span: nowhere };

const anonymous = (c: Core): Core => {
  switch (c._tag) {
    case "Datum":
      return { ...c, datum: data(c.datum), span: nowhere };
    case "Local":
      return { ...c, name: "", span: nowhere };
    case "Lambda": {
      const params = c.params.map(() => "");
      const body = anonymous(c.body);
      return { ...c, params, body, span: nowhere };
    }
    case "Call": {
      const fn = anonymous(c.fn);
      const args = c.args.map(anonymous);
      return { ...c, fn, args, span: nowhere };
    }
    default:
      return { ...c, span: nowhere };
  }
};

// Schema derives structural equality for core.
const equal = Schema.toEquivalence(Core);
export const sameMeaning = (a: Core9, b: Core9) =>
  equal(anonymous(erase(a)), anonymous(erase(b)));
// #endregion meaning

// #region occurrences
// Every symbol named `name` that the program could be referring to:
// not inside quoted data, and not inside a macro definition.
export const occurrences = (source: string, name: string) =>
  Effect.map(readAll(source), (forms) => {
    const found: Span[] = [];
    const walk = (x: Sexp): void => {
      if (x._tag === "Sym" && x.name === name) found.push(x.span);
      if (x._tag !== "List") return;
      const head = x.items[0];
      const skip = head?._tag === "Sym" &&
        (head.name === "quote" || head.name === "defmacro");
      if (!skip) x.items.forEach(walk);
    };
    forms.forEach(walk);
    return found;
  });
// #endregion occurrences

// Replace each span with `text`, from the end so offsets hold.
export const splice = (
  source: string,
  spans: ReadonlyArray<Span>,
  text: string,
) =>
  [...spans]
    .sort((a, b) => b.start - a.start)
    .reduce(
      (s, { start, end }) => s.slice(0, start) + text + s.slice(end),
      source,
    );

export const check = (prelude: Prelude, source: string) =>
  Effect.map(compile(prelude, source), ({ core }) => core);

import { Effect } from "effect";
import type { Diagnostic } from "../02/read.ts";
import type { Sexp, Span } from "../02/sexp.ts";

// #region shorthand
// Four prefixes, each short for a two-element list.
const prefixes = new Map([
  ["'", "quote"],
  ["`", "quasiquote"],
  [",", "unquote"],
  [",@", "unquote-splicing"],
]);
// #endregion shorthand

type Read = Effect.Effect<Sexp, Diagnostic>;
const fail = (message: string, span: Span) =>
  Effect.fail<Diagnostic>({ message, span });

// Part 2's reader, extended with the prefixes, reading every form in
// the source instead of exactly one.
export const readAll = (
  source: string,
): Effect.Effect<Sexp[], Diagnostic> => {
  const pattern = /,@|[()'`,]|[^\s()'`,]+/g;
  const tokens = [...source.matchAll(pattern)].map((m) => {
    const span = { start: m.index, end: m.index + m[0].length };
    return { text: m[0], span };
  });
  let position = 0;

  const next = (): Read =>
    Effect.gen(function* () {
      const token = tokens[position++];
      if (!token) {
        const end = { start: source.length, end: source.length };
        return yield* fail("unexpected end of input", end);
      }
      const { text, span } = token;
      // #region prefix
      const name = prefixes.get(text);
      if (name) {
        // 'x reads as (quote x), `x as (quasiquote x), and so on.
        const datum = yield* next();
        const head = { _tag: "Sym", name, span } as const;
        const whole = { start: span.start, end: datum.span.end };
        return { _tag: "List", items: [head, datum], span: whole };
      }
      // #endregion prefix
      if (text === ")") return yield* fail("unexpected )", span);
      if (text === "(") {
        const items: Sexp[] = [];
        while (tokens[position]?.text !== ")") {
          if (position >= tokens.length) {
            return yield* fail("this ( is never closed", span);
          }
          items.push(yield* next());
        }
        const { end } = tokens[position++]!.span;
        const list = { start: span.start, end };
        return { _tag: "List", items, span: list } as const;
      }
      if (text.includes("#")) {
        return yield* fail("# is reserved for the expander", span);
      }
      return /^-?\d+(\.\d+)?$/.test(text)
        ? ({ _tag: "Num", value: Number(text), span } as const)
        : ({ _tag: "Sym", name: text, span } as const);
    });

  return Effect.gen(function* () {
    position = 0;
    const forms: Sexp[] = [];
    while (position < tokens.length) forms.push(yield* next());
    return forms;
  });
};

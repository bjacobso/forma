import { Effect, Schema } from "effect";
import { type Sexp, Span } from "./sexp.ts";

// #region diagnostic
// A diagnostic is data too: a message and the source it is about.
export const Diagnostic = Schema.Struct({
  message: Schema.String,
  span: Span,
});
export type Diagnostic = typeof Diagnostic.Type;
// #endregion diagnostic

// #region read
type Read = Effect.Effect<Sexp, Diagnostic>;
const fail = (message: string, span: Span) =>
  Effect.fail<Diagnostic>({ message, span });

export const read = (source: string): Read => {
  const tokens = [...source.matchAll(/[()]|[^\s()]+/g)].map((m) => {
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
      return /^-?\d+(\.\d+)?$/.test(text)
        ? ({ _tag: "Num", value: Number(text), span } as const)
        : ({ _tag: "Sym", name: text, span } as const);
    });

  return Effect.gen(function* () {
    const program = yield* next();
    const extra = tokens[position];
    if (extra) {
      return yield* fail(`unexpected ${extra.text}`, extra.span);
    }
    return program;
  });
};
// #endregion read

// #region render
// Point at the source a diagnostic is about.
export const render = (source: string, diagnostic: Diagnostic) => {
  const { start, end } = diagnostic.span;
  const lineStart = source.lastIndexOf("\n", start - 1) + 1;
  const newline = source.indexOf("\n", start);
  const lineEnd = newline === -1 ? source.length : newline;
  const lines = source.slice(0, lineStart).split("\n");
  const number = String(lines.length);
  const width = Math.max(1, Math.min(end, lineEnd) - start);
  const gutter = " ".repeat(number.length);
  const caret = " ".repeat(start - lineStart) + "^".repeat(width);
  return [
    `error: ${diagnostic.message}`,
    `${number} | ${source.slice(lineStart, lineEnd)}`,
    `${gutter} | ${caret}`,
  ].join("\n");
};
// #endregion render

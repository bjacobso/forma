import { Effect } from "effect";
import type { Sexp } from "../02/sexp.ts";
import { readAll } from "../07/read.ts";
import type { Docs } from "./describe.ts";

type List = Extract<Sexp, { _tag: "List" }>;

// #region flat
// The reader's shorthand, in reverse: (quote x) prints as 'x.
const marks = new Map([
  ["quote", "'"],
  ["quasiquote", "`"],
  ["unquote", ","],
  ["unquote-splicing", ",@"],
]);

const markOf = (x: List) => {
  const [head, datum, ...extra] = x.items;
  const mark = head?._tag === "Sym" && marks.get(head.name);
  return mark && datum && extra.length === 0
    ? { mark, datum }
    : undefined;
};

// One line, however long.
const flat = (x: Sexp): string => {
  if (x._tag === "Num") return String(x.value);
  if (x._tag === "Sym") return x.name;
  const marked = markOf(x);
  if (marked) return marked.mark + flat(marked.datum);
  return `(${x.items.map(flat).join(" ")})`;
};
// #endregion flat

// #region layout
// Lay out x starting at `column`. A list that doesn't fit is split:
// a form keeps its first `head` parts on the first line and indents
// the rest by 2, a call lines its arguments up under the first one,
// and any other list puts each item on its own line.
export const layout = (docs: Docs, width: number) => {
  const go = (x: Sexp, column: number): string => {
    const line = flat(x);
    if (x._tag !== "List" || column + line.length <= width) {
      return line;
    }
    const marked = markOf(x);
    if (marked) {
      const { mark, datum } = marked;
      return mark + go(datum, column + mark.length);
    }
    const [head, ...rest] = x.items;
    if (head?._tag !== "Sym") return lines(x.items, column + 1);
    const form = docs[head.name];
    const kept = form ? form.head : 1;
    const first = [head, ...rest.slice(0, kept)];
    const text = sameLine(first, column);
    const more = rest.slice(kept);
    if (more.length === 0) return `${text})`;
    const indent = column + (form ? 2 : head.name.length + 2);
    return `${text}\n${pad(indent)}${lines(more, indent).slice(1)}`;
  };

  // "(" at `column`, then items one after another on its line. A
  // long item may still split.
  const sameLine = (items: ReadonlyArray<Sexp>, column: number) => {
    let text = "(";
    for (const [i, item] of items.entries()) {
      if (i > 0) text += " ";
      text += go(item, column + lastLine(text));
    }
    return text;
  };

  // Items one per line, all starting at `column`.
  const lines = (items: ReadonlyArray<Sexp>, column: number) => {
    const laid = items.map((item) => go(item, column));
    return `(${laid.join(`\n${pad(column)}`)})`;
  };

  return go;
};

const pad = (n: number) => " ".repeat(n);
const lastLine = (text: string) =>
  text.length - text.lastIndexOf("\n") - 1;
// #endregion layout

// #region format
// Format a whole source file: every form, a blank line between.
// It needs only syntax, so it works on programs that don't check.
export const format = (source: string, docs: Docs, width = 60) =>
  Effect.map(readAll(source), (forms) =>
    forms.map((form) => layout(docs, width)(form, 0)).join("\n\n"),
  );
// #endregion format

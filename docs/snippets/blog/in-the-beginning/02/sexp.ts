import { Schema } from "effect";

// #region sexp
// Every node remembers where it came from: offsets into the source.
export const Span = Schema.Struct({
  start: Schema.Number,
  end: Schema.Number,
});
export type Span = typeof Span.Type;

export const Num = Schema.TaggedStruct("Num", {
  value: Schema.Number,
  span: Span,
});
export const Sym = Schema.TaggedStruct("Sym", {
  name: Schema.String,
  span: Span,
});

// A list holds more s-expressions, so its schema refers to itself.
export interface List {
  readonly _tag: "List";
  readonly items: ReadonlyArray<Sexp>;
  readonly span: Span;
}
export type Sexp = typeof Num.Type | typeof Sym.Type | List;

const LazySexp = Schema.suspend((): Schema.Codec<Sexp> => Sexp);
export const List = Schema.TaggedStruct("List", {
  items: Schema.Array(LazySexp),
  span: Span,
});
export const Sexp = Schema.Union([Num, Sym, List]);
// #endregion sexp

// #region show
export const show = (x: Sexp): string =>
  x._tag === "Num" ? String(x.value)
  : x._tag === "Sym" ? x.name
  : `(${x.items.map(show).join(" ")})`;
// #endregion show

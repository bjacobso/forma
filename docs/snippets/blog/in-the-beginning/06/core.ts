import { Schema } from "effect";
import { Sexp, show, Span } from "../02/sexp.ts";
import { showType, Type } from "../05/types.ts";

// #region core
// The core language. Every node carries its settled type and its
// span, and every name is already resolved: a Local is a position
// in the frames around it, and a Global names a built-in.
export const Lit = Schema.TaggedStruct("Lit", {
  value: Schema.Number,
  type: Type,
  span: Span,
});
export const Datum = Schema.TaggedStruct("Datum", {
  datum: Sexp,
  type: Type,
  span: Span,
});
export const Local = Schema.TaggedStruct("Local", {
  name: Schema.String,
  depth: Schema.Number,
  slot: Schema.Number,
  type: Type,
  span: Span,
});
export const Global = Schema.TaggedStruct("Global", {
  name: Schema.String,
  type: Type,
  span: Span,
});

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
  | typeof Lit.Type
  | typeof Datum.Type
  | typeof Local.Type
  | typeof Global.Type
  | Lambda
  | Call;

const LazyCore = Schema.suspend((): Schema.Codec<Core> => Core);
export const Lambda = Schema.TaggedStruct("Lambda", {
  params: Schema.Array(Schema.String),
  body: LazyCore,
  type: Type,
  span: Span,
});
export const Call = Schema.TaggedStruct("Call", {
  fn: LazyCore,
  args: Schema.Array(LazyCore),
  type: Type,
  span: Span,
});
export const Core = Schema.Union([
  Lit,
  Datum,
  Local,
  Global,
  Lambda,
  Call,
]);
// #endregion core

// #region show
// Print core as an indented tree: one node per line, with its type.
export const showCore = (
  c: Core,
  names = new Map<number, string>(),
  indent = "",
): string => {
  const line = (label: string) =>
    `${indent}${label} : ${showType(c.type, names)}`;
  const child = (inner: Core) =>
    showCore(inner, names, indent + "  ");
  switch (c._tag) {
    case "Lit":
      return line(`lit ${c.value}`);
    case "Datum":
      return line(`datum ${show(c.datum)}`);
    case "Local":
      return line(`local ${c.name} @${c.depth}.${c.slot}`);
    case "Global":
      return line(`global ${c.name}`);
    case "Lambda":
      return [line(`lambda (${c.params.join(" ")})`), child(c.body)]
        .join("\n");
    case "Call":
      return [line("call"), child(c.fn), ...c.args.map(child)]
        .join("\n");
  }
};
// #endregion show

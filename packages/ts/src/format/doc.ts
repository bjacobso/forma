/** Small source-formatting document algebra. Text is always authored text. */
export type Doc =
  | { readonly kind: "text"; readonly value: string }
  | { readonly kind: "line"; readonly flat: string; readonly hard: boolean }
  | { readonly kind: "concat"; readonly parts: readonly Doc[] }
  | { readonly kind: "group" | "indent" | "lineSuffix"; readonly doc: Doc }
  | { readonly kind: "breakParent" };
export const text = (value: string): Doc => ({ kind: "text", value });
export const line: Doc = { kind: "line", flat: " ", hard: false };
export const softline: Doc = { kind: "line", flat: "", hard: false };
export const hardline: Doc = { kind: "line", flat: "", hard: true };
export const breakParent: Doc = { kind: "breakParent" };
export const concat = (...parts: readonly Doc[]): Doc => ({ kind: "concat", parts });
export const group = (doc: Doc): Doc => ({ kind: "group", doc });
export const indent = (doc: Doc): Doc => ({ kind: "indent", doc });
export const lineSuffix = (doc: Doc): Doc => ({ kind: "lineSuffix", doc });

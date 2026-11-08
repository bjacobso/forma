import { isSym, type Sexp, sym } from "./lisp.ts";

// #region inspect
// Inspect: which operators does a program use?
export const operators = (x: Sexp): Set<string> => {
  if (!Array.isArray(x)) return new Set();
  const [head, ...rest] = x;
  const found = new Set<string>();
  if (head !== undefined && isSym(head)) found.add(head.sym);
  for (const child of rest) {
    for (const name of operators(child)) found.add(name);
  }
  return found;
};
// #endregion inspect

// #region generate
// Generate: build (+ 1 2 ... n) without writing any text.
export const sumTo = (n: number): Sexp => [
  sym("+"),
  ...Array.from({ length: n }, (_, i) => i + 1),
];
// #endregion generate

// #region transform
// Transform: teach the language `square` by rewriting
// (square e) into (* e e) before evaluation runs.
export const expand = (x: Sexp): Sexp => {
  if (!Array.isArray(x)) return x;
  const [head, ...rest] = x;
  if (head && isSym(head) && head.sym === "square") {
    const arg = expand(rest[0]!);
    return [sym("*"), arg, arg];
  }
  return x.map(expand);
};
// #endregion transform

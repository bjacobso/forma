import { Effect, Result, Schema } from "effect";
import { type Sexp, Span } from "../02/sexp.ts";
import { readAll } from "../07/read.ts";
import type { Core, Prelude } from "../09/kernel.ts";
import { check, occurrences, sameMeaning, splice } from "./meaning.ts";

// #region refused
// A structured edit that would break the program says so, instead
// of making it.
export class Refused extends Schema.TaggedError<Refused>()(
  "Refused",
  { reason: Schema.String, span: Span },
) {
  override get message() {
    return this.reason;
  }
}
// #endregion refused

const same = (a: Span, b: Span) =>
  a.start === b.start && a.end === b.end;

// The symbol under the cursor, if there is one.
const symbolAt = (forms: ReadonlyArray<Sexp>, at: number) => {
  let found: Extract<Sexp, { _tag: "Sym" }> | undefined;
  const walk = (x: Sexp): void => {
    const { start, end } = x.span;
    if (at < start || at >= end) return;
    if (x._tag === "Sym") found = x;
    if (x._tag === "List") x.items.forEach(walk);
  };
  forms.forEach(walk);
  return found;
};

// #region references
// The references to `name` in core, grouped by what they refer to.
// A Local `depth` functions out refers to that function's
// parameter; past the outermost function, to the prelude.
const references = (core: Core, name: string) => {
  const groups = new Map<string, Span[]>();
  const walk = (c: Core, functions: Core[]): void => {
    if (c._tag === "Local" && c.name === name) {
      const fn = functions[functions.length - 1 - c.depth];
      const key = fn
        ? `${functions.indexOf(fn)}:${fn.span.start}:${c.slot}`
        : "prelude";
      groups.set(key, [...(groups.get(key) ?? []), c.span]);
    }
    if (c._tag === "Lambda") walk(c.body, [...functions, c]);
    if (c._tag === "Call") {
      [c.fn, ...c.args].forEach((inner) => walk(inner, functions));
    }
  };
  walk(core, []);
  return groups;
};
// #endregion references

// #region rename
// Rename the name under the cursor, and everything that refers to
// what it refers to. Which forms bind names is the prelude's
// business, so the binder is found by asking the checker: of the
// candidate edits, the right one is the one that leaves the
// meaning unchanged.
export const rename = (
  prelude: Prelude,
  source: string,
  at: number,
  to: string,
) =>
  Effect.gen(function* () {
    const target = symbolAt(yield* readAll(source), at);
    if (!target) {
      return yield* new Refused({
        reason: "there's no name here",
        span: { start: at, end: at + 1 },
      });
    }
    const { name, span } = target;
    const refuse = (reason: string) =>
      new Refused({ reason, span });
    const [read] = yield* readAll(to);
    if (read?._tag !== "Sym" || read.name !== to) {
      return yield* refuse(`${to} is not a name`);
    }
    const before = yield* check(prelude, source);
    const places = yield* occurrences(source, name);
    if (!places.some((p) => same(p, span))) {
      return yield* refuse(`this ${name} is data, not a name`);
    }
    const groups = references(before, name);
    if (groups.get("prelude")?.some((s) => same(s, span))) {
      return yield* refuse(`${name} belongs to the prelude`);
    }
    groups.delete("prelude");
    const used = [...groups.values()].flat();
    if (!used.every((u) => places.some((p) => same(p, u)))) {
      return yield* refuse(`${name} is used inside a macro`);
    }
    // The cursor is on a reference, so the binder is one of the
    // other occurrences; or it's on the binder, and the references
    // are one of the groups, or none.
    const mine = [...groups.values()].find((g) =>
      g.some((s) => same(s, span)),
    );
    const others = places.filter(
      (p) => !used.some((u) => same(p, u)),
    );
    const candidates = mine
      ? others.map((binder) => [...mine, binder])
      : [...[...groups.values()].map((g) => [...g, span]), [span]];
    for (const spans of candidates) {
      const after = splice(source, spans, to);
      const checked = yield* Effect.result(check(prelude, after));
      if (Result.isSuccess(checked)) {
        if (sameMeaning(before, checked.success)) return after;
      }
    }
    const change = "would change what the program means";
    return yield* refuse(`renaming ${name} to ${to} ${change}`);
  });
// #endregion rename

import { Effect, Schema } from "effect";
import { Span } from "../02/sexp.ts";
import type { Core, Prelude } from "../09/kernel.ts";
import { showType } from "../09/types.ts";

// #region finding
// What a tool reports: a diagnostic with a severity.
export const Finding = Schema.Struct({
  severity: Schema.Literals(["error", "warning"]),
  message: Schema.String,
  span: Span,
});
export type Finding = typeof Finding.Type;

// A checked program, as every analyzer sees it.
export interface Program {
  readonly prelude: Prelude;
  readonly core: Core;
}

// An analyzer can't fail. It reads a program and reports findings.
export type Analyzer = (
  program: Program,
) => Effect.Effect<ReadonlyArray<Finding>>;
// #endregion finding

// #region walk
// Every node in a core tree, with how many functions it's inside.
const nodes = (c: Core, level = 0): Array<[Core, number]> => [
  [c, level],
  ...(c._tag === "Lambda" ? nodes(c.body, level + 1)
    : c._tag === "Call"
      ? [c.fn, ...c.args].flatMap((inner) => nodes(inner, level))
      : []),
];

const warning = (message: string, span: Span): Finding => ({
  severity: "warning",
  message,
  span,
});
// #endregion walk

// #region unused
// A parameter nobody refers to. Names with # were made by a form,
// and those are allowed to go unused.
const uses = (c: Core, depth: number, slot: number): boolean =>
  c._tag === "Local" ? c.depth === depth && c.slot === slot
  : c._tag === "Lambda" ? uses(c.body, depth + 1, slot)
  : c._tag === "Call"
    ? [c.fn, ...c.args].some((inner) => uses(inner, depth, slot))
  : false;

export const unused: Analyzer = ({ core }) =>
  Effect.sync(() =>
    nodes(core).flatMap(([c]) =>
      c._tag !== "Lambda" ? [] : c.params.flatMap((name, slot) =>
        name.startsWith("#") || uses(c.body, 0, slot)
          ? []
          : [warning(`${name} is never used`, c.span)],
      ),
    ),
  );
// #endregion unused

// #region discarded
// (do a b): a's value is thrown away, so a only matters for what it
// does. Warn when it surely does nothing. A call is surely pure if
// it calls a prelude function whose declared row has no labels.
export const discarded: Analyzer = ({ prelude, core }) =>
  Effect.sync(() => {
    const declared = [...prelude.values.values()].map(
      ({ scheme: { type } }) =>
        type._tag === "TFun" && type.effects._tag === "TRow"
          ? type.effects.labels.length
          : 1,
    );
    // At `level` functions deep, the prelude is `level` frames out.
    const pure = (c: Core, level: number): boolean =>
      c._tag !== "Call" ? true
      : c.fn._tag === "Local" && c.fn.depth === level &&
        declared[c.fn.slot] === 0 &&
        c.args.every((arg) => pure(arg, level));
    return nodes(core).flatMap(([c, level]) => {
      if (c._tag !== "Call" || c.fn._tag !== "Lambda") return [];
      const [first] = c.args;
      if (c.fn.params[0] !== "#do" || !first) return [];
      if (!pure(first, level)) return [];
      const message = "this value is discarded, and computing it "
        + "does nothing";
      return [warning(message, first.span)];
    });
  });
// #endregion discarded

// #region analyze
// Analyzers are independent, so they run side by side, and adding
// one is adding it to the list.
export const analyzers: Analyzer[] = [unused, discarded];

export const analyze = (program: Program) =>
  Effect.map(
    Effect.forEach(analyzers, (a) => a(program), {
      concurrency: "unbounded",
    }),
    (found) => found.flat(),
  );
// #endregion analyze

// #region hover
// The type of the smallest expression around a position.
export const typeAt = (core: Core, offset: number) => {
  let best: Core | undefined;
  for (const [c] of nodes(core)) {
    const { start, end } = c.span;
    if (start > offset || offset >= end) continue;
    if (!best || end - start < best.span.end - best.span.start) {
      best = c;
    }
  }
  return best && showType(best.type);
};
// #endregion hover

import { Effect } from "effect";
import type { Sexp, Span } from "../02/sexp.ts";
import { readAll } from "../07/read.ts";
import type { Docs } from "../10/describe.ts";
import { format } from "../10/format.ts";
import { splice } from "./meaning.ts";
import { Refused } from "./rename.ts";

// #region replace
// Replace one expression with another. The span must be exactly an
// expression the reader found, and the replacement must read as
// exactly one expression, so the result always reads too. Then the
// whole file is formatted.
export const replace = (
  docs: Docs,
  source: string,
  span: Span,
  text: string,
) =>
  Effect.gen(function* () {
    const forms = yield* readAll(source);
    const nodes: Sexp[] = [];
    const walk = (x: Sexp): void => {
      nodes.push(x);
      if (x._tag === "List") x.items.forEach(walk);
    };
    forms.forEach(walk);
    const { start, end } = span;
    const exact = (n: Sexp) =>
      n.span.start === start && n.span.end === end;
    if (!nodes.some(exact)) {
      const reason = "no expression starts and ends there";
      return yield* new Refused({ reason, span });
    }
    const replacement = yield* readAll(text);
    if (replacement.length !== 1) {
      const reason = "the replacement must be one expression";
      return yield* new Refused({ reason, span });
    }
    return yield* format(splice(source, [span], text), docs);
  });
// #endregion replace

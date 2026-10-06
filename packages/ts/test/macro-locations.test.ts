import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import * as Engine from "../src/Engine.js";
import { analyzeLsp } from "../src/LSP.js";

const unless = "(macro (my-unless test & body)\n  `(if ~test nil (do ~@body)))\n";

const text = (source: string, span: { readonly start: number; readonly end: number } | undefined) =>
  span === undefined ? undefined : source.slice(span.start, span.end);

const typeError = (source: string) => {
  const result = Effect.runSync(analyzeLsp(source));
  expect(result.success).toBe(false);
  return text(source, result.errors[0]?.span);
};

describe("macro arguments keep their source locations", () => {
  it("reports a type error inside a macro argument where the author wrote it", () => {
    expect(typeError(`${unless}(my-unless false (+ 1 "x"))`)).toBe('(+ 1 "x")');
    expect(typeError(`(when true (+ 1 "x"))`)).toBe('(+ 1 "x")');
  });

  it("types the expressions inside a macro call at their own spans", () => {
    const source = `${unless}(define n 4)\n(my-unless (> n 10) (* n 2))`;
    const result = Effect.runSync(analyzeLsp(source));
    expect(result.success).toBe(true);
    const body = result.typedSpans.find((span) => text(source, span.span) === "(* n 2)");
    expect(body?.typeString).toBe("Int");
  });

  it("locates errors in nested prelude macros at the call the author wrote", () => {
    const filler = Array.from({ length: 40 }, (_, index) => `(define v${index} ${index})`).join("\n");
    const source = `${filler}\n(-> 1 (+ 2) (+ "x"))`;
    const result = Effect.runSync(analyzeLsp(source));
    const span = result.errors[0]?.span;
    expect(span).toBeDefined();
    // The rebuilt `(+ ... "x")` has no text of its own, so the error is on the call.
    expect(span!.start).toBeGreaterThanOrEqual(source.indexOf("(-> 1"));
    expect(span!.end).toBeLessThanOrEqual(source.length);
  });

  it("keeps a macro template's own errors on the call", () => {
    const source = '(macro (bad x) `(+ ~x "s"))\n(bad 1)';
    expect(typeError(source)).toBe("(bad 1)");
  });

  it("reports a runtime failure inside a macro argument where the author wrote it", async () => {
    const source = `${unless}(define n 4)\n(my-unless false (* 2 (+ n "x")))`;
    const result = await Engine.evaluate({ sourceId: "doc", source });
    const span = result.diagnostics[0]?.span;
    expect(source.slice(span?.startOffset, span?.endOffset)).toBe('(+ n "x")');
  });
});

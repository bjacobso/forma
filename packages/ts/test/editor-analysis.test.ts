import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { analyzeLsp } from "../src/LSP.js";

const analyze = (source: string) => {
  const result = Effect.runSync(analyzeLsp(source));
  const typeOf = (text: string) =>
    result.typedSpans.find((span) => source.slice(span.span.start, span.span.end) === text)
      ?.typeString;
  const errorTexts = result.errors.map((error) =>
    error.span === undefined ? undefined : source.slice(error.span.start, error.span.end),
  );
  return { result, typeOf, errorTexts };
};

describe("editor analysis around type errors", () => {
  it("reports every top-level form that does not type and types the rest", () => {
    const source = [
      "(define rate 0.08)",
      '(define a (+ 1 "x"))',
      "(define (total n) (* n (+ 1 rate)))",
      '(define b (+ 2 "y"))',
      "(total 100)",
    ].join("\n");
    const { result, typeOf, errorTexts } = analyze(source);
    expect(result.success).toBe(false);
    expect(errorTexts).toEqual(['(+ 1 "x")', '(+ 2 "y")']);
    expect(typeOf("(* n (+ 1 rate))")).toBe("Number");
    expect(typeOf("(total 100)")).toBe("Number");
    expect(result.resultType).toBeUndefined();
  });

  it("lets later forms use a name whose definition failed", () => {
    const source = '(define broken (+ 1 "x"))\n(define a [broken broken])\n(define b (+ broken 1))';
    const { errorTexts, typeOf } = analyze(source);
    expect(errorTexts).toEqual(['(+ 1 "x")']);
    expect(typeOf("(+ broken 1)")).toBe("Number");
  });

  it("resolves types recorded before inference learned them", () => {
    const { result, typeOf } = analyze("(define (twice f x) (f (f x)))\n(twice (fn [n] (* n 2)) 4)");
    expect(result.success).toBe(true);
    expect(typeOf("(fn [n] (* n 2))")).toBe("Number -> Number");
    expect(typeOf("n")).toBe("Number");
  });
});

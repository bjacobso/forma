import { describe, expect, test } from "vitest";

import { Engine, Evaluator, Syntax } from "../src/index.js";

const observe = async (source: string, options: Evaluator.ObservationOptions = {}) => {
  const result = await Engine.evaluate({ source, observe: options });
  const records = result.observations!.records;
  const at = (text: string, nth = 0) =>
    records.filter((record) => source.slice(record.span.start, record.span.end) === text)[nth];
  return { result, records, at };
};

const printed = (record: Engine.ExpressionObservation | undefined) =>
  record && record.count > 0 ? Evaluator.printKValue(record.value) : undefined;

describe("observed evaluation", () => {
  test("records the last value and count of every author expression", async () => {
    const { result, at } = await observe(
      "(define (double x) (* x 2))\n(double 3)\n(map double [1 2 3])",
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.printed).toBe("[2 4 6]");
    expect(at("(* x 2)")).toMatchObject({ count: 4 });
    expect(printed(at("(* x 2)"))).toBe("6");
    expect(printed(at("(double 3)"))).toBe("6");
    expect(at("[1 2 3]")).toMatchObject({ count: 1 });
    expect(printed(at("(map double [1 2 3])"))).toBe("[2 4 6]");
  });

  test("keys records by the identity the caller passes", async () => {
    const source = "(+ 1 2)";
    const identity = Syntax.identifySyntax(source, { idPrefix: "row-" });
    const { records } = await observe(source, { identity });
    expect(records.map((record) => record.nodeId)).toEqual(["row-1", "row-3", "row-4"]);
  });

  test("maps macro expansions back to the call and its arguments", async () => {
    const source = "(macro (twice x) `(do ~x ~x))\n(twice (+ 1 2))\n(cond (> 1 2) :a :else 7)";
    const { records, at } = await observe(source);
    expect(printed(at("(twice (+ 1 2))"))).toBe("3");
    expect(at("(+ 1 2)")).toMatchObject({ count: 2 });
    expect(printed(at("(cond (> 1 2) :a :else 7)"))).toBe("7");
    expect(printed(at("(> 1 2)"))).toBe("false");
    // Nothing is recorded for the macro definition's template, and every
    // record names an author-written node.
    const identity = Syntax.identifySyntax(source);
    const spans = new Set(identity.nodes.map((node) => `${node.span.start}:${node.span.end}`));
    for (const record of records) {
      expect(spans.has(`${record.span.start}:${record.span.end}`)).toBe(true);
      expect(record.span.start).toBeGreaterThan(source.indexOf("\n"));
    }
  });

  test("keeps calls of a macro that returns a template node apart", async () => {
    const source = "(macro (k ) `y)\n(let [y 1] (k))\n(let [y 2] (k))\n(macro (p n) `(+ ~n 100))\n(p 1)";
    const { records, at } = await observe(source);
    expect(at("(k)", 0)).toMatchObject({ count: 1 });
    expect(printed(at("(k)", 0))).toBe("1");
    expect(printed(at("(k)", 1))).toBe("2");
    expect(printed(at("(p 1)"))).toBe("101");
    // Nothing inside a macro definition gets a record.
    const definitions = [...source.matchAll(/\(define-macro[^\n]*/g)].map((match) => ({
      start: match.index,
      end: match.index + match[0].length,
    }));
    for (const record of records) {
      expect(definitions.some((span) => span.start <= record.span.start && record.span.end <= span.end)).toBe(false);
    }
  });

  test("attributes a failure to the expression that raised it and keeps earlier values", async () => {
    const source = '(define base 10)\n(define (bad x) (+ x "no"))\n(bad base)';
    const { result, at } = await observe(source);
    expect(result.diagnostics[0]?.message).toMatch(/expected number/);
    expect(at('(+ x "no")')).toMatchObject({
      count: 0,
      failure: { message: result.diagnostics[0]!.message },
    });
    expect(printed(at("10"))).toBe("10");
    expect(at("(bad base)")).toBeUndefined();
  });

  test("does not change the result, and only returns add steps", async () => {
    const source =
      "(define (count-down n acc) (if (= n 0) acc (count-down (- n 1) (+ acc 1))))\n(count-down 300 0)";
    const plain = await Engine.evaluate({ source, stepLimit: 1_000_000 });
    const observed = await Engine.evaluate({ source, stepLimit: 1_000_000, observe: {} });
    expect(observed.printed).toBe(plain.printed);
    expect(observed.printed).toBe("300");
    // Observed calls leave tail position, so each of the 300 recursive calls
    // returns through its caller once.
    expect(observed.steps).toBe(plain.steps! + 300);
  });

  test("bounds the number of records", async () => {
    const { result } = await observe("[1 2 3 4 5 6]", { maxRecords: 3 });
    expect(result.observations).toMatchObject({ truncated: true, maxRecords: 3 });
    expect(result.observations!.records).toHaveLength(3);
  });

  test("observes programs that run on the evaluator fallback", async () => {
    const { result, at } = await observe("(let [x 1] `(a ~(+ x 1)))");
    expect(result.diagnostics).toEqual([]);
    expect(printed(at("(+ x 1)"))).toBe("2");
  });

  test("returns no records for source that does not parse", async () => {
    const { result } = await observe("(+ 1");
    expect(result.diagnostics[0]?.phase).toBe("evaluate");
    expect(result.observations?.records).toEqual([]);
  });
});

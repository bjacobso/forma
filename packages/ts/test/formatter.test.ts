import { Effect } from "effect";
import { describe, expect, test } from "vitest";
import { formatLispSource } from "../src/Formatter.js";

const format = (source: string, softWrap = 36) =>
  Effect.runSync(formatLispSource(source, { softWrap }));

describe("core form layout", () => {
  test.each([
    ["(define greet [name] (str name name name))", "(define greet [name]\n  (str name name name))\n"],
    ["(macro (twice body) (list body body body))", "(macro (twice body)\n  (list body body body))\n"],
    ["(fn [value] (str value value value value))", "(fn [value]\n  (str value value value value))\n"],
    ["(type Person {:name String :active Bool})", "(type Person\n  {:name String :active Bool})\n"],
    ["(form (greet name) :types {:name String} :ir String name)", "(form (greet name)\n  :types {:name String}\n  :ir String\n  name)\n"],
  ])("keeps declaration headers: %s", (source, expected) => {
    expect(format(source)).toBe(expected);
    expect(format(expected)).toBe(expected);
  });

  test.each(["let", "loop", "do!"])("aligns %s binding names and values", head => {
    const source = `(${head} [x (first values) longer (last values)] (+ x longer))`;
    const indent = " ".repeat(head.length + 3);
    const expected = `(${head} [x      (first values)\n${indent}longer (last values)]\n  (+ x longer))\n`;
    expect(format(source)).toBe(expected);
    expect(format(expected)).toBe(expected);
  });

  test.each(["if", "when", "unless"])("keeps the %s test on the header", head => {
    const source = `(${head} (> value 0) (positive value) (negative value))`;
    const expected = `(${head} (> value 0)\n  (positive value)\n  (negative value))\n`;
    expect(format(source)).toBe(expected);
    expect(format(expected)).toBe(expected);
  });

  test.each(["cond", "match", "case"])("keeps %s branches in pairs", head => {
    const selector = head === "cond" ? "" : " value";
    const source = `(${head}${selector} :first "first result" :second "second result" :else "fallback")`;
    const expected = `(${head}${selector}\n  :first  "first result"\n  :second "second result"\n  :else   "fallback")\n`;
    expect(format(source)).toBe(expected);
    expect(format(expected)).toBe(expected);
  });

  test("a domain form component does not override descriptor declaration layout", () => {
    const source = "(form (form {:keys [title]} child ...) :types {:title String :child (List Syntax)} :ir ComponentIR child)";
    expect(format(source, 60)).toContain("(form (form {:keys [title]} child ...)\n");
  });

  test("wraps long headers and pair values without dropping syntax", () => {
    const source = "(define function-with-a-long-name [argument-with-a-long-name] (let [result (calculate argument-with-a-long-name argument-with-a-long-name)] (match result :ok (render result result result) _ nil)))";
    const formatted = format(source);
    expect(format(formatted)).toBe(formatted);
    // A wider rendering proves the same syntax survives all layout decisions.
    expect(format(formatted, 1000)).toBe(format(source, 1000));
  });
});

describe("reader shorthand", () => {
  test.each([
    ["(quote value)", "'value\n"],
    ["(quasiquote (if (unquote test) (do (unquote-splicing body)) nil))", "`(if ~test (do ~@body) nil)\n"],
    ["(unquote (get value :field))", "~(get value :field)\n"],
    ["(unquote-splicing values)", "~@values\n"],
  ])("renders %s with reader prefixes", (source, expected) => {
    expect(format(source)).toBe(expected);
    expect(format(expected)).toBe(expected);
  });

  test.each(["constructor", "toString", "__proto__"])("keeps ordinary unary calls to %s", head => {
    expect(format(`(${head} value)`)).toBe(`(${head} value)\n`);
  });

  test("retains nested quotation and comments when wrapped", () => {
    const source = "(quasiquote (let [(unquote name) (unquote value)] ; expansion\n(if (unquote name) (unquote name) (quasiquote (fallback (unquote name))))))";
    const formatted = format(source);
    expect(formatted).toContain("; expansion");
    expect(format(formatted)).toBe(formatted);
    expect(format(formatted, 1000)).toBe(format(source, 1000));
  });
});

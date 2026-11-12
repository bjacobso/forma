import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { defaultBuiltins } from "../src/Builtins.js";
import * as Evaluator from "../src/Evaluator.js";
import { expandProgramSync } from "../src/Expander.js";
import { parseManyToSExpr } from "../src/reader/index.js";
import { LanguageSession } from "../src/Session.js";
import { hashSourceText, makeSource } from "../src/Source.js";

const expand = (source: string) =>
  expandProgramSync(Effect.runSync(parseManyToSExpr(source)), { builtins: defaultBuiltins })
    .exprs.map(Evaluator.printSExpr)
    .join("\n");

const evaluate = (source: string) =>
  Effect.runSync(
    Evaluator.evaluate(source, { stepLimit: 10_000, builtins: defaultBuiltins }).pipe(
      Effect.provide(Evaluator.makePreludeLayer(defaultBuiltins)),
    ),
  ).value;

describe("gensym", () => {
  it("expands the same program to the same names however much ran before", () => {
    const source = "(and a b (or c d))";
    const first = expand(source);
    expand("(and x y z) (or x y z)");
    expect(expand(source)).toBe(first);
    expect([...new Set(first.match(/\b(?:and|or)__\d+\b/g))].sort()).toEqual([
      "and__1",
      "and__2",
      "or__3",
    ]);
  });

  it("numbers names per evaluation and keeps them distinct within one", () => {
    const program = "[(gensym) (gensym \"x\")]";
    const first = Evaluator.printKValue(evaluate(program));
    expect(Evaluator.printKValue(evaluate(program))).toBe(first);
    expect(first).toBe("[g__1 x__2]");
  });

  it("shares a counter between an evaluation and the macros it expands", () => {
    const value = Evaluator.printKValue(
      evaluate("(macro (pick) (quasiquote (quote (unquote (gensym))))) [(pick) (gensym)]"),
    );
    expect(value).toBe("[g__1 g__2]");
  });
});

describe("source identity", () => {
  it("hashes source text with SHA-256", () => {
    expect(hashSourceText("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(makeSource({ id: "a.lisp", text: "abc" }).hash).toBe(hashSourceText("abc"));
  });

  it("fingerprints preludes independently of load order and id separators", () => {
    const fingerprint = (preludes: readonly (readonly [string, string])[]) => {
      const session = new LanguageSession({ id: "s" });
      for (const [id, text] of preludes) session.rememberSource({ id, text, kind: "prelude" });
      return session.preludeFingerprint();
    };
    const a = ["a.lisp", "(define a 1)"] as const;
    const b = ["b.lisp", "(define b 2)"] as const;
    expect(fingerprint([a, b])).toBe(fingerprint([b, a]));
    expect(fingerprint([a, b])).toMatch(/^[a-f0-9]{64}$/);
    expect(fingerprint([["x", "1"]])).not.toBe(fingerprint([["x:1", ""]]));
  });
});

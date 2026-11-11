import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { typecheck } from "../src/Engine.js";
import { checkModuleGraph, resolveModuleGraph, sourceModuleResolver } from "../src/Modules.js";

const fixture = (name: string) => readFileSync(new URL(`../../../conformance/diagnostic-repairs/${name}.lisp`, import.meta.url), "utf8");

test.each([false, true])("unbound names offer a located repair (module: %s)", module => {
  const source = fixture("unbound");
  const entry = {id:"unbound.lisp", source};
  const result = module
    ? checkModuleGraph(resolveModuleGraph(entry, sourceModuleResolver([entry])))
    : typecheck({sourceId:entry.id, source});
  expect(result.diagnostics).toHaveLength(1);
  const diagnostic = result.diagnostics[0]!;
  expect(diagnostic.message).toContain("did you mean total?");
  expect(diagnostic.details?.candidates).toContain("total");
  expect((diagnostic.details?.candidates as string[]).length).toBeLessThanOrEqual(5);
  expect(diagnostic.fix).toEqual([{newText:"total",span:expect.objectContaining({sourceId:entry.id,startOffset:source.indexOf("totl"),endOffset:source.indexOf("totl")+4})}]);
});

test("equally close names offer candidates without an automatic edit", () => {
  const result = typecheck({sourceId:"ambiguous.lisp",source:"(define cat 1) (define bat 2) dat"});
  expect(result.diagnostics[0]?.details?.candidates).toEqual(["bat", "cat"]);
  expect(result.diagnostics[0]?.fix).toBeUndefined();
});

test("candidate lists are bounded and hide implementation names", () => {
  const source = ["total", "totals", "totalled", "totaling", "totally", "tot", "other", "__secret", "x__forma_abcd"].map(name => `(define ${name} 0)`).join(" ") + " totl";
  const diagnostic = typecheck({sourceId:"candidates.lisp",source}).diagnostics[0]!;
  expect(diagnostic.details?.candidates).toHaveLength(5);
  expect(diagnostic.details?.candidates).toEqual(expect.arrayContaining(["total"]));
  expect(JSON.stringify(diagnostic)).not.toMatch(/__secret|__forma_/);
});

test("a bound lambda's arity error names its binding", async () => {
  const { evaluate } = await import("../src/Engine.js");
  const result = await evaluate({sourceId:"arity.lisp",source:fixture("arity")});
  expect(result.diagnostics).toHaveLength(1);
  expect(result.diagnostics[0]).toMatchObject({code:"ArityError",message:expect.stringContaining("add expects 2 arguments, got 1")});
});

test("every evaluator error kind has a non-empty diagnostic message", async () => {
  const { evaluate } = await import("../src/Engine.js");
  const corpus = [fixture("arity"), '(+ 1 "oops")', '(fail "failed")', '(define loop [x] (loop x)) (loop 0)'];
  const codes = new Set<string>();
  for (const source of corpus) {
    const result = await evaluate({sourceId:"corpus.lisp",source,stepLimit:100});
    expect(result.diagnostics.length).toBeGreaterThan(0);
    for (const diagnostic of result.diagnostics) {
      codes.add(diagnostic.code);
      expect(diagnostic.message.trim()).not.toBe("");
      expect(diagnostic.message).not.toMatch(/__forma_[0-9a-f]+|\bt\d+\b/);
    }
  }
  expect(codes).toEqual(new Set(["ArityError", "KernelTypeError", "FailError", "StepLimitExceeded"]));
});

test("let-bound lambdas use the local name in arity diagnostics", async () => {
  const { evaluate } = await import("../src/Engine.js");
  const result = await evaluate({sourceId:"local.lisp", source:"(let [add (fn [a b] (+ a b))] (add 1))"});
  expect(result.diagnostics[0]?.message).toContain("add expects 2 arguments, got 1");
});

test("retired definitions do not cascade into unbound references", async () => {
  const { Effect } = await import("effect");
  const { analyzeLsp } = await import("../src/LSP.js");
  const result = Effect.runSync(analyzeLsp(fixture("retired")));
  expect(result.errors).toHaveLength(1);
  expect(result.errors[0]).toMatchObject({diagnosticCode:"surface/invalid-form", message:expect.stringContaining("Use define instead of defn")});
});

test("explicitly empty failure text still produces a message", async () => {
  const { evaluate } = await import("../src/Engine.js");
  expect((await evaluate({source:'(fail "")'})).diagnostics[0]?.message.trim()).not.toBe("");
});

test("the compile-time interpreter also names bound lambdas", async () => {
  const { Effect } = await import("effect");
  const { evaluateCompileTimeExprs } = await import("../src/Evaluator.js");
  const { parseManyToSExpr } = await import("../src/Reader.js");
  const { defaultBuiltins } = await import("../src/Builtins.js");
  const exprs = Effect.runSync(parseManyToSExpr(fixture("arity")));
  const result = Effect.runSync(Effect.result(evaluateCompileTimeExprs(exprs, {builtins:defaultBuiltins,stepLimit:100})));
  expect(result._tag).toBe("Failure");
  if (result._tag === "Failure") expect(result.failure.message).toBe("add expects 2 arguments, got 1");
});

test("session typechecking preserves unbound-symbol repair metadata", async () => {
  const { openSession } = await import("../src/Session.js");
  const session = openSession({id:"repairs"});
  const diagnostic = typecheck({session,sourceId:"session.lisp",source:fixture("unbound")}).diagnostics[0]!;
  expect(diagnostic.details?.candidates).toContain("total");
  expect(diagnostic.fix?.[0]).toMatchObject({newText:"total",span:{sourceId:"session.lisp"}});
});

test.each([
  [fixture('field-rename').trim(), ':totl', ':total'],
  ['(get {"total" 1} "totl")', '"totl"', '"total"'],
])("a unique nearby field has an atomic rename: %s", (source, before, after) => {
  const diagnostic = typecheck({sourceId:"field.lisp",source}).diagnostics[0]!;
  expect(diagnostic.fix).toEqual([{newText:after,span:expect.objectContaining({sourceId:"field.lisp",startOffset:source.lastIndexOf(before),endOffset:source.lastIndexOf(before)+before.length})}]);
  const edit = diagnostic.fix![0]!;
  expect(typecheck({source:source.slice(0,edit.span.startOffset)+edit.newText+source.slice(edit.span.endOffset)}).diagnostics).toEqual([]);
});

test("ambiguous field names have no automatic rename", () => {
  expect(typecheck({source:'(get {:cat 1 :bat 2} :dat)'}).diagnostics[0]?.fix).toBeUndefined();
});

test.each([['def','define'],['defn','define'],['lambda','fn']])("retired %s spelling has an exact head edit", (before, after) => {
  const source = before === 'lambda' ? '(lambda [x] x)' : `(${before} value 1)`;
  expect(typecheck({sourceId:"retired.lisp",source}).diagnostics[0]?.fix).toEqual([{newText:after,span:expect.objectContaining({sourceId:"retired.lisp",startOffset:1,endOffset:1+before.length})}]);
});

test("generated member access does not offer an edit over the whole expression", () => {
  expect(typecheck({source:'(define record {:total 1}) record.totl'}).diagnostics[0]?.fix).toBeUndefined();
});

test("a retired macro declaration needing a syntax rewrite has no head-only fix", () => {
  expect(typecheck({source:'(defmacro identity [x] x)'}).diagnostics[0]?.fix).toBeUndefined();
});

test("keyword and string fields with the same display name are ambiguous", () => {
  expect(typecheck({source:'(get {:total 1 "total" 2} :totl)'}).diagnostics[0]?.fix).toBeUndefined();
});

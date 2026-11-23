import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
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

/** Apply a fix's edits together, as an editor does. */
const applyFix = (source: string, fix: readonly {span:{startOffset:number;endOffset:number};newText:string}[]) =>
  [...fix].sort((a, b) => b.span.startOffset - a.span.startOffset)
    .reduce((text, edit) => text.slice(0, edit.span.startOffset) + edit.newText + text.slice(edit.span.endOffset), source);

test("a form shape error echoes the canonical shape and unwraps an options map", async () => {
  const { elaborateProgram } = await import("../src/Descriptor.js");
  const { bootstrapOntologyPreludes } = await import("../src/Preludes.js");
  const prelude = bootstrapOntologyPreludes();
  const source = '(entity User {:doc "A user"} {:name String})';
  const diagnostic = elaborateProgram(source, {prelude, sourceId:"shape.lisp"}).diagnostics[0]!;
  const shape = "(entity name fields [:doc doc] [:role role] [:id-pattern id-pattern] [:tier tier])";
  expect(diagnostic).toMatchObject({code:"elaborate/malformed-form", message:"Too many positional arguments", details:{form:"entity", expected:shape}});
  expect(diagnostic.help).toContain(`entity has the shape ${shape}`);
  // The options move after the positional fields, as keywords.
  const repaired = applyFix(source, diagnostic.fix!);
  expect(repaired).toBe('(entity User {:name String} :doc "A user")');
  expect(elaborateProgram(repaired, {prelude}).diagnostics).toEqual([]);
  // Without an options map there is no edit, only the shape.
  const missing = elaborateProgram("(entity User)", {prelude}).diagnostics[0]!;
  expect(missing).toMatchObject({message:"Missing positional argument fields", help:`entity has the shape ${shape}`});
  expect(missing.fix).toBeUndefined();
});

test("a layer written as a map of methods is rewritten to :provides and define", async () => {
  const { elaborateEffectProgram } = await import("../src/mechanics/elaborate.js");
  const service = "(service Users (: find (-> String (Effect String))))\n";
  const source = service + "(layer UsersLive Users {:find (fn [id] (succeed id))})";
  const diagnostic = elaborateEffectProgram(source, {sourceId:"layer.lisp"}).diagnostics[0]!;
  expect(diagnostic).toMatchObject({code:"artifact/layer", details:{form:"layer", expected:"(layer Name :provides Service (define method [params] body) ...)"}});
  expect(diagnostic.help).toContain("(layer Name :provides Service (define method [params] body) ...)");
  const repaired = applyFix(source, diagnostic.fix!);
  expect(repaired).toBe(service + "(layer UsersLive :provides Users (define find [id] (succeed id)))");
  expect(elaborateEffectProgram(repaired).diagnostics).toEqual([]);
  // Other malformed layers still name both shapes.
  expect(elaborateEffectProgram(service + "(layer UsersLive A B C)").diagnostics[0]?.help).toContain("(layer Name LayerExpr) to compose layers");
});

describe("string-keyed references", () => {
  const prelude = `(type OnbFormIR {:kind String :name String})
    (type OnbFlowIR {:kind String :name Symbol :steps (List String)})
    (form (onb-form name) :types {:name (Declares OnbFormDef String)} :ir OnbFormIR {:kind "Form" :name name})
    (form (onb-flow name steps) :types {:name (Declares OnbFlowDef) :steps (List (Refers OnbFormDef))} :ir OnbFlowIR {:kind "Flow" :name name :steps steps})`;
  const elaborate = async (source: string) => {
    const { elaborateProgram, bootstrapFromSources } = await import("../src/Descriptor.js");
    return elaborateProgram(source, {prelude:bootstrapFromSources("", prelude), sourceId:"refs.lisp"});
  };

  test("a declared string key resolves", async () => {
    expect((await elaborate('(onb-form "intake") (onb-flow Signup ["intake"])')).diagnostics).toEqual([]);
  });

  test("an undeclared string key fails like an undeclared symbol, with a repair", async () => {
    const source = '(onb-form "intake") (onb-flow Signup ["intake" "intak"])';
    const [diagnostic, ...rest] = (await elaborate(source)).diagnostics;
    expect(rest).toEqual([]);
    expect(diagnostic).toMatchObject({message:'Unknown reference "intak" (did you mean "intake"?)', details:{name:"intak", candidates:["intake"]}});
    expect(diagnostic!.fix).toEqual([{newText:'"intake"', span:expect.objectContaining({startOffset:source.indexOf('"intak"'), endOffset:source.indexOf('"intak"') + 7})}]);
    const symbol = (await elaborate('(onb-form "intake") (onb-flow Signup [intak])')).diagnostics[0];
    expect(symbol).toMatchObject({message:"Unknown reference intak (did you mean intake?)", fix:[{newText:"intake"}]});
  });

  test("a string key declared as another kind is a reference-type error", async () => {
    const diagnostic = (await elaborate('(onb-form "intake") (onb-flow Signup ["intake"]) (onb-flow Other ["Signup"])')).diagnostics[0];
    expect(diagnostic?.message).toBe('"Signup" is OnbFlowDef, expected OnbFormDef');
  });
});

test("a base value where a brand is expected offers the brand constructor", async () => {
  const definitions = '(type UserId (Brand String)) (: name-of (-> UserId String)) (define name-of [u] "x") ';
  const source = definitions + '(name-of "u-1")';
  const diagnostic = typecheck({sourceId:"brand.lisp", source}).diagnostics[0]!;
  expect(diagnostic).toMatchObject({code:"typecheck/type-mismatch", details:{expected:"Brand<UserId, String>", got:"String"}, help:expect.stringContaining("(UserId value)")});
  const repaired = applyFix(source, diagnostic.fix!);
  expect(repaired).toBe(definitions + '(name-of (UserId "u-1"))');
  expect(typecheck({source:repaired}).diagnostics).toEqual([]);
  // A value of another base type is not repaired by the brand.
  expect(typecheck({source:definitions + "(name-of 3)"}).diagnostics[0]?.fix).toBeUndefined();

  const { elaborateEffectProgram } = await import("../src/mechanics/elaborate.js");
  const effect = '(type UserId (Brand String))\n(: find-user (-> UserId (Effect String)))\n(define find-user [id] (succeed "x"))\n(: main (Effect String))\n(define main ';
  const program = effect + '(find-user "u-1"))';
  const mechanics = elaborateEffectProgram(program).diagnostics[0]!;
  expect(mechanics).toMatchObject({code:"mechanics/type-mismatch", help:'Wrap the value with the brand constructor: (UserId "u-1").'});
  expect(applyFix(program, mechanics.fix!)).toBe(effect + '(find-user (UserId "u-1")))');
  expect(elaborateEffectProgram(applyFix(program, mechanics.fix!)).diagnostics).toEqual([]);
});

test("running out of steps names the running function and how to make it cheaper", async () => {
  const { evaluate } = await import("../src/Engine.js");
  const source = "(define fib [n] (if (< n 2) n (+ (fib (- n 1)) (fib (- n 2)))))\n(fib 25)";
  const diagnostic = (await evaluate({sourceId:"fib.lisp", source, stepLimit:100_000})).diagnostics[0]!;
  expect(diagnostic).toMatchObject({code:"StepLimitExceeded", details:{limit:100_000, function:"fib"}});
  expect(diagnostic.help).toContain("inside fib");
  expect(diagnostic.help).toContain("accumulator");
  // The suggested shape fits within the same budget.
  const iterative = "(define fib-iter [a b n] (if (= n 0) a (fib-iter b (+ a b) (- n 1))))\n(fib-iter 0 1 25)";
  expect(await evaluate({source:iterative, stepLimit:100_000})).toMatchObject({diagnostics:[], printed:"75025"});
});

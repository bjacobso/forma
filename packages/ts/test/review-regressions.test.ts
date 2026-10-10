import { describe, expect, test } from "vitest";
import { Effect } from "effect";
import { Builtins, Evaluator, Type } from "../src/index.js";
import { generateEffectProgram } from "../src/mechanics/elaborate.js";

const builtins = Builtins.defaultBuiltins;
const prelude = Evaluator.makePreludeLayer(builtins);
const infer = (source: string) => Effect.runPromise(Type.inferSourceStr(source));
const evaluate = async (source: string) => (await Effect.runPromise(
  Effect.provide(Evaluator.evaluate(source, { builtins, stepLimit: 100_000 }), prelude),
)).value;

describe("review regressions", () => {
  test.each([
    ['(define f [k] (match k :a 1 :b 2 _ 3)) (f :b)', 'Int'],
    ['(define f [n] (match n 0 "z" 1 "o" _ "m")) (f 1)', 'String'],
    ['(define id [x] x) (id (if true :a :b))', 'Union<:a, :b>'],
    ['(= (/ 4 2) 2)', 'Bool'],
    ['(define pair [a b] [a b]) (pair 1 2.5)', 'List<Float>'],
  ])("infers %s", async (source, expected) => {
    expect(await infer(source)).toBe(expected);
  });

  test("higher-kinded application preserves numeric subtyping", async () => {
    const source=readFileSync(new URL("../../../conformance/fixtures/typecheck/typeclass-hkt-instance-success/source.lisp",import.meta.url),"utf8");
    expect(await infer(source)).toBe("List<Float>");
  });

  test.each([
    '(define f [r] (if true (assoc r :a 1) (assoc r :b 2)))',
    '(define f [r] (assoc r :s "text")) (+ 1 (f {:s 1}).s)',
    '(define f [r] (dissoc r :a))',
    '(define f [r] (let [_ (+ r.a 1)] (dissoc r :a))) (+ 1 (f {:a 1}).a)',
    '(define f [r] (select-keys r [:a]))',
  ])("rejects unknown row updates without hanging: %s", async source => {
    await expect(infer(source)).rejects.toThrow();
  });

  test.each([
    '(match {:a 1 ":a" "text"} {":a" text :a value} text)',
    '(: data (Map String String)) (define data {":a" "text"}) (match data {":a" text} text)',
  ])("string pattern keys remain distinct from keyword keys: %s", async source => {
    expect(await infer(source)).toBe("String");
    expect(await evaluate(source)).toBe("text");
  });

  test("capitalized zero-argument functions are called", async () => {
    expect(await evaluate('(define Make [] 42) (Make)')).toBe(42);
  });

  test.each([
    '(if true (Some "x") None)',
    '(match true true (Some "x") false None)',
    '(let [value (Some "x")] value)',
    '(find)',
    '(get (Box {:value (Some "x")}) :value)',
  ])("existing Options are preserved: %s", async value => {
    const source = `(type R {:value (Option String)})
      (class Box {:value (Option String)})
      (define find [] (Some "x"))
      (: r R) (define r {:value ${value}})
      (match r.value (Some x) x None "absent")`;
    expect(await infer(source)).toBe("String");
    expect(await evaluate(source)).toBe("x");
  });

  test("macro output uses the public syntax", async () => {
    expect(await evaluate('(macro (make name) `(define ~name [x] x.count)) (make read) (read {:count 7})')).toBe(7);
  });

  test("service values must be accessed without a call", () => {
    const result = generateEffectProgram(`
      (service Clock (: now (Effect Int)))
      (: bad (Effect Int [] [Clock.now]))
      (define bad (Clock.now))
    `);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.map(d => d.code)).toContain("mechanics/service-member-use");
  });
});

import { readFileSync } from "node:fs";
import { bootstrapFromSources } from "../src/descriptor/bootstrap.js";
import { elaborateProgram } from "../src/descriptor/elaborate.js";
const sourcePrelude = (name: string) => readFileSync(new URL(`../../../preludes/${name}.lisp`, import.meta.url), "utf8");
const domainPrelude = bootstrapFromSources(sourcePrelude("compiler"), sourcePrelude("ontology"), sourcePrelude("ui"), sourcePrelude("viewspec"));
describe("domain validation review regressions", () => {
  test.each([
    ['(entity E {:x Strin})', 'Unknown type Strin'],
    ['(entity E {:other (Id Nope)})', 'Unknown type Nope'],
    ['(entity E {:x String}) (seed E "e" {:x "a"}) (seed E "e" {:x "b"})', 'already declared'],
    ['(entity E {:other (Option (Id E))}) (seed E "e" {:other "absent"})', 'Unknown E ID absent'],
    ['(document D (page p :assignee author (text :name "Name"))) (document-locale D "en" (section absent :label "Missing"))', 'Unknown document Section absent'],
    ['(document D (page p :assignee author (text :name "Name"))) (document-locale D "en" (role absent :label "Missing"))', 'Unknown document Role absent'],
    ['(document D (page p :assignee author (text :name "Name"))) (document-locale D "en" (field :absent :label "Missing"))', 'Unknown document LocaleField :absent'],
  ])("rejects %s", (source, message) => {
    const result = elaborateProgram(source, {prelude:domainPrelude});
    expect(result.ok).toBe(false);
    expect(result.diagnostics.map(d => d.message).join("; ")).toContain(message);
  });
  test("seed IDs resolve and top-level do preserves declarations", () => {
    const result = elaborateProgram('(do (entity E {:other (Option (Id E))}) (seed E "first" {}) (seed E "second" {:other "first"}))', {prelude:domainPrelude});
    expect(result.diagnostics).toEqual([]);
    expect(result.declarations.map(d => d.summary.name)).toEqual(["E", "first", "second"]);
  });
  test("class patterns require the declared fields", async () => {
    expect(await evaluate('(class Box {:value Int}) (match {} (Box box) 1 _ 0)')).toBe(0);
  });
  test("Effect surface errors retain locations and accumulate", () => {
    const result = generateEffectProgram('(service A (: bad))\n(service B (: bad))', {sourceId:"bad.forma"});
    expect(result.diagnostics).toHaveLength(2);
    expect(result.diagnostics.map(d=>[d.span?.sourceId,d.span?.startLine])).toEqual([["bad.forma",1],["bad.forma",2]]);
  });
});

describe("source-local forms and UI scopes", () => {
  const form='(type GreetingIR {:text String}) (form (greet text) :types {:text String} :ir GreetingIR {:text text})';
  test("stateless typechecking validates form definitions and applications", async () => {
    expect(await infer(form)).toBe("FormDescriptor");
    expect(await infer(`${form} (greet "Hello")`)).toBe("Declaration");
    await expect(infer(`${form} (greet 42)`)).rejects.toThrow("text");
  });
  test("source-local form bodies can call function helpers", async () => {
    const source='(type GreetingIR {:text String}) (define decorate [text] (str "Hello " text)) (form (greet text) :types {:text String} :ir GreetingIR {:text (decorate text)}) (greet "world")';
    expect(await infer(source)).toBe("Declaration");
  });
  test.each([
    '(view bad :layout (button {:variant "typo"}))',
    '(view bad :layout (button :variant "typo"))',
    '(view bad :layout (text {:content (state missing)}))',
    '(view bad :layout (table :bind (query missing)))',
    '(view bad :layout (text {:content (input missing)}))',
  ])("validates layout literals and references: %s", source => {
    const result=elaborateProgram(source,{prelude:domainPrelude});
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some(d=>d.code==="elaborate/hole-type")).toBe(true);
  });
});

// Regression gate for the OCaml runtime, session and surface lowering:
// requests never crash the daemon, runtime values compare like the
// TypeScript engine, and surface errors are located diagnostics.
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { OcamlDaemon } from "../../../scripts/parity/ocaml-daemon.mjs";
import { normalizeOcamlDeclarations } from "../../../scripts/parity/compare.mjs";
import { readPreludes } from "./corpus.mjs";
import { requireNativeCli } from "./require-build.mjs";

const daemon = new OcamlDaemon(requireNativeCli(), resolve(import.meta.dirname, ".."));
const ok = (response) => { assert.equal(response.ok, true, JSON.stringify(response)); return response.value; };
const evaluate = (source) => daemon.request({ op: "evaluate", sourceId: "runtime", source });
const valueOf = async (source) => ok(await evaluate(source));
const located = (response, source, code, text) => {
  assert.equal(response.ok, false, `${source}: ${JSON.stringify(response)}`);
  const [diagnostic] = response.diagnostics;
  assert.equal(diagnostic.code, code, `${source}: ${JSON.stringify(diagnostic)}`);
  assert.notEqual(diagnostic.span, null, `${source}: diagnostic has no span`);
  if (text !== undefined) assert.equal(source.slice(diagnostic.span.startOffset, diagnostic.span.endOffset), text, source);
  return diagnostic;
};

try {
  // An ambiguous constructor is a located diagnostic in every request, and the
  // daemon keeps serving afterwards.
  const ambiguous = "(type A (Tagged X Y)) (type B (Tagged X Z)) (define v X)";
  const {sessionId} = ok(await daemon.request({op: "openSession"}));
  located(await daemon.request({op: "loadSource", sessionId, sourceId: "ambiguous", source: ambiguous}), ambiguous, "surface/ambiguous-constructor", "X");
  const bundle = ok(await daemon.request({op: "loadSourceBundle", sessionId, sources: [{kind: "source", sourceId: "bundled", source: ambiguous}]}));
  assert.equal(bundle.results[0].ok, false);
  assert.equal(bundle.results[0].diagnostics[0].code, "surface/ambiguous-constructor");
  for (const op of ["evaluate", "typecheck", "expand", "replSubmit"]) {
    located(await daemon.request({op, sessionId, sourceId: "ambiguous", source: ambiguous}), ambiguous, "surface/ambiguous-constructor", "X");
  }
  assert.equal(ok(await daemon.request({op: "sessionInfo", sessionId})).sourceCount, 0);
  ok(await daemon.request({op: "closeSession", sessionId}));

  // Repeated binders compare with runtime equality: numbers by value,
  // functions by identity (structural comparison of a closure never ends).
  for (const [source, expected] of [
    ["(match [1 1.0] [x x] 1 _ 0)", 1],
    ["(match [1 2] [x x] 1 _ 0)", 0],
    ["(define g (fn [] 1)) (match [g g] [x x] 1 _ 0)", 1],
    ["(match [(fn [] 1) (fn [] 1)] [x x] 1 _ 0)", 0],
    ["(match [{:a 1} {:a 1}] [x x] 1 _ 0)", 1],
    ["(match [{:a 1} {:a 2}] [x x] 1 _ 0)", 0],
  ]) assert.deepEqual(await valueOf(source), {kind: "int", value: expected}, source);

  // Sequences have one runtime representation: vector literals, rest
  // patterns, quoted vectors and constructor payloads compare equal.
  for (const source of [
    "(match [1 2 3] [a & rest] (= rest [2 3]))",
    "(= '[1 2] [1 2])",
    "(= {:a [1]} {:a '[1]})",
    "(= 1 1.0)",
    "(match [1 2 3] [a & [b c]] (= (+ b c) 5))",
  ]) assert.deepEqual(await valueOf(source), {kind: "bool", value: true}, source);

  // Dictionaries are maps: patterns, parameter destructuring and map?.
  const dictionary = '(: m (Map String Int)) (define m {"a" 1}) ';
  assert.deepEqual(await valueOf(`${dictionary}(match m {"a" x} x _ 0)`), {kind: "int", value: 1});
  assert.deepEqual(await valueOf(`${dictionary}(match m {"b" x} x _ 0)`), {kind: "int", value: 0});
  assert.deepEqual(await valueOf(`${dictionary}((fn [{"a" x}] x) m)`), {kind: "int", value: 1});
  assert.deepEqual(await valueOf(`${dictionary}(map? m)`), {kind: "bool", value: true});

  // get with a computed key honours its default; without one it is an Option.
  assert.deepEqual(await valueOf("(let [k :z r {:x 1}] (get r k 0))"), {kind: "int", value: 0});
  assert.deepEqual(await valueOf("(let [k :x r {:x 1}] (get r k 0))"), {kind: "int", value: 1});
  const option = await valueOf("(let [k :x r {:x 1}] (get r k))");
  assert.equal(option.entries.find((entry) => entry.key.value === ":_tag").value.value, "Some");

  // Review regressions: pattern literals widen unannotated scrutinees and
  // row updates with unknown overwritten fields cannot promise stale types.
  for (const source of [
    '(define f [k] (match k :a 1 :b 2 _ 3)) (f :b)',
    '(define f [n] (match n 0 "z" 1 "o" _ "m")) (f 1)',
    '(define id [x] x) (id (if true :a :b))',
    '(= (/ 4 2) 2)',
    '(define f [x] (+ x 1)) (f 2.5)',
    '(define f [r] (match r {:keys [a] :as whole} whole.a)) (f {:a 1 :b 2})',
    '(define f [r] (match r {"a" value} value)) (f {"a" 1 "b" 2})',
  ]) ok(await daemon.request({op: "typecheck", sourceId: "review", source}));
  for (const source of [
    '(define f [r] (if true (assoc r :a 1) (assoc r :b 2)))',
    '(define f [r] (assoc r :s "text")) (+ 1 (f {:s 1}).s)',
    '(define f [r] (dissoc r :a))',
    '(define f [r] (select-keys r [:a]))',
    '(match 1 (NoSuchConstructor x) x _ 0)',
  ]) assert.equal((await daemon.request({op: "typecheck", sourceId: "review", source})).ok, false, source);
  for (const value of [
    '(if true (Some "x") None)',
    '(match true true (Some "x") false None)',
    '(let [value (Some "x")] value)',
    '(find)',
    '(get (Box {:value (Some "x")}) :value)',
  ]) {
    const source = `(type R {:value (Option String)})
      (class Box {:value (Option String)})
      (define find [] (Some "x"))
      (: r R) (define r {:value ${value}})
      (match r.value (Some x) x None "absent")`;
    ok(await daemon.request({op: "typecheck", sourceId: "review", source}));
    assert.deepEqual(await valueOf(source), {kind: "string", value: "x"});
  }

  // Dot access inside an ascription.
  assert.deepEqual(await valueOf('(let [p {:name "a"}] (: p.name String))'), {kind: "string", value: "a"});
  assert.equal((await daemon.request({op: "typecheck", sourceId: "dot", source: '(let [p {:name "a"}] (: p.name String))'})).ok, true);

  // Type declaration errors are located surface diagnostics, never internal
  // exceptions such as "option is None".
  for (const [source, text, message] of [
    ["(type T (Tagged)) 1", "(Tagged)", "Tagged requires at least one constructor"],
    ["(type (Box 1) {:v Int}) (: b (Box Int)) (define b {:v 1}) 1", "1", "Type parameters must be distinct lowercase symbols."],
    ["(type (Box a a) {:v a}) 1", "a", "Type parameters must be distinct lowercase symbols."],
    ['(type ("Box" a) Int) 1', '"Box"', "A type name must be a capitalised symbol."],
    ["(type (Box a) {:v a}) (: b (Box Int String)) (define b {:v 1}) 1", "(Box Int String)", "Type Box expects 1 type argument, found 2"],
    ["(type A B) (type B A) (: x A) (define x 1) 1", "A", "Cyclic type alias A"],
    ["(error E {} :status 9)", "(error E {} :status 9)", "error supports :status with an HTTP error status (400–599)"],
  ]) {
    for (const op of ["evaluate", "typecheck"]) {
      const diagnostic = located(await daemon.request({op, sourceId: "runtime", source}), source, "surface/invalid-form", text);
      assert.equal(diagnostic.message, message, source);
    }
  }

  // Effect lowering: a layer exports only the members its service declares;
  // other defines are private helpers. Constructor values inside ascriptions
  // use the same canonical tagged record as un-ascribed values.
  const effectSource = `(service Counter (: next (Effect Int)))
(define base 41)
(layer CounterLive :provides Counter
  (define helper [x] (succeed (+ x 1)))
  (define next (helper base)))
(type Shape (Tagged (Circle Int) Empty))
(: make (Effect Shape))
(define make (succeed (: (Circle 1) Shape)))`;
  const effectSession = ok(await daemon.request({op: "openSession"})).sessionId;
  ok(await daemon.request({op: "loadSource", sessionId: effectSession, sourceId: "effect", source: effectSource}));
  const emitted = ok(await daemon.request({op: "emit", sessionId: effectSession, sourceId: "effect", backend: "canonical-ir"}));
  const declarations = normalizeOcamlDeclarations(emitted.artifacts[0].content);
  const layer = declarations.find((d) => d.payload.kind === "LayerDef").payload.implementation;
  assert.deepEqual(layer.methods.map((m) => m.name), ["next"]);
  assert.equal(layer.methods[0].body.kind, "Let");
  assert.deepEqual(layer.methods[0].body.bindings.map((b) => b.name), ["helper"]);
  const ascribed = declarations.find((d) => d.payload.name === "make").payload.body.value.items[1];
  assert.equal(ascribed.kind, "Record", JSON.stringify(ascribed));
  assert.deepEqual(ascribed.entries.map(entry => entry.value.value), ["Circle", 1]);
  ok(await daemon.request({op: "closeSession", sessionId: effectSession}));

  // Domain errors remain author-located through prelude hooks and child forms.
  for (const [source,message] of [
    ['(entity E {:x Strin})','Unknown type Strin'],
    ['(entity E {:other (Id Nope)})','Unknown type Nope'],
    ['(entity E {:x String}) (seed E "e" {:x "a"}) (seed E "e" {:x "b"})','Duplicate declaration'],
    ['(entity E {:other (Option (Id E))}) (seed E "e" {:other "absent"})','unknown E ID absent'],
    ['(document D (page p :assignee author (text :name "Name"))) (document-locale D "en" (section absent :label "Missing"))','Unknown document Section absent'],
    ['(document D (page p :assignee author (text :name "Name"))) (document-locale D "en" (role absent :label "Missing"))','Unknown document Role absent'],
    ['(document D (page p :assignee author (text :name "Name"))) (document-locale D "en" (field :absent :label "Missing"))','Unknown document LocaleField :absent'],
    ['(view bad :layout (button {:variant "typo"}))','Invalid option'],
    ['(view bad :layout (button :variant "typo"))','Invalid option'],
    ['(view bad :layout (text {:content (state missing)}))','undeclared state'],
    ['(view bad :layout (table :bind (query missing)))','undeclared query'],
    ['(view bad :layout (text {:content (input missing)}))','undeclared input'],
  ]) {
    const sessionId=ok(await daemon.request({op:"openSession"})).sessionId;
    try {
      for(const prelude of readPreludes()) ok(await daemon.request({op:"loadPrelude",sessionId,...prelude}));
      const loaded=await daemon.request({op:"loadSource",sessionId,sourceId:"domain-review",source});
      const result=loaded.ok ? await daemon.request({op:"emit",sessionId,sourceId:"domain-review"}) : loaded;
      assert.equal(result.ok,false,source);
      assert.ok(result.diagnostics.some(d=>d.message.includes(message)),JSON.stringify(result));
      assert.ok(result.diagnostics.every(d=>d.span?.sourceId==="domain-review"),JSON.stringify(result));
    } finally {ok(await daemon.request({op:"closeSession",sessionId}));}
  }
  // Declaration ownership spans sources, while replacing one source is valid.
  const ownedSession = ok(await daemon.request({op:"openSession"})).sessionId;
  try {
    for (const prelude of readPreludes()) ok(await daemon.request({op:"loadPrelude",sessionId:ownedSession,...prelude}));
    ok(await daemon.request({op:"loadSource",sessionId:ownedSession,sourceId:"schema",source:'(entity E {:x String})'}));
    const seed = '(seed E "e" {:x "a"})';
    ok(await daemon.request({op:"loadSource",sessionId:ownedSession,sourceId:"first",source:seed}));
    const duplicate = located(await daemon.request({op:"loadSource",sessionId:ownedSession,sourceId:"second",source:seed}),seed,"surface/invalid-form",seed);
    assert.match(duplicate.message,/Duplicate declaration e/);
    assert.equal(duplicate.span.sourceId,"second");
    ok(await daemon.request({op:"loadSource",sessionId:ownedSession,sourceId:"first",source:seed.replace('"a"','"updated"')}));
    assert.equal(ok(await daemon.request({op:"sessionInfo",sessionId:ownedSession})).sourceCount,2);
  } finally {ok(await daemon.request({op:"closeSession",sessionId:ownedSession}));}
  const form='(type GreetingIR {:text String}) (form (greet text) :types {:text String} :ir GreetingIR {:text text})';
  ok(await daemon.request({op:"typecheck",source:form}));
  ok(await daemon.request({op:"typecheck",source:form+' (greet "Hello")'}));
  assert.equal((await daemon.request({op:"typecheck",source:form+' (greet 42)'})).ok,false);
  ok(await daemon.request({op:"typecheck",source:'(type GreetingIR {:text String}) (define decorate [text] (str "Hello " text)) (form (greet text) :types {:text String} :ir GreetingIR {:text (decorate text)}) (greet "world")'}));

  assert.equal(ok(await daemon.request({op: "version"})).engine, "forma-ocaml");
  console.log("forma-ocaml runtime surface ok (no crashes, runtime equality, dictionaries, located surface errors, layer helpers)");
} finally { await daemon.close(); }

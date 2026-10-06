import assert from "node:assert/strict";
import { resolve } from "node:path";
import { OcamlDaemon } from "../../../scripts/parity/ocaml-daemon.mjs";
import { readPreludes } from "./corpus.mjs";
import { requireNativeCli } from "./require-build.mjs";

const daemon = new OcamlDaemon(requireNativeCli(), resolve(import.meta.dirname, ".."));
const ok = (response) => { assert.equal(response.ok, true, JSON.stringify(response)); return response.value; };
try {
  const {sessionId} = ok(await daemon.request({op: "openSession"}));
  for (const prelude of readPreludes()) ok(await daemon.request({op:"loadPrelude",sessionId,...prelude}));

  const typo=await daemon.request({op:"loadSource",sessionId,sourceId:"typo",source:'(view misspelled :titel "Typo")'});
  assert.equal(typo.ok,false);
  assert.match(typo.diagnostics[0].message,/Did you mean/);

  const source = `(entity Todo {:title String :done Bool})
(: complete (-> (Id Todo) (Action Unit)))
(define complete [id] (update! id {:done true}))
(: create-and-complete (Action (Id Todo)))
(define create-and-complete (do! [id (create! Todo {:title "Write" :done false}) :let [alias id] _ (complete alias)] alias))
(: remove (-> (Id Todo) (Action Unit))) (define remove [id] (retract! id))`;
  ok(await daemon.request({op:"loadSource",sessionId,sourceId:"actions",source}));
  const analysis=ok(await daemon.request({op:"editorAnalyze",sessionId,sourceId:"actions",source}));
  assert.equal(analysis.definitions.find(d=>d.name === "Todo").span.startOffset,source.indexOf("Todo"));
  const actions = ok(await daemon.request({op:"emit",sessionId,sourceId:"actions"})).artifacts[0].content.declarations;
  assert.equal(actions.filter(d=>d.kind==="Action").length,3);
  const badSource = '(entity Other {:title String}) (: bad (-> (Id Todo) (Action Unit))) (define bad [id] (update! Other id {:title "Wrong"}))';
  ok(await daemon.request({op:"loadSource",sessionId,sourceId:"bad-action",source:badSource}));
  assert.equal((await daemon.request({op:"emit",sessionId,sourceId:"bad-action"})).ok,false);

  const warningSource = `(type NoticeIR {:kind "Notice" :name Symbol})
(form (notice name) :types {:name (Declares Notice)} :ir NoticeIR
  :check (fn [holes] [{:severity :warning :code "notice/check" :message "Careful"}])
  {:kind "Notice" :name name})
(notice sample)`;
  ok(await daemon.request({op:"loadSource",sessionId,sourceId:"warnings",source:warningSource}));
  const warning = ok(await daemon.request({op:"emit",sessionId,sourceId:"warnings"}));
  assert.equal(warning.diagnostics[0].severity,"warning");
  assert.equal(warning.diagnostics[0].code,"notice/check");
  assert.equal(warning.diagnostics[0].span.sourceId,"warnings");
  assert.equal(warning.diagnostics[0].span.startOffset,warningSource.indexOf("(notice sample)"));
  assert.deepEqual(warning.artifacts[0].content.diagnostics,warning.diagnostics);

  const shadowSource = `(type CountIR {:kind "Count" :count Int})
(define custom-count [values] 99)
(form (counted values) :types {:values (List String)} :ir CountIR
  (let [count custom-count] {:kind "Count" :count (count values)}))
(counted ["one" "two"])`;
  ok(await daemon.request({op:"loadSource",sessionId,sourceId:"shadow",source:shadowSource}));
  assert.equal(ok(await daemon.request({op:"emit",sessionId,sourceId:"shadow"})).artifacts[0].content.declarations[0].count,99);

  for (const [source,type] of [['(define state :open) state',':open'],['(if true :open :done)','Union<:open, :done>'],['(= :open :done)','Bool'],['(get (if true {:state :open} {:state :done}) :state)','Union<:open, :done>']]) {
    const response=await daemon.request({op:"typecheckCoreTyped",source});
    assert.equal(response.ok,true,JSON.stringify(response)); assert.equal(response.type,type);
  }
  for (const source of ['(def value 1)','(lambda [x] x)','(: value Num) (define value 1)','(service Old (: all (Effect (Array String))))']) {
    const response=await daemon.request({op:"typecheckCoreTyped",source});
    assert.equal(response.ok,false,source);
    assert.equal(response.diagnostics[0].code,"surface/invalid-form");
  }
  const optionalMatch = '(: value {:count (Option Int)}) (define value (match true true {:count 1} _ {})) value.count';
  const matchType=await daemon.request({op:"typecheckCoreTyped",source:optionalMatch});
  assert.equal(matchType.ok,true,JSON.stringify(matchType));
  assert.equal(matchType.type,"Option<Int>");

  const commentedSource = '; module\n(define values [1 ; first\n 2]) ; end\n\' ; quoted\n{:key "; literal" ; last\n}\n; footer';
  const formatted = ok(await daemon.request({op:"editorFormat",source:commentedSource})).text;
  for (const comment of ['; module','; first','; end','; quoted','; last','; footer']) assert.ok(formatted.includes(comment));
  assert.equal(ok(await daemon.request({op:"editorFormat",source:formatted})).text,formatted);

  const isolated = ok(await daemon.request({op:"openSession"})).sessionId;
  for (const sources of [
    [{sourceId:"missing-kind",source:"1"}],
    [{kind:"invalid",sourceId:"invalid",source:"1"}],
    [{kind:"source",sourceId:"first",source:"(define leaked 1)"},null],
    [{kind:"source",sourceId:"same",source:"1"},{kind:"source",sourceId:"same",source:"2"}],
  ]) assert.equal((await daemon.request({op:"loadSourceBundle",sessionId:isolated,sources})).ok,false);
  assert.equal(ok(await daemon.request({op:"sessionInfo",sessionId:isolated})).sourceCount,0);
  ok(await daemon.request({op:"closeSession",sessionId:isolated}));
  ok(await daemon.request({op:"closeSession",sessionId}));
  console.log("forma-ocaml unified syntax ok (typed actions, warnings, lexical projection, atomic bundle validation)");
} finally { await daemon.close(); }

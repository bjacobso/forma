import { describe, expect, it } from "vitest";
import { TsLanguageHost } from "../src/ts-host.js";

async function session() {
  const host = new TsLanguageHost();
  const { sessionId } = await host.openSession();
  return { host, sessionId };
}

describe("transactional session loading", () => {
  it("types preludes against configured session variables", async () => {
    const { host, sessionId } = await session();
    await host.configureSession({ sessionId, variables: [{ name: "configured", value: { kind: "int", value: 4 } }] });
    expect((await host.loadSource({ sessionId, sourceId: "core", kind: "prelude", source: "(define answer (+ configured 1))" })).diagnostics).toEqual([]);
    expect(await host.replSubmit({ sessionId, source: "answer" })).toMatchObject({ status: "completed", result: { value: { kind: "int", value: 5 }, type: { display: "Number" } } });
  });

  it("rejects a prelude that evaluates but does not type, without changing the session", async () => {
    const { host, sessionId } = await session();
    expect((await host.loadSource({ sessionId, sourceId: "core", kind: "prelude", source: "(define answer 42)" })).diagnostics).toEqual([]);
    const before = await host.sessionInfo({ sessionId });
    const bad = await host.loadSource({ sessionId, sourceId: "core", kind: "prelude", source: '(define leaked 3) (define answer (if true 1 "bad"))' });
    expect(bad.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ severity: "error", span: expect.objectContaining({ sourceId: "core" }) })]));
    expect(await host.sessionInfo({ sessionId })).toEqual(before);
    expect(await host.evaluateInSession({ sessionId, source: "answer" })).toMatchObject({ status: "completed", result: { value: { kind: "int", value: 42 } } });
    expect(await host.evaluateInSession({ sessionId, source: "leaked" })).toMatchObject({ status: "failed" });
  });

  it("rejects evaluation failures atomically and removes old prelude bindings on replacement", async () => {
    const host = new TsLanguageHost();
    const { sessionId } = await host.openSession({ defaultStepLimit: 200 });
    await host.loadSource({ sessionId, sourceId: "core", kind: "prelude", source: "(define old 1)" });
    const before = await host.sessionInfo({ sessionId });
    const bad = await host.loadSource({ sessionId, sourceId: "broken", kind: "prelude", source: '(define leaked 2) (define loop [x] (loop x)) (define bad (loop 1))' });
    expect(bad.diagnostics).toMatchObject([{ phase: "evaluate" }]);
    expect(await host.sessionInfo({ sessionId })).toEqual(before);
    expect((await host.loadSource({ sessionId, sourceId: "core", kind: "prelude", source: "(define new 2)" })).diagnostics).toEqual([]);
    expect(await host.evaluateInSession({ sessionId, source: "old" })).toMatchObject({ status: "failed" });
  });

  it("validates surface syntax on load but leaves reference checking to analysis", async () => {
    const { host, sessionId } = await session();
    expect((await host.loadSource({ sessionId, sourceId: "file", source: "(+ future 1)" })).diagnostics).toEqual([]);
    const before = await host.sessionInfo({ sessionId });
    const bad = await host.loadSource({ sessionId, sourceId: "file", source: "(def x 2)" });
    expect(bad.diagnostics).toMatchObject([{ code: "surface/invalid-form", span: { sourceId: "file", startOffset: 0, endOffset: 9 } }]);
    expect(await host.sessionInfo({ sessionId })).toEqual(before);
    expect((await host.loadSource({ sessionId, sourceId: "quote", source: "'(def x 2)" })).diagnostics).toEqual([]);
  });

  it("validates module declarations without resolving forward imports", async () => {
    const { host, sessionId } = await session();
    expect((await host.loadSource({ sessionId, sourceId: "metadata", source: '(use :ontology)' })).diagnostics).toEqual([]);
    expect((await host.loadSource({ sessionId, sourceId: "a", source: '(import "./later" :as later)' })).diagnostics).toEqual([]);
    expect((await host.loadSource({ sessionId, sourceId: "bad", source: '(import "./later")' })).diagnostics).toMatchObject([{ code: "module.import.malformed", span: { sourceId: "bad" } }]);
  });
});

describe("stateful typed REPL", () => {
  it("retains values, generalized types, and source bindings across submissions", async () => {
    const { host, sessionId } = await session();
    expect(await host.replSubmit({ sessionId, source: "(define identity [x] x)" })).toMatchObject({ status: "completed", result: { type: { display: expect.stringContaining("->") } } });
    expect(await host.replSubmit({ sessionId, source: "(identity 42)" })).toMatchObject({ status: "completed", result: { value: { kind: "int", value: 42 }, type: { display: "Int" } } });
    expect(await host.replSubmit({ sessionId, source: '(identity "hello")' })).toMatchObject({ status: "completed", result: { value: { kind: "string", value: "hello" }, type: { display: "String" } } });
    expect((await host.sessionInfo({ sessionId })).sourceCount).toBe(3);
  });

  it("rolls back failed submissions and supports redefinitions and reset", async () => {
    const { host, sessionId } = await session();
    await host.replSubmit({ sessionId, source: "(define answer 42)" });
    const before = await host.sessionInfo({ sessionId });
    expect(await host.replSubmit({ sessionId, source: '(define leaked 1) (define answer (if true 1 "bad"))' })).toMatchObject({ status: "failed" });
    expect(await host.sessionInfo({ sessionId })).toEqual(before);
    expect(await host.replSubmit({ sessionId, source: "(+ answer 1)" })).toMatchObject({ status: "completed", result: { value: { kind: "int", value: 43 } } });
    expect(await host.replSubmit({ sessionId, source: '(define answer "new")' })).toMatchObject({ status: "completed" });
    expect(await host.replSubmit({ sessionId, source: "(- answer 1)" })).toMatchObject({ status: "failed" });
    await host.resetSession({ sessionId });
    expect(await host.replSubmit({ sessionId, source: "answer" })).toMatchObject({ status: "failed" });
  });
});

describe("descriptor load contracts", () => {
  const prelude = `(type ItemIR {:kind "Item" :id String :value String})
(form (item id value {:keys [doc]})
  :types {:id (Declares Item String) :value String :doc (Option String)}
  :ir ItemIR {:kind "Item" :id id :value value})`;
  it("rejects malformed applications and duplicate global identities across sources", async () => {
    const { host, sessionId } = await session();
    expect((await host.loadSource({ sessionId, sourceId: "forms", kind: "prelude", source: prelude })).diagnostics).toEqual([]);
    expect((await host.loadSource({ sessionId, sourceId: "one", source: '(item "same" "value")' })).diagnostics).toEqual([]);
    const before = await host.sessionInfo({ sessionId });
    expect((await host.loadSource({ sessionId, sourceId: "two", source: '(item "same" "other")' })).diagnostics).toMatchObject([{ code: "surface/invalid-form", span: { sourceId: "two" } }]);
    expect(await host.sessionInfo({ sessionId })).toEqual(before);
    expect((await host.loadSource({ sessionId, sourceId: "one", source: '(item "same" "replacement")' })).diagnostics).toEqual([]);
    const bad = '(item "new" "value" :oops "doc")';
    expect((await host.loadSource({ sessionId, sourceId: "bad", source: bad })).diagnostics).toMatchObject([{ code: "descriptor/unknown-slot", span: { sourceId: "bad", startOffset: bad.indexOf(":oops") } }]);
    await host.loadSource({ sessionId, sourceId: "one", source: "" });
    expect((await host.loadSource({ sessionId, sourceId: "two", source: '(item "same" "restored")' })).diagnostics).toEqual([]);
  });
  it("validates descriptors declared in a source without resolving references or running hooks", async () => {
    const { host, sessionId } = await session();
    expect((await host.loadSource({ sessionId, sourceId: "local", source: prelude + '\n(item "new")' })).diagnostics.length).toBeGreaterThan(0);
    expect((await host.sessionInfo({ sessionId })).sourceCount).toBe(0);
  });
});

it("commits suspended REPL submissions only after a successful host result", async () => {
  const { host, sessionId } = await session();
  await host.configureSession({ sessionId, hostBuiltins: [{ name: "host-add", arity: 2,
    handler: { kind: "host-effect", effect: "test/add" },
    typeScheme: { kind: "function", params: [{ kind: "type", name: "Int" }, { kind: "type", name: "Int" }], result: { kind: "type", name: "Int" } } }] });
  const before = await host.sessionInfo({ sessionId });
  const state = await host.replSubmit({ sessionId, source: "(define answer (host-add 20 22))", observe: {} });
  expect(state.status).toBe("host-call");
  expect(await host.sessionInfo({ sessionId })).toEqual(before);
  if (state.status !== "host-call") throw Error("Expected suspended host call");
  const result = await host.resumeHostCall({ sessionId, evaluationId: state.call.evaluationId, callId: state.call.callId,
    result: { ok: true, value: { kind: "int", value: 42 } } });
  expect(result).toMatchObject({ status: "completed", result: { type: { display: "Number" } } });
  expect(await host.replSubmit({ sessionId, source: "answer" })).toMatchObject({ status: "completed", result: { value: { kind: "int", value: 42 }, type: { display: "Number" } } });
  const failed = await host.replSubmit({ sessionId, source: "(define leaked (host-add 1 2))" });
  if (failed.status !== "host-call") throw Error("Expected suspended host call");
  expect(await host.resumeHostCall({ sessionId, evaluationId: failed.call.evaluationId, callId: failed.call.callId,
    result: { ok: false, diagnostics: [{ code: "test/failure", severity: "error", message: "Rejected" }] } })).toMatchObject({ status: "failed" });
  expect(await host.replSubmit({ sessionId, source: "leaked" })).toMatchObject({ status: "failed" });
});


it("retains named types and constructors across REPL submissions and rolls back failed registry changes", async () => {
  const { host, sessionId } = await session();
  expect(await host.replSubmit({ sessionId, source: '(class Person {:name String})' })).toMatchObject({ status: "completed" });
  expect(await host.replSubmit({ sessionId, source: '(: person Person) (define person (Person {:name "Ada"}))' })).toMatchObject({ status: "completed" });
  expect(await host.replSubmit({ sessionId, source: '(get person :name)' })).toMatchObject({ status: "completed", result: { value: { kind: "string", value: "Ada" } } });
  expect(await host.replSubmit({ sessionId, source: '(type Choice (Tagged (One Int) (Other String)))' })).toMatchObject({ status: "completed" });
  expect(await host.replSubmit({ sessionId, source: '(define choice (Choice.One 7))' })).toMatchObject({ status: "completed" });
  expect(await host.replSubmit({ sessionId, source: '(match choice (One n) n (Other s) 0)' })).toMatchObject({ status: "completed", result: { value: { kind: "int", value: 7 } } });
  expect(await host.replSubmit({ sessionId, source: '(type Token String) (if true 1 "bad")' })).toMatchObject({ status: "failed" });
  expect(await host.replSubmit({ sessionId, source: '(: token Token) (define token "x")' })).toMatchObject({ status: "failed" });
  expect(await host.replSubmit({ sessionId, source: '(type Token String)' })).toMatchObject({ status: "completed" });
  expect(await host.replSubmit({ sessionId, source: '(: token Token) (define token "x")' })).toMatchObject({ status: "completed" });
});

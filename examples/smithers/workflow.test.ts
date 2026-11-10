import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { Action, DurableDeferred, DurableQueue, ExternalJob, Flow, HumanTask, Interpreter, WaitFor } from "@smthrs/flow";
import { FlowEngine } from "@smthrs/engine";
import { Node } from "@smthrs/plan";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as PersistedQueue from "effect/persistence/PersistedQueue";
import { compile, type Json } from "./compile.ts";
import { fixtures, prelude, runDemo, source } from "./demo.ts";
import { link, type Handler } from "./runtime.ts";
import { nodeCrypto } from "./node-host.ts";

const flow = (body: string, result = "out", success = "Json", error = "Json", payload = "{}") =>
  `(workflow probe :payload ${payload} :success ${success} :error ${error}
    :capabilities [] :reads [] :writes [] :tier "sealed"
    :deadline-ms 10000 :max-rounds 3 :return ${result} ${body})`;
const action = (name: string, error = "Never", attempts = 1, timeout = 1000) =>
  `(action ${name} :payload {} :success String :error ${error} :tier "sealed"
    :capabilities [] :reads [] :writes [] :attempts ${attempts} :timeout-ms ${timeout} :version "v1")`;

async function execute(text: string, handlers: Record<string, Handler> = {}, name = "probe", payload: Record<string, Json> = {}) {
  const linked = link(compile(prelude, text), handlers);
  const effect = linked.flows.get(name)!.execute(payload, { executionId: "test" })
    .pipe(Effect.timeout(3000), Effect.provide(linked.layer().pipe(Layer.provideMerge(nodeCrypto))));
  return Effect.runPromise(effect as Effect.Effect<Json, unknown>);
}

test("the full workflow suspends for approval, resumes, and shares producers", async () => {
  const { result, trace } = await runDemo();
  expect(result).toBe("Released: https://example.test/releases/patch-123");
  expect(trace).toEqual([
    "implement: Fix issue #42", "test", "review", "awaiting approval", "publish", "deployment-status", "deployment-status",
  ]);
});

test("declining approval never publishes or polls", async () => {
  const { result, trace } = await runDemo(false);
  expect(result).toContain("No release");
  expect(trace).toEqual(["implement: Fix issue #42", "test", "review", "awaiting approval"]);
});

test("failed checks skip the human question and all release effects", async () => {
  const { handlers, trace } = fixtures({ pass: false });
  expect(await execute(source, handlers, "resolve-issue", { issue: "failing checks" })).toContain("No release");
  expect(trace).toEqual(["implement: failing checks", "test", "review"]);
});

test("exhausted publication retries enter recovery", async () => {
  const { result, trace } = await runDemo(true, { failPublish: true });
  expect(result).toContain("Release failed");
  expect(trace.filter(item => item === "publish")).toHaveLength(2);
  expect(trace).not.toContain("deployment-status");
});

test.each([
  [source.replace('["patch" "revision"]', '["patch" "missing"]'), "workflow/expression"],
  [source.replace(':issue {:get ["input" "issue"]}', ':issue 42'), "workflow/payload"],
  [source.replace('(step tests test-patch', '(step patch test-patch'), "workflow/duplicate-node"],
  [source.replace('["patch" "revision"]', '["future" "revision"]'), "workflow/dependency"],
  [source.replace('(branch decision passed', '(branch decision patch'), "workflow/condition"],
  [source.replace('(step patch implement', '(step patch missing'), "elaborate/"],
  [source.replace(':attempts 2', ':attempts -1'), "elaborate/"],
  [source.replace(':key "publish-by-revision"', ''), "workflow/idempotency"],
  [source.replace(':tier "sealed"', ':tier "magic"'), "elaborate/"],
  [flow('(value out {:get ["input" "missing"]})'), "workflow/expression"],
  [flow('(value out {:op "eval" :args []})'), "workflow/expression"],
  [flow('(value a 1) (quorum out 2 [a])'), "workflow/quorum"],
  [flow('(value out 1)', "out", "String"), "workflow/result"],
  [flow('(fail out "failure")', "out", "Never", "Never"), "workflow/error"],
  [action("check", "String") + flow('(poll out check {} :every-ms 1 :max-attempts 2)'), "workflow/poll"],
  [flow('(value out true)', "out", "(Set Bool)"), "workflow/schema"],
])("refuses invalid programs before execution (%#)", (text, diagnostic) => {
  expect(() => compile(prelude, text)).toThrow(diagnostic);
});

test("a workflow cannot silently acquire an action's capabilities", () => {
  const text = source.replace(':capabilities ["fs:read:**" "net:post:https://api.github.com/**"]', ':capabilities []');
  expect(() => compile(prelude, text)).toThrow("workflow/capability");
});

test("closed errors can be eliminated through recovery", async () => {
  const text = flow('(fail failure "failed") (value fallback "recovered") (recover out failure fallback)', "out", "String", "Never");
  expect(await execute(text)).toBe("recovered");
});

test("typed aliases, lists, options and literal enums retain their schema meaning", async () => {
  const text = `(type Label (Union "String" "other"))
    (type Labels (List Label))
    ${flow('(value out {:labels ["String"] :extra nil})', "out", "{:labels Labels :extra (Option String)}", "Never")}`;
  expect(await execute(text)).toEqual({ labels: ["String"], extra: null });
});

test("all members start concurrently", async () => {
  const started: string[] = [];
  const handler = (name: string): Handler => () => Effect.gen(function*() {
    started.push(name);
    // This fails if the compiler serializes the two members.
    for (let i = 0; started.length < 2; i++) {
      if (i > 100) return yield* Effect.die("Members were serialized");
      yield* Effect.sleep(1);
    }
    return name;
  });
  const text = action("a") + action("b") + flow('(step a a {}) (step b b {}) (all out [a b])');
  expect(await execute(text, { a: handler("a"), b: handler("b") })).toEqual({ a: "a", b: "b" });
});

test.each(["all", "race", "any", "quorum"])("%s shares direct and transitive irreversible producers", async join => {
  for (const members of ["a b", "b c"]) {
    let calls = 0;
    const text = (action("produce") + flow(`
      (step a produce {}) (value b {:get ["a"]}) (value c {:get ["a"]})
      (${join} out ${join === "quorum" ? "2 " : ""}[${members}])`)).replaceAll(':tier "sealed"', ':tier "irreversible"');
    const result = await execute(text, { produce: () => Effect.sync(() => `invocation-${++calls}`) });
    expect(result).toEqual(join === "all" || join === "quorum"
      ? members === "a b" ? { a: "invocation-1", b: "invocation-1" } : { b: "invocation-1", c: "invocation-1" }
      : "invocation-1");
    expect(calls).toBe(1);
  }
});

test.each(["race", "any", "quorum"])("%s does not wait for an unrelated shared producer", async join => {
  const text = action("slow") + flow(`
    (step producer slow {}) (value a {:get ["producer"]}) (value b {:get ["producer"]})
    (value fast "fast") (${join} out ${join === "quorum" ? "1 " : ""}[a b fast])`);
  expect(await execute(text, { slow: () => Effect.never })).toEqual(join === "quorum" ? { fast: "fast" } : "fast");
});

test("any can recover a shared failure without failing its other members", async () => {
  let calls = 0;
  const text = (action("produce", "String") + flow(`
    (step producer produce {}) (value a {:get ["producer"]}) (value b {:get ["producer"]})
    (value fallback "recovered") (recover recovered a fallback) (any out [recovered b])`)).replaceAll(':tier "sealed"', ':tier "irreversible"');
  expect(await execute(text, { produce: () => Effect.suspend(() => { calls++; return Effect.fail("unavailable"); }) })).toBe("recovered");
  expect(calls).toBe(1);
});

test.each([false, true])("shared producers stay lazy across branch arms (%s)", async selected => {
  let calls = 0;
  const text = (action("produce") + flow(`
    (step producer produce {}) (value condition ${selected}) (value other "other")
    (branch a condition producer other) (branch b condition producer other) (all out [a b])`))
    .replaceAll(':tier "sealed"', ':tier "irreversible"');
  expect(await execute(text, { produce: () => Effect.sync(() => `invocation-${++calls}`) }))
    .toEqual(selected ? { a: "invocation-1", b: "invocation-1" } : { a: "other", b: "other" });
  expect(calls).toBe(selected ? 1 : 0);
});

test("record checking requires matching keys even for Json fields", async () => {
  const consume = action("consume").replace(":payload {}", ":payload {:expected Json}");
  expect(() => compile(prelude, consume + flow('(step out consume {:other 1})'))).toThrow("workflow/payload");
  expect(() => compile(prelude, flow('(value out {:other 1})', "out", "{:expected Json}"))).toThrow("workflow/result");
  expect(await execute(consume + flow('(step out consume {:expected nil})'), {
    consume: payload => Effect.succeed(payload.expected === null ? "null received" : "wrong payload"),
  })).toBe("null received");
});

test("null get and op fields remain ordinary JSON data", async () => {
  expect(await execute(flow('(value out {:get nil :nested [{:op nil}]})'))).toEqual({ get: null, nested: [{ op: null }] });
});

test.each(["race", "any", "quorum"])("%s uses native early-settling joins", async join => {
  const text = action("fast") + action("slow") + flow(`(step fast fast {}) (step slow slow {}) (${join} out ${join === "quorum" ? "1 " : ""}[fast slow])`);
  let interrupted = false;
  const result = await execute(text, {
    fast: () => Effect.as(Effect.sleep(10), "fast"),
    slow: () => Effect.never.pipe(Effect.onInterrupt(() => Effect.sync(() => { interrupted = true; }))),
  });
  expect(result).toEqual(join === "quorum" ? { fast: "fast" } : "fast");
  expect(interrupted).toBe(true);
});

test("any survives an early typed failure", async () => {
  const text = action("bad", "String") + action("good") + flow('(step bad bad {}) (step good good {}) (any out [bad good])');
  expect(await execute(text, { bad: () => Effect.fail("bad"), good: () => Effect.as(Effect.sleep(10), "good") })).toBe("good");
});

test("sequence waits for success before starting unrelated work", async () => {
  const order: string[] = [];
  const text = action("first") + action("second") + flow('(step first first {}) (step second second {}) (sequence out [first second])');
  await execute(text, {
    first: () => Effect.andThen(Effect.sleep(10), Effect.sync(() => { order.push("first"); return "first"; })),
    second: () => Effect.sync(() => { expect(order).toEqual(["first"]); order.push("second"); return "second"; }),
  });
  expect(order).toEqual(["first", "second"]);
});

test("a sequence failure prevents every effect in the next subtree", async () => {
  let calls = 0;
  const text = action("later") + flow(`
    (fail stopped "stop") (step a later {}) (step b later {}) (all joined [a b]) (sequence out [stopped joined])`);
  await expect(execute(text, { later: () => Effect.sync(() => { calls++; return "unexpected"; }) })).rejects.toBe("stop");
  expect(calls).toBe(0);
});

test("native planned bindings leave unrelated race members runnable", async () => {
  const slow = Action.make("probe/slow", { payload: {}, success: Schema.String, attemptTimeoutMs: 1000 });
  const native = Flow.make("probe/native", {
    payload: {}, success: Schema.String,
    body: () => Node.bindPlanned(slow.call({}), Node.capture({}, reference =>
      Node.race({ slow: Node.succeed(reference), fast: Node.succeed("fast") }))),
  });
  const layer = Layer.mergeAll(Interpreter.layer(native), slow.toLayer(() => Effect.never))
    .pipe(Layer.provideMerge(Action.layerImplementations), Layer.provideMerge(FlowEngine.layerMemory), Layer.provideMerge(nodeCrypto));
  expect(await Effect.runPromise(native.execute({}, { executionId: "probe" }).pipe(Effect.timeout(2000), Effect.provide(layer)) as Effect.Effect<string, unknown>)).toBe("fast");
});

test("native retry and attempt timeouts are enforced", async () => {
  let attempts = 0;
  const retry = action("retry", "String", 2) + flow('(step out retry {})');
  expect(await execute(retry, { retry: () => Effect.suspend(() => ++attempts === 1 ? Effect.fail("transient") : Effect.succeed("ok")) })).toBe("ok");
  expect(attempts).toBe(2);
  const timeout = action("timeout", "Never", 1, 10) + flow('(step out timeout {})');
  await expect(execute(timeout, { timeout: () => Effect.never })).rejects.toBeDefined();
});

test("handoffs implement bounded loops without JavaScript recursion", async () => {
  const text = flow(`
    (value again {:op "eq" :args [{:get ["input" "count"]} 0]})
    (handoff next probe {:count 1}) (value done "finished")
    (branch out again next done)`, "out", "String", "Json", "{:count Int}");
  expect(await execute(text, {}, "probe", { count: 0 })).toBe("finished");
  const runaway = flow('(handoff out probe {})', "out", "String");
  await expect(execute(runaway)).rejects.toBeDefined();
});

test("sleep runs on Smithers' timer implementation", async () => {
  expect(await execute(flow('(sleep out 1)', "out", "Unit"))).toBe(null);
});

test("typed signal waits resume through native durable deferreds", async () => {
  const linked = link(compile(prelude, flow('(wait out String)', "out", "String")), {});
  const target = linked.flows.get("probe")!;
  const work = Effect.gen(function*() {
    yield* target.execute({}, { executionId: "signal", discard: true });
    for (let i = 0; ; i++) {
      const state = yield* target.poll("signal");
      if (Option.isSome(state) && state.value._tag === "Suspended") break;
      if (i > 100) throw new Error("Signal did not park");
      yield* Effect.sleep(1);
    }
    const token = DurableDeferred.tokenFromExecutionId(WaitFor.deferred("out"), { flow: target, executionId: "signal" });
    yield* DurableDeferred.succeed(WaitFor.deferred("out"), { token, value: "received" });
    return yield* target.execute({}, { executionId: "signal" });
  });
  expect(await Effect.runPromise(work.pipe(Effect.provide(linked.layer().pipe(Layer.provideMerge(nodeCrypto)))) as Effect.Effect<Json, unknown>)).toBe("received");
});

test("missing action and native flow implementations fail during linking", () => {
  expect(() => link(compile(prelude, action("missing") + flow('(step out missing {})')), {})).toThrow("Missing handler");
  expect(() => link(compile(prelude, '(native-flow missing :payload {} :success String :error Never :capabilities [])'), {})).toThrow("Missing native flow");
});

test("native-flow connects a real Smithers declaration through a checked boundary", async () => {
  const native = Flow.make("native/example", { payload: { message: Schema.String }, success: Schema.String, body: payload => Node.succeed(payload.message) });
  const text = '(native-flow echo :payload {:message String} :success String :error Never :capabilities [])' + flow('(child out echo {:message "hello"})', "out", "String", "Never");
  const linked = link(compile(prelude, text), {}, { echo: { flow: native } });
  const result = linked.flows.get("probe")!.execute({}, { executionId: "native" })
    .pipe(Effect.provide(linked.layer().pipe(Layer.provideMerge(nodeCrypto))));
  expect(await Effect.runPromise(result as Effect.Effect<Json, unknown>)).toBe("hello");
});

test("native-flow runs an actual ExternalJob lifecycle", async () => {
  const calls: string[] = [];
  const job = ExternalJob.make("native/job", {
    payload: { id: Schema.String }, handle: Schema.String, success: Schema.String,
    probe: { every: 1, max: 10 }, timeout: 1000,
  });
  const layer = job.toLayer({
    start: ({ id }, key) => Effect.sync(() => { calls.push("start:" + key); return id; }),
    status: () => Effect.sync(() => { calls.push("status"); return { _tag: "Exited" as const, exitCode: 0 }; }),
    collect: handle => Effect.sync(() => { calls.push("collect"); return "result:" + handle; }),
    cancel: () => Effect.sync(() => { calls.push("cancel"); }),
  });
  const text = '(native-flow job :payload {:id String} :success String :error Json :capabilities [])' + flow('(child out job {:id "work"})', "out", "String");
  const linked = link(compile(prelude, text), {}, { job: { flow: job, layer } });
  const result = linked.flows.get("probe")!.execute({}, { executionId: "job" })
    .pipe(Effect.timeout(3000), Effect.provide(linked.layer().pipe(Layer.provideMerge(nodeCrypto))));
  expect(await Effect.runPromise(result as Effect.Effect<Json, unknown>)).toBe("result:work");
  expect(calls[0]).toMatch(/^start:.+#g/);
  expect(calls.slice(1)).toEqual(["status", "collect"]);
});

test("native-flow runs a real DurableQueue worker and receives its answer", async () => {
  const queue = DurableQueue.make({ name: "example", payload: { id: Schema.String }, success: Schema.String, idempotencyKey: payload => payload.id });
  const offer = Action.make("native/offer", { payload: { id: Schema.String }, success: Schema.String });
  const native = Flow.make("native/queued", { payload: { id: Schema.String }, success: Schema.String, body: payload => offer.call(payload) });
  const queueServices = PersistedQueue.layer.pipe(Layer.provideMerge(PersistedQueue.layerStoreMemory));
  const layer = Layer.mergeAll(
    offer.toLayer(payload => DurableQueue.process(queue, payload)),
    DurableQueue.worker(queue, payload => Effect.succeed("processed:" + payload.id), { concurrency: 2 }),
  ).pipe(Layer.provideMerge(queueServices));
  const text = '(native-flow queued :payload {:id String} :success String :error Never :capabilities [])' + flow('(child out queued {:id "item"})', "out", "String", "Never");
  const linked = link(compile(prelude, text), {}, { queued: { flow: native, layer } });
  const result = linked.flows.get("probe")!.execute({}, { executionId: "queue" })
    .pipe(Effect.timeout(3000), Effect.provide(linked.layer().pipe(Layer.provideMerge(nodeCrypto))));
  expect(await Effect.runPromise(result as Effect.Effect<Json, unknown>)).toBe("processed:item");
});

test("review loops and fixed-plan map/reduce compose from the same core forms", async () => {
  const patterns = readFileSync(new URL("./patterns.forma", import.meta.url), "utf8");
  const handlers: Record<string, Handler> = {
    ...fixtures().handlers,
    draft: payload => Effect.succeed(`${payload.issue}: proposal ${payload.attempt}`),
    critique: payload => Effect.succeed(payload.attempt === 2),
  };
  expect(await execute(source + patterns, handlers, "review-loop", { issue: "fix", attempt: 1 })).toBe("fix: proposal 2");
  expect(await execute(source + patterns, handlers, "compare-proposals", { issue: "fix" })).toBe("fix: proposal 1 | fix: proposal 2");
});

test("a native success contract mismatch fails before executing the flow", () => {
  const native = Flow.make("native/bad-contract", { payload: {}, success: Schema.Boolean, body: () => Node.succeed(true) });
  const program = compile(prelude, '(native-flow external :payload {} :success String :error Never :capabilities [])');
  expect(() => link(program, {}, { external: { flow: native } })).toThrow("success schema does not match");
});

test.each([
  ["String", "hello"],
  ['(Union "ship" "hold")', "ship"],
  ["{:approved Bool}", { approved: true }],
  ["(Option String)", null],
  ["Json", { anything: [1, true] }],
] as const)("human answers use their declared %s schema", async (answerType, answer) => {
  const linked = link(compile(prelude, flow('(ask out ' + answerType + ' "Question?" :timeout-ms 1000)', "out", answerType)), {});
  const target = linked.flows.get("probe")!;
  const work = Effect.gen(function*() {
    yield* target.execute({}, { executionId: "answer", discard: true });
    for (let i = 0; ; i++) {
      const state = yield* target.poll("answer");
      if (Option.isSome(state) && state.value._tag === "Suspended") break;
      if (i > 100) throw new Error("Question did not park");
      yield* Effect.sleep(1);
    }
    const token = DurableDeferred.tokenFromExecutionId(HumanTask.deferred("out", 1), { flow: target, executionId: "answer" });
    yield* HumanTask.answer({ token, value: answer });
    return yield* target.execute({}, { executionId: "answer" });
  });
  expect(await Effect.runPromise(work.pipe(Effect.provide(linked.layer().pipe(Layer.provideMerge(nodeCrypto)))) as Effect.Effect<Json, unknown>)).toEqual(answer);
});

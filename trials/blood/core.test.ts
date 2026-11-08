import { test } from "node:test";
import assert from "node:assert/strict";
import { check, run, Int, Bool, Unit } from "./core.ts";
import type { Term, Type, Capability, RunResult } from "./core.ts";

const int = (value: number): Term => ({ tag: "int", value });
const unit: Term = { tag: "unit" };
const variable = (name: string): Term => ({ tag: "var", name });
const letIn = (name: string, value: Term, body: Term): Term => ({ tag: "let", name, value, body });
const call = (fn: Term, arg: Term): Term => ({ tag: "call", fn, arg });
const lambda = (name: string, param: Type, result: Type, effects: string[], body: Term): Term =>
  ({ tag: "lambda", name, param, result, effects, body });
const using = (body: Term): Term => ({ tag: "using", name: "file", region: "r", body });
const resourceGrants = ["Resource.open", "Resource.read", "Resource.close"];
const op = (name: string, arg: Term = unit): Term => ({ tag: "op", name, arg });
const completed = (result: RunResult, value: unknown, trace: string[] = []) => {
  assert.equal(result.status, "completed", JSON.stringify(result));
  if (result.status !== "completed") return;
  assert.deepEqual(result.value, value);
  assert.deepEqual(result.trace, trace);
};
const rejected = (term: Term, message: RegExp) => {
  assert.throws(() => check(term), message);
  const result = run(term, new Map(), resourceGrants);
  assert.equal(result.status, "rejected");
  assert.deepEqual(result.trace, []);
};

test("explicit identity instantiates independently at Int and Bool", () => {
  const a: Type = { tag: "var", name: "a" };
  const id: Term = { tag: "poly", types: ["a"], rows: [], body: lambda("x", a, a, [], variable("x")) };
  const inst = (type: Type): Term => ({ tag: "instantiate", value: variable("id"), types: [type], rows: [] });
  const program = letIn("id", id, { tag: "pair", left: call(inst(Int), int(17)), right: call(inst(Bool), { tag: "bool", value: false }) });
  completed(run(program), { left: 17, right: false });
  rejected({ tag: "instantiate", value: id, types: [], rows: [] }, /arity/);
  rejected(call({ tag: "instantiate", value: id, types: [Int], rows: [] }, { tag: "bool", value: true }), /argument type/);
});

test("effect-polymorphic wrapper preserves callback effects, including through a pair", () => {
  const callback: Type = { tag: "fn", param: Int, result: Int, effects: ["$e"] };
  const wrapper: Term = { tag: "poly", types: [], rows: ["e"], body:
    lambda("f", callback, Int, ["$e"], letIn("box", { tag: "pair", left: variable("f"), right: int(5) },
      { tag: "split", value: variable("box"), left: "step", right: "arg",
        body: call(variable("step"), call(variable("step"), variable("arg"))) })) };
  const caps = new Map<string, Capability>([["Math.increment", { param: Int, result: Int, invoke: x => (x as number) + 1 }]]);
  const program = (effects: string[], body: Term): Term => call(
    { tag: "instantiate", value: wrapper, types: [], rows: [effects] }, lambda("n", Int, Int, effects, body));
  const pure = program([], variable("n"));
  const effectful = program(["Math.increment"], op("Math.increment", variable("n")));
  assert.deepEqual(check(pure, caps).effects, []);
  assert.deepEqual(check(effectful, caps).effects, ["Math.increment"]);
  completed(run(pure, caps), 5);
  completed(run(effectful, caps, ["Math.increment"]), 7, ["call:Math.increment", "call:Math.increment"]);
  assert.equal(run(effectful, caps).status, "rejected");
});

test("polymorphic binder spelling does not change type equality", () => {
  const a: Type = { tag: "var", name: "a" }, b: Type = { name: "b", tag: "var" };
  const expected: Type = { tag: "forall", types: ["b"], rows: [], body: { tag: "fn", param: b, result: b, effects: [] } };
  const id: Term = { tag: "poly", types: ["a"], rows: [], body: lambda("x", a, a, [], variable("x")) };
  const consumer = lambda("id", expected, Int, [], call({ tag: "instantiate", value: variable("id"), types: [Int], rows: [] }, int(19)));
  completed(run(call(consumer, id)), 19);
});

test("affine values cannot enter unrestricted polymorphism", () => {
  const a: Type = { tag: "var", name: "a" };
  const duplicate: Term = { tag: "poly", types: ["a"], rows: [], body:
    lambda("x", a, { tag: "pair", left: a, right: a }, [], { tag: "pair", left: variable("x"), right: variable("x") }) };
  completed(run(call({ tag: "instantiate", value: duplicate, types: [Int], rows: [] }, int(6))), { left: 6, right: 6 });
  rejected(using({ tag: "instantiate", value: duplicate, types: [{ tag: "handle", region: "r" }], rows: [] }), /unrestricted/);
});

test("kernel rejects fabricated types, hidden effects, unbound variables and invalid binders", () => {
  rejected(lambda("x", Int, Bool, [], variable("x")), /result type/);
  rejected(lambda("x", Int, Int, [], { tag: "fail", error: "Oops", result: Int }), /hides effects/);
  rejected(variable("fabricated"), /unbound/);
  rejected(lambda("x", { tag: "var", name: "a" }, Int, [], int(1)), /unbound type/);
  rejected(lambda("x", Int, Int, ["$e"], variable("x")), /unbound effect/);
  rejected({ tag: "poly", types: ["a"], rows: ["a"], body: unit }, /duplicate/);
  rejected({ tag: "poly", types: [], rows: [], body: letIn("x", int(1), variable("x")) }, /syntactic value/);
});

test("sum elimination checks both branches and executes only the selected branch", () => {
  for (const side of ["left", "right"] as const) {
    const value: Term = side === "left"
      ? { tag: "inject", side, value: int(23), other: Bool }
      : { tag: "inject", side, value: { tag: "bool", value: false }, other: Int };
    const program: Term = { tag: "case", value, leftName: "n", left: variable("n"), rightName: "b",
      right: { tag: "if", condition: variable("b"), yes: int(100), no: int(-7) } };
    completed(run(program), side === "left" ? 23 : -7);
    rejected({ ...program, right: unit }, /case result/);
  }
});

test("capabilities execute left-to-right, after whole-program checking and grant validation", () => {
  const seen: number[] = [];
  const caps = new Map<string, Capability>([["Log.write", { param: Int, result: Int, invoke: x => { seen.push(x as number); return x; } }]]);
  const program: Term = { tag: "pair", left: op("Log.write", int(3)), right: op("Log.write", int(11)) };
  assert.equal(run(program, caps).status, "rejected");
  assert.deepEqual(seen, []);
  const invalid: Term = { tag: "pair", left: program, right: call(int(1), unit) };
  assert.equal(run(invalid, caps, ["Log.write"]).status, "rejected");
  assert.deepEqual(seen, []);
  completed(run(program, caps, ["Log.write"]), { left: 3, right: 11 }, ["call:Log.write", "call:Log.write"]);
  assert.deepEqual(seen, [3, 11]);
});

test("resource reads borrow; moves transfer ownership; close happens exactly once", () => {
  const moved = using(letIn("owned", variable("file"), letIn("a", { tag: "read", name: "owned" },
    letIn("b", { tag: "read", name: "owned" }, letIn("done", { tag: "close", name: "owned" },
      { tag: "pair", left: variable("a"), right: variable("b") })))));
  completed(run(moved, new Map(), resourceGrants), { left: 0, right: 0 }, ["open:0", "read:0", "read:0", "close:0"]);
  rejected(using(letIn("owned", variable("file"), { tag: "read", name: "file" })), /moved resource/);
  rejected(using(letIn("done", { tag: "close", name: "file" }, { tag: "read", name: "file" })), /moved resource/);
  rejected(using({ tag: "pair", left: variable("file"), right: variable("file") }), /moved binding/);
});

test("resources cannot escape directly, in products, sums, or captured closures", () => {
  rejected(using(variable("file")), /escapes/);
  rejected(using({ tag: "pair", left: int(9), right: variable("file") }), /escapes/);
  rejected(using({ tag: "inject", side: "right", value: variable("file"), other: Int }), /escapes/);
  rejected(using(lambda("x", Unit, Int, ["Resource.read"], { tag: "read", name: "file" })), /moved resource/);
  // A noncapturing closure created inside the region remains valid outside it.
  completed(run(call(using(lambda("x", Int, Int, [], variable("x"))), int(31)), new Map(), resourceGrants), 31, ["open:0", "close:0"]);
});

test("ownership moves in either branch invalidate subsequent access, independent of branch order", () => {
  for (const flipped of [false, true]) {
    const close: Term = { tag: "close", name: "file" };
    const branch: Term = { tag: "if", condition: { tag: "bool", value: flipped }, yes: flipped ? unit : close, no: flipped ? close : unit };
    rejected(using(letIn("done", branch, { tag: "read", name: "file" })), /moved resource/);
    const sumBranch: Term = { tag: "case", value: { tag: "inject", side: "left", value: unit, other: Unit },
      leftName: "l", left: flipped ? unit : close, rightName: "r", right: flipped ? close : unit };
    rejected(using(letIn("done", sumBranch, { tag: "read", name: "file" })), /moved resource/);
  }
});

test("catch does not resurrect ownership or erase effects raised by its handler", () => {
  rejected(using({ tag: "catch", error: "Oops", body: letIn("done", { tag: "close", name: "file" },
    { tag: "fail", error: "Oops", result: Unit }), handler: { tag: "close", name: "file" } }), /moved resource/);
  const program: Term = { tag: "catch", error: "Oops", body: { tag: "fail", error: "Oops", result: Int },
    handler: { tag: "fail", error: "Oops", result: Int } };
  assert.deepEqual(check(program).effects, ["error:Oops"]);
  assert.equal(run(program).status, "failed");
  const mismatched: Term = { ...program, handler: unit };
  rejected(mismatched, /handler type/);
});

test("cleanup precedes outer recovery and runs on unmatched failure and evaluation limits", () => {
  const fail: Term = { tag: "fail", error: "Oops", result: Int };
  const program: Term = { tag: "catch", error: "Oops", body: using(fail), handler: int(42) };
  completed(run(program, new Map(), resourceGrants), 42, ["open:0", "close:0"]);
  assert.deepEqual(check(program).effects, ["Resource.close", "Resource.open"]);
  const unmatched = run({ ...program, error: "Other" }, new Map(), resourceGrants);
  assert.equal(unmatched.status, "failed");
  assert.deepEqual(unmatched.trace, ["open:0", "close:0"]);
  const limited = run(using(int(8)), new Map(), resourceGrants, 1);
  assert.equal(limited.status, "failed");
  assert.deepEqual(limited.trace, ["open:0", "close:0"]);
});

test("nested regions unwind inside-out; early close is not repeated", () => {
  const nested: Term = using({ tag: "using", name: "inner", region: "s", body:
    letIn("done", { tag: "close", name: "inner" }, { tag: "read", name: "file" }) });
  completed(run(nested, new Map(), resourceGrants), 0, ["open:0", "open:1", "close:1", "read:0", "close:0"]);
});

test("ownership is preserved through functions and destructuring, not just direct aliases", () => {
  const handle: Type = { tag: "handle", region: "r" };
  const program = using(letIn("move", lambda("h", handle, handle, [], variable("h")),
    letIn("box", { tag: "pair", left: call(variable("move"), variable("file")), right: int(13) },
      { tag: "split", value: variable("box"), left: "owned", right: "n",
        body: letIn("closed", { tag: "close", name: "owned" }, variable("n")) })));
  completed(run(program, new Map(), resourceGrants), 13, ["open:0", "close:0"]);
  const duplicate = using(letIn("box", { tag: "pair", left: variable("file"), right: int(13) },
    { tag: "pair", left: variable("box"), right: variable("box") }));
  rejected(duplicate, /moved binding/);
});

test("foreign result violations and exceptions fail with cleanup, not typed recovery", () => {
  for (const invoke of [() => false, () => { throw new Error("foreign panic"); }]) {
    const caps = new Map<string, Capability>([["Host.value", { param: Unit, result: Int, invoke }]]);
    const program: Term = { tag: "catch", error: "Oops", body: using(op("Host.value")), handler: int(99) };
    const result = run(program, caps, [...resourceGrants, "Host.value"]);
    assert.equal(result.status, "failed");
    assert.deepEqual(result.trace, ["open:0", "call:Host.value", "close:0"]);
  }
});

test("host sum results validate the selected payload before it reaches the program", () => {
  const result: Type = { tag: "sum", left: Int, right: Bool };
  const program: Term = { tag: "case", value: op("Host.choose"), leftName: "n", left: variable("n"),
    rightName: "b", right: { tag: "if", condition: variable("b"), yes: int(1), no: int(-9) } };
  for (const [value, expected] of [[{ side: "left", value: 37 }, 37], [{ side: "right", value: false }, -9]] as const) {
    const caps = new Map<string, Capability>([["Host.choose", { param: Unit, result, invoke: () => value }]]);
    completed(run(program, caps, ["Host.choose"]), expected, ["call:Host.choose"]);
  }
  const caps = new Map<string, Capability>([["Host.choose", { param: Unit, result, invoke: () => ({ side: "right", value: 37 }) }]]);
  const invalid = run(program, caps, ["Host.choose"]);
  assert.equal(invalid.status, "failed");
  if (invalid.status === "failed") assert.match(invalid.message, /invalid host result/);
});

test("safe Int boundaries are checked before execution", () => {
  completed(run(int(Number.MAX_SAFE_INTEGER)), Number.MAX_SAFE_INTEGER);
  completed(run(int(Number.MIN_SAFE_INTEGER)), Number.MIN_SAFE_INTEGER);
  for (const value of [Number.MAX_SAFE_INTEGER + 1, Number.MIN_SAFE_INTEGER - 1, 1.5, NaN, Infinity]) {
    rejected(int(value), /safe integer/);
  }
});

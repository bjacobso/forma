import assert from "node:assert/strict";
import { Option } from "effect";
import { chosen, copyAnonymous, copyStage, events, fromComputed, nestedPlain, noneStage, plainStage, ready, signals, someStage } from "./expected.js";

export default async function check(): Promise<void> {
  const base = [{ _tag: "Placed", id: "order-7" }, { _tag: "Billed", amount: 37 }];
  assert.deepEqual(events("order-7", false), base);
  assert.deepEqual(events("order-7", true), [...base, { _tag: "Acked", to: "buyer" }]);
  assert.deepEqual(copyStage({ note: "copied", n: 1 }), { note: "copied", n: 2 });
  assert.deepEqual(copyStage({ n: 1 }), { n: 2 });
  assert.deepEqual(someStage, { note: "present", n: 3 });
  assert.deepEqual(noneStage, { n: 4 });
  assert.deepEqual(plainStage, { note: "plain", n: 5 });
  assert.deepEqual(ready, { status: "ready" });
  assert.deepEqual(copyAnonymous({ note: "kept", n: 0 }), { note: "kept" });
  assert.deepEqual(copyAnonymous({ n: 0 }), {});
  assert.deepEqual(signals, [{ kind: "Off" }, { kind: "On", value: 9 }]);
  assert.deepEqual(chosen, { _tag: "Has", note: "inside union" });
  let calls = 0;
  assert.deepEqual(fromComputed(n => { calls++; return Option.some(`computed-${n}`); }), { note: "computed-7", n: 6 });
  assert.equal(calls, 1);
  assert.deepEqual(fromComputed(() => Option.none()), { n: 6 });
  assert.deepEqual(nestedPlain(Option.some("nested")), { note: Option.some("nested") });
  assert.deepEqual(nestedPlain(Option.none()), { note: Option.none() });
}

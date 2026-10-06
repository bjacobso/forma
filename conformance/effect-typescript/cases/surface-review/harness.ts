import assert from "node:assert/strict";
import { Effect, Option, Schema } from "effect";
import { circle, recover, handlerError, Counter, CounterLive, MaybeName, missing, other, radius, roles, Roles } from "./expected.js";
export default async function check(): Promise<void> {
  assert.equal(Effect.runSync(recover(true)), "first");
  assert.equal(Effect.runSync(recover(false)), "fallback");
  const failure=Effect.runSync(Effect.flip(handlerError));
  assert.equal(failure._tag, "SecondError");
  assert.equal(radius(Effect.runSync(circle)), 7);
  assert.deepEqual(other, {_tag: "Circle", value: "x"});
  assert.ok(Option.isNone(missing));
  assert.deepEqual(Schema.decodeUnknownSync(Roles)({admin: 1}), roles);
  assert.deepEqual(Schema.decodeUnknownSync(Roles)({}), {});
  assert.ok(Option.isSome(Schema.decodeUnknownSync(MaybeName)(Option.some("x"))));
  const value = Effect.gen(function* () { const counter = yield* Counter; return yield* counter.next; });
  assert.equal(await Effect.runPromise(Effect.provide(value, CounterLive)), 9);
}

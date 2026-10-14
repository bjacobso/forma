import assert from "node:assert/strict";
import { Effect, Layer } from "effect";
import { Runtime } from "foldkit";
import { Counter, CounterStore, CounterUnavailable, init, update } from "./expected.js";

const success = Layer.succeed(CounterStore, { get: () => Effect.succeed(42) });
// This checks that the emitted application can be mounted with Foldkit's
// real configuration contract, including its service requirements.
export const mount = (container: HTMLElement) => Runtime.makeElement({ ...Counter, container, resources: success });

export default async function check(): Promise<void> {
  const initial = init();
  assert.deepEqual(initial.model, { count: 0, status: "idle", reason: "" });
  assert.equal(initial.commands.length, 0);
  const incremented = update(initial.model, { _tag: "Increment" });
  assert.equal(incremented.model.count, 1);
  assert.equal(update(incremented.model, { _tag: "Decrement" }).model.count, 0);
  const loading = update(incremented.model, { _tag: "Load" });
  assert.equal(loading.model.status, "loading");
  assert.equal(loading.commands.length, 1);
  assert.equal(loading.commands[0]?.name, "load-count");
  const command = loading.commands[0];
  assert.ok(command);
  const got = await Effect.runPromise(command.effect.pipe(Effect.provide(success)));
  assert.deepEqual(got, { _tag: "GotCount", count: 42 });
  assert.deepEqual(update(loading.model, got).model, { count: 42, status: "idle", reason: "" });
  const failure = Layer.succeed(CounterStore, { get: () => Effect.fail(new CounterUnavailable({ reason: "offline" })) });
  const failed = await Effect.runPromise(command.effect.pipe(Effect.provide(failure)));
  assert.deepEqual(failed, { _tag: "LoadFailed", reason: "offline" });
  assert.deepEqual(update(loading.model, failed).model, { count: 1, status: "failed", reason: "offline" });
  // Update returns commands without executing I/O; earlier models are immutable.
  assert.deepEqual(initial.model, { count: 0, status: "idle", reason: "" });
}

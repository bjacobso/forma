import assert from "node:assert/strict";
import { Cause, Effect, Exit, Layer, Option } from "effect";
import {
  describeRead,
  Forbidden,
  NotFound,
  RateLimited,
  readAnything,
  readOption,
  readOrDie,
  readOrExplain,
  readWithDefault,
  readWrapped,
  Storage,
  StorageError,
} from "./expected.js";

const StorageTest = Layer.succeed(
  Storage,
  Storage.of({
    read: (user, key) => {
      if (user === "guest") return Effect.fail(new Forbidden({ user }));
      if (key === "missing") return Effect.fail(new NotFound({ key }));
      if (key === "hot") return Effect.fail(new RateLimited({ "retry-after": 30 }));
      return Effect.succeed(`value of ${key}`);
    },
  }),
);

const run = <A, E>(effect: Effect.Effect<A, E, Storage>) => Effect.runPromise(Effect.provide(effect, StorageTest));

export default async function check(): Promise<void> {
  assert.equal(await run(readOrExplain("ada", "a")), "value of a");
  assert.equal(await run(readOrExplain("ada", "missing")), "no missing");
  assert.equal(await run(readOrExplain("guest", "a")), "guest may not read a");
  const limited = await run(Effect.flip(readOrExplain("ada", "hot")));
  assert.ok(limited instanceof RateLimited);
  assert.equal(limited["retry-after"], 30);

  assert.equal(await run(readAnything("ada", "hot")), "failed with RateLimited");
  assert.equal(await run(readAnything("guest", "a")), "failed with Forbidden");

  const wrapped = await run(Effect.flip(readWrapped("ada", "missing")));
  assert.ok(wrapped instanceof StorageError);
  assert.equal(wrapped.detail, "read missing failed");

  assert.equal(await run(readWithDefault("guest", "a")), "default");
  assert.ok(Option.isNone(await run(readOption("ada", "missing"))));
  assert.deepEqual(await run(readOption("ada", "a")), Option.some("value of a"));

  assert.equal(await run(describeRead("ada", "a")), "ok: value of a");
  assert.equal(await run(describeRead("ada", "missing")), "error: NotFound");

  assert.equal(await run(readOrDie("ada", "a")), "value of a");
  const exit = await Effect.runPromiseExit(Effect.provide(readOrDie("ada", "missing"), StorageTest));
  assert.ok(Exit.isFailure(exit));
  // The typed failure became a defect: it is no longer in the error channel.
  assert.ok(Cause.hasDies(exit.cause));
  assert.ok(!Cause.hasFails(exit.cause));
  assert.ok(Cause.squash(exit.cause) instanceof NotFound);
}

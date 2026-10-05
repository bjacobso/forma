import assert from "node:assert/strict";
import { Effect, Layer } from "effect";
import { alwaysFail, Console, ConsoleUnavailable, log, recover } from "./expected.js";

export default async function check(): Promise<void> {
  const failure = await Effect.runPromise(Effect.flip(alwaysFail("offline")));
  assert.ok(failure instanceof ConsoleUnavailable);
  assert.equal(failure.message, "offline");

  assert.equal(await Effect.runPromise(recover("offline")), undefined);

  const printed: string[] = [];
  const ConsoleTest = Layer.succeed(Console, Console.of({ print: (message) => Effect.sync(() => { printed.push(message); }) }));
  await Effect.runPromise(Effect.provide(log("hello"), ConsoleTest));
  assert.deepEqual(printed, ["hello"]);

  const ConsoleDown = Layer.succeed(Console, Console.of({ print: (message) => Effect.fail(new ConsoleUnavailable({ message })) }));
  const down = await Effect.runPromise(Effect.flip(Effect.provide(log("lost"), ConsoleDown)));
  assert.equal(down.message, "lost");
}

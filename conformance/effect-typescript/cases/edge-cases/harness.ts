import assert from "node:assert/strict";
import { Effect, Layer, Option } from "effect";
import {
  answer,
  exclaim,
  explain,
  Forbidden,
  Greeter,
  GreeterLive,
  invite,
  lookup,
  negLiteral,
  negNeg,
  NotFound,
  priceTag,
  rebound,
  resetKey,
  shoutAll,
  statusText,
  Store,
  yesNo,
  type Member,
} from "./expected.js";

export default async function check(): Promise<void> {
  assert.equal(negNeg(5), 5);
  assert.equal(negLiteral, 1);
  assert.equal(answer, 42);
  // Adjacent pieces must not form a template placeholder.
  assert.equal(priceTag("9"), "cost: ${amount} `9`");
  // dissoc's own binder must not capture the parameter named key.
  assert.deepEqual(resetKey({ a: 1, b: 2 }, "a"), { b: 2, a: 0 });
  // Only own keys are found.
  assert.ok(Option.isNone(lookup({ a: 1 }, "constructor")));
  assert.deepEqual(lookup({ a: 1 }, "a"), Option.some(1));
  assert.equal(rebound(1), 20);
  assert.deepEqual(shoutAll(["a", "b"]), ["A", "B"]);
  assert.deepEqual([200, 404, 500].map(statusText), ["ok", "missing", "other"]);
  assert.deepEqual([true, false].map(yesNo), ["yes", "no"]);

  const saved: Member[] = [];
  const StoreTest = Layer.succeed(
    Store,
    Store.of({
      read: (key) => {
        if (key === "secret") return Effect.fail(new Forbidden({ user: "guest" }));
        if (key === "gone") return Effect.fail(new NotFound({ key }));
        return Effect.succeed(`value of ${key}`);
      },
      save: (member) => Effect.sync(() => { saved.push(member); }),
    }),
  );
  const run = <A, E>(effect: Effect.Effect<A, E, Store>) => Effect.runPromise(Effect.provide(effect, StoreTest));
  assert.deepEqual(await run(invite("ada")), { name: "ada", role: "member" });
  assert.deepEqual(saved, [{ name: "ada", role: "member" }]);
  assert.equal(await run(explain("gone")), "missing gone");
  assert.equal(await run(explain("secret")), "denied guest");
  assert.equal(await run(exclaim("k")), "value of k!");

  const greeting = await Effect.runPromise(Effect.provide(Greeter.use((greeter) => greeter.greet("ada")), GreeterLive));
  assert.equal(greeting, "ada@7");
  await secondPass();
}

export async function secondPass(): Promise<void> {
  const { byName, circles, defaultRole, largest, lowerAll, pair, roles, scaled } = await import("./expected.js");
  assert.equal(await Effect.runPromise(defaultRole()), "admin");
  assert.deepEqual(await Effect.runPromise(circles([0.5, 2])), [{ kind: "square", side: 0.5 }, { kind: "circle", radius: 2 }]);
  assert.deepEqual(await Effect.runPromise(pair()), [{ kind: "circle", radius: 1 }, "member"]);
  assert.deepEqual(roles(), ["admin", "member"]);
  assert.deepEqual(byName({}), { b: { name: "b", role: "member" } });
  assert.deepEqual(await Effect.runPromise(largest([1, 3])), { kind: "circle", radius: 3 });
  assert.deepEqual(lowerAll(["A"]), ["a"]);
  // scaled is defined before scale and factor in the source.
  assert.equal(scaled, 6);
}

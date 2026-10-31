import assert from "node:assert/strict";
import { Effect, Layer } from "effect";
import { Audit, cancel, type Order, Orders, ship, touch } from "./expected.js";

export default async function check(): Promise<void> {
  const events: string[] = [];
  const OrdersTest = Layer.succeed(Orders, Orders.of({
    find: (id) => Effect.sync(() => {
      events.push(`find ${id}`);
      return { id, status: "pending" };
    }),
    save: (order) => Effect.sync(() => {
      events.push(`save ${order.id} ${order.status}`);
    }),
  }));
  const AuditTest = Layer.succeed(Audit, Audit.of({
    record: (entry) => Effect.sync(() => {
      events.push(`audit ${entry}`);
    }),
  }));
  const run = <A>(program: Effect.Effect<A, never, Orders | Audit>) =>
    Effect.runPromise(Effect.provide(program, Layer.merge(OrdersTest, AuditTest)));
  const order: Order = { id: "o1", status: "pending" };

  assert.deepEqual(await run(ship("o1")), { id: "o1", status: "shipped" });
  assert.deepEqual(events.splice(0), ["find o1", "audit ship o1", "save o1 shipped"]);

  assert.deepEqual(await run(cancel(order)), { id: "o1", status: "cancelled" });
  assert.deepEqual(events.splice(0), ["save o1 cancelled", "audit cancel o1"]);

  assert.equal(await run(touch(order)), undefined);
  assert.deepEqual(events.splice(0), ["audit touch", "save o1 pending"]);
}

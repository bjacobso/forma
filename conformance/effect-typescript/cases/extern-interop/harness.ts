import assert from "node:assert/strict";
import { Effect } from "effect";
import { checkout, pay } from "./expected.js";
import { audited, ledger, OrderId, PaymentDeclined, PaymentsLive } from "./payments.js";

export default async function check(): Promise<void> {
  // checkout provides the imported live layer itself, so the real implementation runs.
  assert.equal(await Effect.runPromise(checkout({ id: OrderId.make("Order 42"), cents: 1_250 })), "12.50 USD");
  assert.deepEqual(ledger, [{ order: "Order 42", cents: 1_250 }]);
  assert.deepEqual(audited, ["charged order-42"]);

  assert.equal(await Effect.runPromise(checkout({ id: OrderId.make("big"), cents: 20_000 })), "declined: over limit for big");
  assert.equal(ledger.length, 1);

  // pay still requires Payments; the caller chooses the layer, and the declared failure surfaces.
  const declined = await Effect.runPromise(Effect.flip(Effect.provide(pay({ id: OrderId.make("big"), cents: 20_000 }), PaymentsLive)));
  assert.ok(declined instanceof PaymentDeclined);
  assert.equal(declined.reason, "over limit for big");
}

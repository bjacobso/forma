import assert from "node:assert/strict";
import { Effect, Schema } from "effect";
import {
  applyDiscount,
  contact,
  Customer,
  discountFor,
  EmptyCart,
  LineItem,
  loudNames,
  outcomeLabel,
  skus,
  subtotal,
  summarize,
  tierLabel,
  upgrade,
} from "./expected.js";

const ada = new Customer({ id: "c1", name: "Ada", tier: "pro", email: "ada@example.com" });
const linus = new Customer({ id: "c2", name: "Linus", tier: "free" });
const items = [
  new LineItem({ sku: "apple", quantity: 3, "unit-cents": 120 }),
  new LineItem({ sku: "ghost", quantity: 0, "unit-cents": 999 }),
  new LineItem({ sku: "fig", quantity: 1, "unit-cents": 300 }),
];

export default async function check(): Promise<void> {
  assert.equal(subtotal(items), 660);
  assert.deepEqual(discountFor(ada), { type: "percent", rate: 10 });
  assert.deepEqual(discountFor(linus), { type: "none" });
  assert.equal(applyDiscount({ type: "percent", rate: 10 }, 655), 590);
  assert.equal(applyDiscount({ type: "fixed", cents: 500 }, 300), 0);
  assert.equal(applyDiscount({ type: "none" }, 300), 300);
  assert.equal(tierLabel("enterprise"), "Enterprise");
  assert.equal(contact(ada), "Ada <ada@example.com>");
  assert.equal(contact(linus), "Linus");
  assert.equal(skus(items), "apple,fig");

  assert.equal(
    await Effect.runPromise(summarize(ada, items)),
    "Ada <ada@example.com> [Pro] 2 items (apple,fig), 660 -> 594 cents, top fig",
  );
  const empty = await Effect.runPromise(Effect.flip(summarize(linus, [])));
  assert.ok(empty instanceof EmptyCart);
  assert.equal(await Effect.runPromise(outcomeLabel(linus, [])), "empty cart for c2");
  assert.equal(await Effect.runPromise(outcomeLabel(linus, items.slice(0, 1))), "Linus [Free] 1 items (apple), 360 -> 360 cents, top apple");

  const upgraded = upgrade(linus);
  assert.ok(upgraded instanceof Customer);
  assert.equal(upgraded.tier, "pro");
  assert.equal(upgrade(upgraded).tier, "enterprise");
  assert.equal(linus.tier, "free");

  assert.deepEqual(loudNames([ada, linus]), ["ADA!", "LINUS!", "STAFF!", "EVERYONE!"]);

  // Schema classes decode and encode like any other schema.
  const decoded = Schema.decodeUnknownSync(Customer)({ id: "c3", name: "Grace", tier: "enterprise" });
  assert.ok(decoded instanceof Customer);
  assert.equal(tierLabel(decoded.tier), "Enterprise");
}

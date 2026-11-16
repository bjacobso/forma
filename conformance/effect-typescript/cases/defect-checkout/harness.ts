import assert from "node:assert/strict";
import { Effect, Layer } from "effect";
import { CardDeclined, CartId, CartNotFound, checkout, Email, Mailer, Payments, Shop } from "./expected.js";

const carts = new Map([["cart-1", { id: CartId.make("cart-1"), items: [{ sku: "a", price: 300 }, { sku: "b", price: 450 }] }]]);

const ShopTest = Layer.succeed(Shop, Shop.of({
  findCart: (id) => {
    const cart = carts.get(id);
    return cart ? Effect.succeed(cart) : Effect.fail(new CartNotFound({ id }));
  },
}));

const PaymentsTest = (limit: number) => Layer.succeed(Payments, Payments.of({
  charge: (amount) =>
    amount > limit
      ? Effect.fail(new CardDeclined({ reason: "over limit" }))
      : Effect.succeed({ "receipt-id": `r-${amount}`, amount }),
}));

export default async function check(): Promise<void> {
  const sent: string[] = [];
  const MailerTest = Layer.succeed(Mailer, Mailer.of({
    send: (to, body) => Effect.sync(() => { sent.push(`${to}: ${body}`); }),
  }));
  const run = (cart: string, limit: number) =>
    checkout(CartId.make(cart), Email.make("ada@example.com")).pipe(
      Effect.provide(Layer.mergeAll(ShopTest, PaymentsTest(limit), MailerTest)),
    );

  assert.deepEqual(await Effect.runPromise(run("cart-1", 1000)), { receipt: "r-750", total: 750 });
  assert.deepEqual(sent, ["ada@example.com: Receipt r-750 for 750"]);

  // A failed step stops the sequence: no receipt is mailed.
  assert.ok((await Effect.runPromise(Effect.flip(run("cart-1", 500)))) instanceof CardDeclined);
  assert.ok((await Effect.runPromise(Effect.flip(run("cart-9", 1000)))) instanceof CartNotFound);
  assert.equal(sent.length, 1);
}

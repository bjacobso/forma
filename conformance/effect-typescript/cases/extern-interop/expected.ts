import { Effect, Schema } from "effect";
import { audit, currency, formatCents, OrderId, PaymentDeclined, Payments, PaymentsLive, toSlug as slug } from "./payments.js";

export const Order = Schema.Struct({
  id: OrderId,
  cents: Schema.Int,
});
export type Order = typeof Order.Type;

export const pay = (order: Order): Effect.Effect<string, PaymentDeclined, Payments> =>
  Effect.gen(function* () {
    const payments = yield* Payments;
    const receipt = yield* payments.charge(order.id, order.cents);
    yield* audit(`charged ${slug(order.id)}`);
    return `${formatCents(receipt.cents)} ${currency}`;
  });

export const checkout = (order: Order): Effect.Effect<string> =>
  Effect.gen(function* () {
    return yield* Effect.provide(
      Effect.catchTag(pay(order), "PaymentDeclined", (e) => Effect.succeed(`declined: ${e.reason}`)),
      PaymentsLive,
    );
  });

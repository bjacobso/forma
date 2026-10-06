import { Context, Effect, Option, Schema } from "effect";

export const OrderId = Schema.String.pipe(Schema.brand("OrderId"));
export type OrderId = typeof OrderId.Type;

export const Status = Schema.Literals(["pending", "paid", "shipped"]);
export type Status = typeof Status.Type;

export const Order = Schema.Struct({
  id: OrderId,
  status: Status,
  "total-cents": Schema.Int,
});
export type Order = typeof Order.Type;

export class OrderNotFound extends Schema.TaggedError<OrderNotFound>()("OrderNotFound", {
  id: OrderId,
}) {}

export class PaymentDeclined extends Schema.TaggedError<PaymentDeclined>()("PaymentDeclined", {
  reason: Schema.String,
}) {}

export class Orders extends Context.Service<
  Orders,
  {
    readonly find: (arg0: OrderId) => Effect.Effect<Option.Option<Order>>;
    readonly save: (arg0: Order) => Effect.Effect<void>;
  }
>()("Orders") {}

export class Payments extends Context.Service<
  Payments,
  {
    readonly charge: (arg0: number) => Effect.Effect<string, PaymentDeclined>;
  }
>()("Payments") {}

export const pay = (
  id: OrderId,
): Effect.Effect<Order, OrderNotFound | PaymentDeclined, Orders | Payments> =>
  Effect.gen(function* () {
    const orders = yield* Orders;
    const payments = yield* Payments;
    const found = yield* orders.find(id);
    if (Option.isSome(found)) {
      const order = found.value;
      yield* Effect.retry(payments.charge(order["total-cents"]), { times: 2 });
      const paid = { ...order, status: "paid" } satisfies Order;
      yield* orders.save(paid);
      return paid;
    } else {
      return yield* Effect.fail(new OrderNotFound({ id }));
    }
  });

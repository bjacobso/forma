import { Context, Effect, Schema } from "effect";

export const Order = Schema.Struct({
  id: Schema.String,
  status: Schema.String,
});
export type Order = typeof Order.Type;

export class Orders extends Context.Service<
  Orders,
  {
    readonly find: (arg0: string) => Effect.Effect<Order>;
    readonly save: (arg0: Order) => Effect.Effect<void>;
  }
>()("Orders") {}

export class Audit extends Context.Service<
  Audit,
  {
    readonly record: (arg0: string) => Effect.Effect<void>;
  }
>()("Audit") {}

export const ship = (id: string): Effect.Effect<Order, never, Audit | Orders> =>
  Effect.gen(function* () {
    const audit = yield* Audit;
    const orders = yield* Orders;
    const order = yield* orders.find(id);
    const shipped = { ...order, status: "shipped" };
    yield* audit.record(`ship ${id}`);
    yield* orders.save(shipped);
    return shipped;
  });

export const cancel = (order: Order): Effect.Effect<Order, never, Audit | Orders> =>
  Effect.gen(function* () {
    const audit = yield* Audit;
    const orders = yield* Orders;
    const cancelled = { ...order, status: "cancelled" };
    yield* orders.save(cancelled);
    yield* audit.record(`cancel ${order.id}`);
    return cancelled;
  });

export const touch = (order: Order): Effect.Effect<void, never, Audit | Orders> =>
  Effect.gen(function* () {
    const audit = yield* Audit;
    const orders = yield* Orders;
    yield* audit.record("touch");
    yield* orders.save(order);
    return;
  });

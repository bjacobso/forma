import { Context, Effect, Layer, Option, Record, Schema } from "effect";

export const Sku = Schema.String.pipe(Schema.brand("Sku"));
export type Sku = typeof Sku.Type;

export const OrderLine = Schema.Struct({
  sku: Sku,
  quantity: Schema.Int,
});
export type OrderLine = typeof OrderLine.Type;

export const OrderRequest = Schema.Struct({
  customer: Schema.String,
  lines: Schema.Array(OrderLine),
});
export type OrderRequest = typeof OrderRequest.Type;

export const Receipt = Schema.Struct({
  "charge-id": Schema.String,
  "total-cents": Schema.Int,
  "placed-at": Schema.Int,
});
export type Receipt = typeof Receipt.Type;

export class OutOfStock extends Schema.TaggedError<OutOfStock>()("OutOfStock", {
  sku: Sku,
}) {}

export class PaymentDeclined extends Schema.TaggedError<PaymentDeclined>()("PaymentDeclined", {
  reason: Schema.String,
}) {}

export class InvalidOrder extends Schema.TaggedError<InvalidOrder>()("InvalidOrder", {
  reason: Schema.String,
}) {}

export class Clock extends Context.Service<
  Clock,
  {
    readonly now: () => Effect.Effect<number>;
  }
>()("Clock") {}

export class Catalog extends Context.Service<
  Catalog,
  {
    readonly price: (sku: Sku) => Effect.Effect<Option.Option<number>>;
  }
>()("Catalog") {}

export class Inventory extends Context.Service<
  Inventory,
  {
    readonly reserve: (sku: Sku, quantity: number) => Effect.Effect<void, OutOfStock>;
    readonly release: (sku: Sku, quantity: number) => Effect.Effect<void>;
  }
>()("Inventory") {}

export class Payments extends Context.Service<
  Payments,
  {
    readonly charge: (customer: string, amountCents: number) => Effect.Effect<string, PaymentDeclined>;
  }
>()("Payments") {}

export class Notifier extends Context.Service<
  Notifier,
  {
    readonly send: (customer: string, message: string) => Effect.Effect<void>;
  }
>()("Notifier") {}

export class Checkout extends Context.Service<
  Checkout,
  {
    readonly place: (request: OrderRequest) => Effect.Effect<Receipt, InvalidOrder | OutOfStock | PaymentDeclined>;
  }
>()("Checkout") {}

export const lineTotal = (line: OrderLine, unitCents: number): number => line.quantity * unitCents;

export const priceLines = (
  lines: ReadonlyArray<OrderLine>,
): Effect.Effect<number, InvalidOrder, Catalog> =>
  Effect.gen(function* () {
    const catalog = yield* Catalog;
    const totals = yield* Effect.forEach(lines, (line) => Effect.gen(function* () {
      const price = yield* catalog.price(line.sku);
      if (Option.isSome(price)) {
        const cents = price.value;
        return lineTotal(line, cents);
      } else {
        return yield* Effect.fail(new InvalidOrder({ reason: `unknown sku ${line.sku}` }));
      }
    }));
    return totals.reduce((total, item) => total + item, 0);
  });

export const reserveAll = (
  lines: ReadonlyArray<OrderLine>,
): Effect.Effect<void, OutOfStock, Inventory> =>
  Effect.gen(function* () {
    const inventory = yield* Inventory;
    yield* Effect.forEach(lines, (line) => inventory.reserve(line.sku, line.quantity));
    return;
  });

export const releaseAll = (
  lines: ReadonlyArray<OrderLine>,
): Effect.Effect<void, never, Inventory> =>
  Effect.gen(function* () {
    const inventory = yield* Inventory;
    yield* Effect.forEach(lines, (line) => inventory.release(line.sku, line.quantity));
    return;
  });

export const placeOrder = (
  request: OrderRequest,
): Effect.Effect<Receipt, InvalidOrder | OutOfStock | PaymentDeclined, Clock | Inventory | Payments> =>
  Effect.gen(function* () {
    return yield* Effect.provide(
      Effect.gen(function* () {
        const checkout = yield* Checkout;
        return yield* checkout.place(request);
      }),
      AppLive,
    );
  });

export const priceList: { readonly [key: string]: number } = { apple: 120, pear: 90, fig: 300 };

export const CatalogStatic: Layer.Layer<Catalog> = Layer.succeed(
  Catalog,
  Catalog.of({
    price: (sku) => Effect.succeed(Record.get(priceList, sku)),
  }),
);

export const NotifierLog: Layer.Layer<Notifier> = Layer.succeed(
  Notifier,
  Notifier.of({
    send: (customer, message) => Effect.log("notify", customer, message),
  }),
);

export const CheckoutLive: Layer.Layer<Checkout, never, Catalog | Clock | Inventory | Notifier | Payments> = Layer.effect(
  Checkout,
  Effect.gen(function* () {
    const clock = yield* Clock;
    const notifier = yield* Notifier;
    const payments = yield* Payments;
    const context = yield* Effect.context<Catalog | Inventory>();
    return Checkout.of({
      place: (request) =>
        Effect.gen(function* () {
          if (request.lines.length === 0) {
            yield* Effect.fail(new InvalidOrder({ reason: "an order needs at least one line" }));
          }
          const total = yield* Effect.provideContext(priceLines(request.lines), context);
          yield* Effect.provideContext(reserveAll(request.lines), context);
          const chargeId = yield* Effect.catchTag(
            payments.charge(request.customer, total),
            "PaymentDeclined",
            (declined) => Effect.gen(function* () {
              yield* Effect.provideContext(releaseAll(request.lines), context);
              return yield* Effect.fail(declined);
            }),
          );
          const placedAt = yield* clock.now();
          yield* notifier.send(request.customer, `charged ${total} cents`);
          return { "charge-id": chargeId, "total-cents": total, "placed-at": placedAt };
        }),
    });
  }),
);

export const AppLive: Layer.Layer<Checkout, never, Clock | Inventory | Payments> =
  Layer.provide(CheckoutLive, Layer.mergeAll(CatalogStatic, NotifierLog));

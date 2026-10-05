import assert from "node:assert/strict";
import { Effect, Layer, Ref } from "effect";
import {
  Clock,
  Inventory,
  InvalidOrder,
  OutOfStock,
  PaymentDeclined,
  Payments,
  placeOrder,
  Sku,
  type OrderRequest,
} from "./expected.js";

const ClockFixed = Layer.succeed(Clock, Clock.of({ now: () => Effect.succeed(1_700_000_000) }));

const makeAdapters = Effect.gen(function* () {
  const stock = yield* Ref.make(new Map<string, number>([["apple", 10], ["pear", 1], ["fig", 5]]));
  const charges = yield* Ref.make<ReadonlyArray<string>>([]);
  const inventory = Inventory.of({
    reserve: (sku, quantity) =>
      Effect.gen(function* () {
        const current = yield* Ref.get(stock);
        const available = current.get(sku) ?? 0;
        if (available < quantity) return yield* Effect.fail(new OutOfStock({ sku }));
        yield* Ref.set(stock, new Map(current).set(sku, available - quantity));
      }),
    release: (sku, quantity) =>
      Ref.update(stock, (current) => new Map(current).set(sku, (current.get(sku) ?? 0) + quantity)),
  });
  const payments = Payments.of({
    charge: (customer, amountCents) =>
      amountCents > 1_000
        ? Effect.fail(new PaymentDeclined({ reason: `limit exceeded for ${customer}` }))
        : Effect.gen(function* () {
            const id = `ch_${amountCents}`;
            yield* Ref.update(charges, (all) => [...all, id]);
            return id;
          }),
  });
  return { stock, charges, layer: Layer.mergeAll(Layer.succeed(Inventory, inventory), Layer.succeed(Payments, payments), ClockFixed) };
});

const order = (customer: string, ...lines: ReadonlyArray<readonly [string, number]>): OrderRequest => ({
  customer,
  lines: lines.map(([sku, quantity]) => ({ sku: Sku.make(sku), quantity })),
});

export default async function check(): Promise<void> {
  const program = Effect.gen(function* () {
    const { stock, charges, layer } = yield* makeAdapters;
    const run = <A, E>(effect: Effect.Effect<A, E, Clock | Inventory | Payments>) => Effect.provide(effect, layer);

    const receipt = yield* run(placeOrder(order("ada", ["apple", 3], ["fig", 1])));
    assert.deepEqual(receipt, { "charge-id": "ch_660", "total-cents": 660, "placed-at": 1_700_000_000 });
    assert.equal((yield* Ref.get(stock)).get("apple"), 7);
    assert.deepEqual(yield* Ref.get(charges), ["ch_660"]);

    const empty = yield* Effect.flip(run(placeOrder(order("ada"))));
    assert.ok(empty instanceof InvalidOrder);
    assert.equal(empty.reason, "an order needs at least one line");

    const unknown = yield* Effect.flip(run(placeOrder(order("ada", ["kiwi", 1]))));
    assert.ok(unknown instanceof InvalidOrder);
    assert.equal(unknown.reason, "unknown sku kiwi");

    const missing = yield* Effect.flip(run(placeOrder(order("ada", ["pear", 2]))));
    assert.ok(missing instanceof OutOfStock);
    assert.equal(missing.sku, "pear");

    const declined = yield* Effect.flip(run(placeOrder(order("grace", ["fig", 4]))));
    assert.ok(declined instanceof PaymentDeclined);
    assert.equal(declined.reason, "limit exceeded for grace");
    // The reservation was released when the payment failed.
    assert.equal((yield* Ref.get(stock)).get("fig"), 4);
    assert.deepEqual(yield* Ref.get(charges), ["ch_660"]);
  });

  await Effect.runPromise(program);
}

// A hand-written Effect module, as it might already exist in a codebase.
// program.lisp imports these exports with extern instead of redeclaring them.
import { Context, Effect, Layer, Schema } from "effect";

export const OrderId = Schema.String.pipe(Schema.brand("OrderId"));
export type OrderId = typeof OrderId.Type;

export const Receipt = Schema.Struct({ order: OrderId, cents: Schema.Int });
export type Receipt = typeof Receipt.Type;

export class PaymentDeclined extends Schema.TaggedError<PaymentDeclined>()("PaymentDeclined", {
  reason: Schema.String,
}) {}

export class Payments extends Context.Service<
  Payments,
  { readonly charge: (order: OrderId, cents: number) => Effect.Effect<Receipt, PaymentDeclined> }
>()("Payments") {}

/** Every charge the live layer accepted, so the harness can see that it ran. */
export const ledger: Receipt[] = [];

export const PaymentsLive = Layer.succeed(
  Payments,
  Payments.of({
    charge: (order, cents) =>
      cents > 10_000
        ? Effect.fail(new PaymentDeclined({ reason: `over limit for ${order}` }))
        : Effect.sync(() => {
            const receipt = { order, cents };
            ledger.push(receipt);
            return receipt;
          }),
  }),
);

export const formatCents = (cents: number): string => `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;

export const toSlug = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]+/g, "-");

export const currency = "USD";

export const audited: string[] = [];

export const audit = (message: string): Effect.Effect<void> => Effect.sync(() => void audited.push(message));

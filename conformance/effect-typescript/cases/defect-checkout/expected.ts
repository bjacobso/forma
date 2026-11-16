import { Context, Effect, Schema } from "effect";

const __formaInt = (value: number): number => {
  if (!Number.isSafeInteger(value)) throw new RangeError("Int outside the safe integer range");
  return value === 0 ? 0 : value;
};

export const CartId = Schema.String.pipe(Schema.brand("CartId"));
export type CartId = typeof CartId.Type;

export const Email = Schema.String.pipe(Schema.brand("Email"));
export type Email = typeof Email.Type;

export const Item = Schema.Struct({
  sku: Schema.String,
  price: Schema.Int,
});
export type Item = typeof Item.Type;

export const Cart = Schema.Struct({
  id: CartId,
  items: Schema.Array(Item),
});
export type Cart = typeof Cart.Type;

export const Payment = Schema.Struct({
  "receipt-id": Schema.String,
  amount: Schema.Int,
});
export type Payment = typeof Payment.Type;

export const CheckoutReceipt = Schema.Struct({
  receipt: Schema.String,
  total: Schema.Int,
});
export type CheckoutReceipt = typeof CheckoutReceipt.Type;

export class CartNotFound extends Schema.TaggedError<CartNotFound>()("CartNotFound", {
  id: CartId,
}) {}

export class CardDeclined extends Schema.TaggedError<CardDeclined>()("CardDeclined", {
  reason: Schema.String,
}) {}

export class Shop extends Context.Service<
  Shop,
  {
    readonly findCart: (arg0: CartId) => Effect.Effect<Cart, CartNotFound>;
  }
>()("Shop") {}

export class Payments extends Context.Service<
  Payments,
  {
    readonly charge: (arg0: number) => Effect.Effect<Payment, CardDeclined>;
  }
>()("Payments") {}

export class Mailer extends Context.Service<
  Mailer,
  {
    readonly send: (arg0: Email, arg1: string) => Effect.Effect<void>;
  }
>()("Mailer") {}

export const receiptMessage = (paid: Payment, total: number): string =>
  `Receipt ${paid["receipt-id"]} for ${total}`;

export const checkout = (
  cartId: CartId,
  email: Email,
): Effect.Effect<CheckoutReceipt, CartNotFound | CardDeclined, Mailer | Payments | Shop> =>
  Effect.gen(function* () {
    const mailer = yield* Mailer;
    const payments = yield* Payments;
    const shop = yield* Shop;
    const cart = yield* shop.findCart(cartId);
    const total = __formaInt(cart.items.map((item) => item.price).reduce((total, item) => total + item, 0));
    const paid = yield* payments.charge(total);
    yield* mailer.send(email, receiptMessage(paid, total));
    return { receipt: paid["receipt-id"], total };
  });

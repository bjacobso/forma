import { Effect, Option, Result, Schema } from "effect";

export const Tier = Schema.Literals(["free", "pro", "enterprise"]);
export type Tier = typeof Tier.Type;

export const Discount = Schema.Union([
  Schema.Struct({ type: Schema.Literal("percent"), rate: Schema.Int }),
  Schema.Struct({ type: Schema.Literal("fixed"), cents: Schema.Int }),
  Schema.Struct({ type: Schema.Literal("none") }),
]);
export type Discount = typeof Discount.Type;

export class Customer extends Schema.Class<Customer>("Customer")({
  id: Schema.String,
  name: Schema.String,
  tier: Tier,
  email: Schema.optionalKey(Schema.String),
}) {}

export class LineItem extends Schema.Class<LineItem>("LineItem")({
  sku: Schema.String,
  quantity: Schema.Int,
  "unit-cents": Schema.Int,
}) {}

export class EmptyCart extends Schema.TaggedError<EmptyCart>()("EmptyCart", {
  customer: Schema.String,
}) {}

export const tierDiscounts: { readonly [key: string]: Discount } = {
  free: { type: "none" },
  pro: { type: "percent", rate: 10 },
  enterprise: { type: "fixed", cents: 500 },
};

export const subtotal = (items: ReadonlyArray<LineItem>): number =>
  items.reduce<number>((total, item) => total + item.quantity * item["unit-cents"], 0);

export const discountFor = (customer: Customer): Discount =>
  Option.getOrElse(Option.fromUndefinedOr(tierDiscounts[customer.tier]), () => ({ type: "none" }));

export const applyDiscount = (discount: Discount, cents: number): number =>
  discount.type === "percent"
    ? cents - Math.trunc((cents * discount.rate) / 100)
    : discount.type === "fixed"
      ? Math.max(0, cents - discount.cents)
      : cents;

export const tierLabel = (tier: Tier): string =>
  tier === "free" ? "Free" : tier === "pro" ? "Pro" : "Enterprise";

export const contact = (customer: Customer): string =>
  Option.match(Option.fromUndefinedOr(customer.email), {
    onNone: () => customer.name,
    onSome: (address) => `${customer.name} <${address}>`,
  });

export const shout = (text: string): string => `${text.trim().toUpperCase()}!`;

export const skus = (items: ReadonlyArray<LineItem>): string =>
  items.filter((item) => item.quantity > 0).map((item) => item.sku).join(",");

export const upgrade = (customer: Customer): Customer =>
  new Customer({ ...customer, tier: customer.tier === "free" ? "pro" : "enterprise" });

export const loudNames = (customers: ReadonlyArray<Customer>): ReadonlyArray<string> => {
  const names = customers.map((customer) => customer.name);
  const sorted = [...names, ...["staff"]];
  return [...sorted, "everyone"].map(shout);
};

export const summarize = (
  customer: Customer,
  items: ReadonlyArray<LineItem>,
): Effect.Effect<string, EmptyCart> =>
  Effect.gen(function* () {
    const nonempty = items.filter((item) => item.quantity > 0);
    if (nonempty.length === 0) {
      yield* Effect.fail(new EmptyCart({ customer: customer.id }));
    }
    const gross = subtotal(nonempty);
    const net = applyDiscount(discountFor(customer), gross);
    const biggest = Option.fromUndefinedOr(nonempty.find((item) => nonempty.every((other) => item["unit-cents"] >= other["unit-cents"])));
    return `${contact(customer)} [${tierLabel(customer.tier)}] ${nonempty.length} items (${skus(nonempty)}), ${gross} -> ${net} cents${Option.match(biggest, { onNone: () => "", onSome: (item) => `, top ${item.sku}` })}`;
  });

export const outcomeLabel = (
  customer: Customer,
  items: ReadonlyArray<LineItem>,
): Effect.Effect<string> =>
  Effect.gen(function* () {
    const outcome = yield* Effect.result(summarize(customer, items));
    return Result.match(outcome, {
      onFailure: (error) => `empty cart for ${error.customer}`,
      onSuccess: (text) => text,
    });
  });

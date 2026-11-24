import assert from "node:assert/strict";
import { Effect, Layer } from "effect";
import { Audit, AuditDown, charged, chargedInline, Declined, free, freeInline, Stripe } from "./expected.js";

const logged: string[] = [];
const AuditTest = Layer.succeed(
  Audit,
  Audit.of({
    log: (message) => {
      logged.push(message);
      return Effect.void;
    },
  }),
);
const AuditDown_ = Layer.succeed(Audit, Audit.of({ log: () => Effect.fail(new AuditDown()) }));
const StripeTest = Layer.succeed(
  Stripe,
  Stripe.of({
    charge: (cents) => (cents > 100 ? Effect.fail(new Declined({ reason: "too much" })) : Effect.succeed(`charged ${cents}`)),
  }),
);

// The instantiated operation types are closed: `free` needs only Audit and can fail only with AuditDown.
const freeIsClosed: (n: number) => Effect.Effect<string, AuditDown, Audit> = free;
const chargedIsClosed: (n: number) => Effect.Effect<string, Declined | AuditDown, Stripe | Audit> = charged;
void freeIsClosed;
void chargedIsClosed;

export default async function check(): Promise<void> {
  // An effect-free callback needs no Stripe: only Audit is provided.
  assert.equal(await Effect.runPromise(Effect.provide(free(1), AuditTest)), "cached-1");
  assert.equal(await Effect.runPromise(Effect.provide(freeInline(2), AuditTest)), "cached-2");
  assert.deepEqual(logged, ["called", "called"]);

  const both = Layer.mergeAll(AuditTest, StripeTest);
  assert.equal(await Effect.runPromise(Effect.provide(charged(5), both)), "charged 5");
  assert.equal(await Effect.runPromise(Effect.provide(chargedInline(6), both)), "charged 6");

  // The callback's error passes through; the wrapper's own error comes from its audit call.
  const declined = await Effect.runPromise(Effect.flip(Effect.provide(charged(500), both)));
  assert.ok(declined instanceof Declined);
  const down = await Effect.runPromise(Effect.flip(Effect.provide(free(1), AuditDown_)));
  assert.ok(down instanceof AuditDown);
}

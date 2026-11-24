import { Context, Effect, Schema } from "effect";

export class Declined extends Schema.TaggedError<Declined>()("Declined", {
  reason: Schema.String,
}) {}

export class AuditDown extends Schema.TaggedError<AuditDown>()("AuditDown", {}) {}

export class Stripe extends Context.Service<
  Stripe,
  {
    readonly charge: (arg0: number) => Effect.Effect<string, Declined>;
  }
>()("Stripe") {}

export class Audit extends Context.Service<
  Audit,
  {
    readonly log: (arg0: string) => Effect.Effect<void, AuditDown>;
  }
>()("Audit") {}

export const charge = (n: number): Effect.Effect<string, Declined, Stripe> =>
  Effect.gen(function* () {
    const stripe = yield* Stripe;
    return yield* stripe.charge(n);
  });

export const lookupCached = (n: number): Effect.Effect<string> =>
  Effect.gen(function* () {
    return `cached-${n}`;
  });

export const withAudit = <A0, E, R>(
  f: (arg0: number) => Effect.Effect<A0, E, R>,
  n: number,
): Effect.Effect<A0, AuditDown | E, Audit | R> =>
  Effect.gen(function* () {
    const audit = yield* Audit;
    const v = yield* f(n);
    yield* audit.log("called");
    return v;
  });

export const charged = (n: number): Effect.Effect<string, Declined | AuditDown, Audit | Stripe> =>
  Effect.gen(function* () {
    return yield* withAudit(charge, n);
  });

export const chargedInline = (
  n: number,
): Effect.Effect<string, Declined | AuditDown, Audit | Stripe> =>
  Effect.gen(function* () {
    const stripe = yield* Stripe;
    return yield* withAudit((m) => stripe.charge(m), n);
  });

export const free = (n: number): Effect.Effect<string, AuditDown, Audit> =>
  Effect.gen(function* () {
    return yield* withAudit(lookupCached, n);
  });

export const freeInline = (n: number): Effect.Effect<string, AuditDown, Audit> =>
  Effect.gen(function* () {
    return yield* withAudit((m) => lookupCached(m), n);
  });

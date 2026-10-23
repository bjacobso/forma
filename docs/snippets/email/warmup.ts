import { Context, Effect, Option, Record, Schema } from "effect";

export const EmailLane = Schema.Literals(["gmail", "default"]);
export type EmailLane = typeof EmailLane.Type;

export const EmailContact = Schema.Struct({
  email: Schema.String,
  domain: Schema.String,
  tags: Schema.Array(Schema.String),
  "due-in": Schema.Record(Schema.String, Schema.Int),
});
export type EmailContact = typeof EmailContact.Type;

export const EmailDecision = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal("Send"), lane: EmailLane }),
  Schema.Struct({ _tag: Schema.Literal("Defer"), hours: Schema.Int }),
  Schema.Struct({ _tag: Schema.Literal("Skip"), reason: Schema.String }),
]);
export type EmailDecision = typeof EmailDecision.Type;

export class RateLimited extends Schema.TaggedError<RateLimited>()("RateLimited", {
  "retry-in-hours": Schema.Int,
}) {}

export class Bounced extends Schema.TaggedError<Bounced>()("Bounced", {
  reason: Schema.String,
}) {}

export class Mailer extends Context.Service<
  Mailer,
  {
    readonly deliver: (arg0: EmailLane, arg1: string) => Effect.Effect<void, RateLimited | Bounced>;
  }
>()("Mailer") {}

export const launchWarmup3 = (contact: EmailContact): EmailDecision =>
  isDue(contact, "value-path", 6) ? defer(6) : isTag(contact, "customer") ? skip("already bought") : isDomain(contact, "gmail.com") ? send("gmail") : send("default");

export const emailLanePerHour = (lane: EmailLane): number => lane === "gmail" ? 2000 : 16000;

export const send = (lane: EmailLane): EmailDecision => ({ _tag: "Send", lane });

export const defer = (hours: number): EmailDecision => ({ _tag: "Defer", hours });

export const skip = (reason: string): EmailDecision => ({ _tag: "Skip", reason });

export const isTag = (contact: EmailContact, tag: string): boolean => contact.tags.includes(tag);

export const isDomain = (contact: EmailContact, domain: string): boolean =>
  contact.domain === domain;

export const isDue = (contact: EmailContact, journey: string, hours: number): boolean =>
  Option.match(Record.get(contact["due-in"], journey), {
    onNone: () => false,
    onSome: (next) => next <= hours,
  });

export const runWarmup = (contact: EmailContact): Effect.Effect<EmailDecision, never, Mailer> =>
  Effect.gen(function* () {
    const mailer = yield* Mailer;
    const decision = launchWarmup3(contact);
    switch (decision._tag) {
      case "Send": {
        const s = decision;
        return yield* Effect.catchTags(
          Effect.gen(function* () {
            yield* mailer.deliver(s.lane, contact.email);
            return decision;
          }),
          {
            RateLimited: (e) => Effect.succeed(defer(e["retry-in-hours"])),
            Bounced: (e) => Effect.succeed(skip(e.reason)),
          },
        );
      }
      case "Defer": {
        return decision;
      }
      case "Skip": {
        return decision;
      }
    }
  });

export const LaunchWarmup3 = { "name": "launch-warmup-3", "decide": launchWarmup3, "perHour": emailLanePerHour };

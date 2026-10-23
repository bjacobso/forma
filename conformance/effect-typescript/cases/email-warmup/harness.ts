import assert from "node:assert/strict";
import { Effect, Layer } from "effect";
import { Bounced, LaunchWarmup3, Mailer, RateLimited, runWarmup, type EmailContact, type EmailLane } from "./expected.js";

const contact = (fields: Partial<EmailContact>): EmailContact =>
  ({ email: "ada@example.com", domain: "example.com", tags: [], "due-in": {}, ...fields });

export default async function check(): Promise<void> {
  // First match wins, and every contact gets exactly one decision.
  assert.equal(LaunchWarmup3.name, "launch-warmup-3");
  assert.deepEqual(LaunchWarmup3.decide(contact({ "due-in": { "value-path": 4 }, tags: ["customer"] })), { _tag: "Defer", hours: 6 });
  assert.deepEqual(LaunchWarmup3.decide(contact({ "due-in": { "value-path": 30 }, tags: ["customer"] })), { _tag: "Skip", reason: "already bought" });
  assert.deepEqual(LaunchWarmup3.decide(contact({ domain: "gmail.com" })), { _tag: "Send", lane: "gmail" });
  assert.deepEqual(LaunchWarmup3.decide(contact({})), { _tag: "Send", lane: "default" });
  assert.equal(LaunchWarmup3.perHour("gmail"), 2000);
  assert.equal(LaunchWarmup3.perHour("default"), 16000);

  // Delivery runs only for Send, on the decided lane, and maps every typed failure to a decision.
  const sent: [EmailLane, string][] = [];
  const recording = Layer.succeed(Mailer, { deliver: (lane, email) => Effect.sync(() => { sent.push([lane, email]); }) });
  const gmail = contact({ email: "grace@gmail.com", domain: "gmail.com" });
  assert.deepEqual(await Effect.runPromise(runWarmup(gmail).pipe(Effect.provide(recording))), { _tag: "Send", lane: "gmail" });
  assert.deepEqual(await Effect.runPromise(runWarmup(contact({ tags: ["customer"] })).pipe(Effect.provide(recording))), { _tag: "Skip", reason: "already bought" });
  assert.deepEqual(sent, [["gmail", "grace@gmail.com"]]);
  const limited = Layer.succeed(Mailer, { deliver: () => Effect.fail(new RateLimited({ "retry-in-hours": 2 })) });
  assert.deepEqual(await Effect.runPromise(runWarmup(gmail).pipe(Effect.provide(limited))), { _tag: "Defer", hours: 2 });
  const bounced = Layer.succeed(Mailer, { deliver: () => Effect.fail(new Bounced({ reason: "mailbox full" })) });
  assert.deepEqual(await Effect.runPromise(runWarmup(gmail).pipe(Effect.provide(bounced))), { _tag: "Skip", reason: "mailbox full" });
}

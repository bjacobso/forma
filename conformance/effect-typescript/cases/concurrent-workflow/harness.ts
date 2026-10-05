import assert from "node:assert/strict";
import { Effect, Layer, Option } from "effect";
import {
  Activities,
  compareActivity,
  dashboard,
  dashboards,
  dashboardWithin,
  fastestProfile,
  heartbeat,
  Metrics,
  Profiles,
  trackAll,
  Unavailable,
} from "./expected.js";

function adapters() {
  const calls: string[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const flakyFailures = new Map<string, number>([["flaky", 2], ["broken", 5]]);
  const profiles = Profiles.of({
    fetch: (id) =>
      Effect.gen(function* () {
        calls.push(`profile ${id}`);
        const remaining = flakyFailures.get(id) ?? 0;
        if (remaining > 0) {
          flakyFailures.set(id, remaining - 1);
          return yield* Effect.fail(new Unavailable({ service: "profiles" }));
        }
        if (id === "slow") yield* Effect.sleep(200);
        return { id, name: id.toUpperCase() };
      }),
    cached: (id) => Effect.succeed({ id, name: `${id.toUpperCase()} (cached)` }).pipe(Effect.delay(5)),
  });
  const activities = Activities.of({
    fetch: (id) =>
      Effect.gen(function* () {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        yield* Effect.sleep(id === "slow" ? 200 : 10);
        return { id, events: id.length };
      }).pipe(Effect.ensuring(Effect.sync(() => { inFlight--; }))),
  });
  const tracked: string[] = [];
  const metrics = Metrics.of({ track: (name, value) => Effect.sync(() => { tracked.push(`${name}=${value}`); }) });
  const layer = Layer.mergeAll(
    Layer.succeed(Profiles, profiles),
    Layer.succeed(Activities, activities),
    Layer.succeed(Metrics, metrics),
  );
  return {
    calls,
    tracked,
    layer,
    maxInFlight: () => maxInFlight,
    resetInFlight: () => {
      maxInFlight = 0;
    },
  };
}

export default async function check(): Promise<void> {
  const { calls, tracked, layer, maxInFlight, resetInFlight } = adapters();
  const run = <A, E>(effect: Effect.Effect<A, E, Profiles | Activities | Metrics>) =>
    Effect.runPromise(Effect.provide(effect, layer));

  assert.deepEqual(await run(dashboard("ada")), {
    profile: { id: "ada", name: "ADA" },
    activity: { id: "ada", events: 3 },
    score: 30,
  });

  // Two failures are retried; the third attempt succeeds.
  const flaky = await run(dashboard("flaky"));
  assert.equal(flaky.profile.name, "FLAKY");
  assert.equal(calls.filter((call) => call === "profile flaky").length, 3);

  // A failure that outlasts the retry policy surfaces as a typed error.
  const broken = await run(Effect.flip(dashboard("broken")));
  assert.ok(broken instanceof Unavailable);
  assert.equal(broken.service, "profiles");

  resetInFlight();
  const boards = await run(dashboards(["a", "bb", "ccc", "dddd", "eeeee"]));
  assert.deepEqual(boards.map((board) => board.score), [10, 20, 30, 40, 50]);
  // Each dashboard fetches one activity; batches run two dashboards at a time.
  assert.ok(maxInFlight() <= 2, `max in flight ${maxInFlight()}`);
  assert.equal(maxInFlight(), 2);

  assert.equal((await run(fastestProfile("slow"))).name, "SLOW (cached)");

  assert.ok(Option.isNone(await run(dashboardWithin("slow", 30))));
  const inTime = await run(dashboardWithin("ada", 1_000));
  assert.ok(Option.isSome(inTime));
  assert.equal(inTime.value.score, 30);

  const [left, right] = await run(compareActivity("x", "yy"));
  assert.deepEqual([left.events, right.events], [1, 2]);

  assert.equal(await run(trackAll(["a", "b", "c"])), 3);
  assert.deepEqual([...tracked].sort(), ["a=1", "b=1", "c=1"]);

  // repeat runs once and then repeats `beats` times on the schedule.
  tracked.length = 0;
  await run(heartbeat(2));
  assert.deepEqual(tracked, ["heartbeat=1", "heartbeat=1", "heartbeat=1"]);
}

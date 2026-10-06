import { Context, Duration, Effect, Fiber, Option, Ref, Schedule, Schema } from "effect";

export const Profile = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
});
export type Profile = typeof Profile.Type;

export const Activity = Schema.Struct({
  id: Schema.String,
  events: Schema.Int,
});
export type Activity = typeof Activity.Type;

export const Dashboard = Schema.Struct({
  profile: Profile,
  activity: Activity,
  score: Schema.Int,
});
export type Dashboard = typeof Dashboard.Type;

export class Unavailable extends Schema.TaggedError<Unavailable>()("Unavailable", {
  service: Schema.String,
}) {}

export class Profiles extends Context.Service<
  Profiles,
  {
    readonly fetch: (arg0: string) => Effect.Effect<Profile, Unavailable>;
    readonly cached: (arg0: string) => Effect.Effect<Profile, Unavailable>;
  }
>()("Profiles") {}

export class Activities extends Context.Service<
  Activities,
  {
    readonly fetch: (arg0: string) => Effect.Effect<Activity, Unavailable>;
  }
>()("Activities") {}

export class Metrics extends Context.Service<
  Metrics,
  {
    readonly track: (arg0: string, arg1: number) => Effect.Effect<void>;
  }
>()("Metrics") {}

export const dashboard = (
  id: string,
): Effect.Effect<Dashboard, Unavailable, Activities | Profiles> =>
  Effect.gen(function* () {
    const activities = yield* Activities;
    const profiles = yield* Profiles;
    const parts = yield* Effect.all(
      {
        profile: Effect.retry(
          profiles.fetch(id),
          { times: 2, schedule: Schedule.exponential(Duration.millis(1)) },
        ),
        activity: activities.fetch(id),
      },
      { concurrency: "unbounded" },
    );
    return {
      profile: parts.profile,
      activity: parts.activity,
      score: 10 * parts.activity.events,
    };
  });

export const dashboards = (
  ids: ReadonlyArray<string>,
): Effect.Effect<ReadonlyArray<Dashboard>, Unavailable, Activities | Profiles> =>
  Effect.gen(function* () {
    return yield* Effect.forEach(ids, (id) => dashboard(id), { concurrency: 2 });
  });

export const fastestProfile = (id: string): Effect.Effect<Profile, Unavailable, Profiles> =>
  Effect.gen(function* () {
    const profiles = yield* Profiles;
    return yield* Effect.race(profiles.fetch(id), profiles.cached(id));
  });

export const dashboardWithin = (
  id: string,
  millis: number,
): Effect.Effect<Option.Option<Dashboard>, Unavailable, Activities | Profiles> =>
  Effect.gen(function* () {
    return yield* Effect.catchTag(
      Effect.gen(function* () {
        const board = yield* Effect.timeout(dashboard(id), millis);
        return Option.some(board);
      }),
      "TimeoutError",
      () => Effect.succeed(Option.none()),
    );
  });

export const compareActivity = (
  left: string,
  right: string,
): Effect.Effect<readonly [Activity, Activity], Unavailable, Activities> =>
  Effect.gen(function* () {
    const activities = yield* Activities;
    return yield* Effect.all([activities.fetch(left), activities.fetch(right)], { concurrency: 2 });
  });

export const trackAll = (names: ReadonlyArray<string>): Effect.Effect<number, never, Metrics> =>
  Effect.gen(function* () {
    const metrics = yield* Metrics;
    const counter = yield* Ref.make<number>(0);
    const worker = yield* Effect.forkChild(Effect.forEach(
      names,
      (name) => Effect.gen(function* () {
        yield* Effect.sleep(Duration.millis(1));
        yield* Ref.update(counter, (n) => n + 1);
        return yield* metrics.track(name, 1);
      }),
      { concurrency: "unbounded" },
    ));
    yield* Fiber.join(worker);
    const total = yield* Ref.get(counter);
    return total;
  });

export const heartbeat = (beats: number): Effect.Effect<void, never, Metrics> =>
  Effect.gen(function* () {
    const metrics = yield* Metrics;
    return yield* Effect.repeat(metrics.track("heartbeat", 1), { times: beats, schedule: Schedule.spaced(1) });
  });

import { Context, Effect, Schema } from "effect";

export const Issue = Schema.Struct({
  number: Schema.Int,
  title: Schema.String,
  "idle-days": Schema.Int,
});
export type Issue = typeof Issue.Type;

export class RateLimited extends Schema.TaggedError<RateLimited>()("RateLimited", {
  "retry-after": Schema.Int,
}) {}

export class GitHub extends Context.Service<
  GitHub,
  {
    readonly listIssues: (arg0: { readonly repo: string; readonly state: "open" | "closed" }) => Effect.Effect<ReadonlyArray<Issue>, RateLimited>;
    readonly closeIssue: (arg0: { readonly repo: string; readonly number: number }) => Effect.Effect<void>;
  }
>()("GitHub") {}

export class Slack extends Context.Service<
  Slack,
  {
    readonly postMessage: (arg0: { readonly channel: string; readonly text: string }) => Effect.Effect<{ readonly ts: string }>;
  }
>()("Slack") {}

export const isStale = (issue: Issue): boolean => issue["idle-days"] > 14;

export const line = (issue: Issue): string => `#${issue.number} ${issue.title}`;

export const openIssues: Effect.Effect<ReadonlyArray<Issue>, never, GitHub> =
  Effect.gen(function* () {
    const gitHub = yield* GitHub;
    return yield* Effect.catchTag(
      gitHub.listIssues({ repo: "acme/api", state: "open" }),
      "RateLimited",
      () => Effect.succeed([]),
    );
  });

export const main: Effect.Effect<string, never, GitHub | Slack> =
  Effect.gen(function* () {
    const slack = yield* Slack;
    const issues = yield* openIssues;
    const stale = issues.filter(isStale);
    if (stale.length === 0) {
      return "Nothing stale.";
    } else {
      const posted = yield* slack.postMessage({ channel: "#eng", text: stale.map(line).join("\n") });
      return `${stale.length} stale issues posted at ${posted.ts}`;
    }
  });

import assert from "node:assert/strict";
import { Effect, Layer, Schema } from "effect";
import { GitHub, Issue, RateLimited, Slack, main } from "./expected.js";

/** A code-mode program's only exit: one tool path and its input, as Executor's `call` tool takes them. */
interface ToolCall {
  readonly path: string;
  readonly input: Readonly<Record<string, string | number>>;
}
type ToolResult = { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly retryAfter: number };

const Issues = Schema.Array(Issue);
const Posted = Schema.Struct({ ts: Schema.String });

/**
 * The host side: each catalog member routes to one Executor tool path. Outputs
 * are untrusted JSON, so they are decoded with the catalog's schemas; the only
 * declared failure, RateLimited, becomes the typed error. The journal records
 * every call in order.
 */
function executorLayer(answer: (call: ToolCall) => ToolResult) {
  const journal: ToolCall[] = [];
  const call = (path: string, input: ToolCall["input"]) =>
    Effect.sync(() => {
      const request = { path, input };
      journal.push(request);
      return answer(request);
    });
  const layer = Layer.mergeAll(
    Layer.succeed(GitHub, GitHub.of({
      listIssues: (input) =>
        Effect.flatMap(call("github.listIssues", input), (result) =>
          result.ok
            ? Effect.orDie(Schema.decodeUnknownEffect(Issues)(result.value))
            : Effect.fail(new RateLimited({ "retry-after": result.retryAfter }))),
      closeIssue: (input) => Effect.asVoid(call("github.closeIssue", input)),
    })),
    Layer.succeed(Slack, Slack.of({
      postMessage: (input) =>
        Effect.flatMap(call("slack.postMessage", input), (result) =>
          result.ok ? Effect.orDie(Schema.decodeUnknownEffect(Posted)(result.value)) : Effect.die("unexpected failure")),
    })),
  );
  return { journal, layer };
}

const issues = [
  { number: 12, title: "Flaky deploy", "idle-days": 30 },
  { number: 18, title: "Docs typo", "idle-days": 2 },
  { number: 31, title: "Retry webhooks", "idle-days": 21 },
];

export default async function check(): Promise<void> {
  // Two stale issues: one read, one post, in that order, with the rendered digest.
  const live = executorLayer(({ path }) =>
    path === "github.listIssues" ? { ok: true, value: issues } : { ok: true, value: { ts: "1729.42" } });
  assert.equal(await Effect.runPromise(Effect.provide(main, live.layer)), "2 stale issues posted at 1729.42");
  assert.deepEqual(live.journal, [
    { path: "github.listIssues", input: { repo: "acme/api", state: "open" } },
    { path: "slack.postMessage", input: { channel: "#eng", text: "#12 Flaky deploy\n#31 Retry webhooks" } },
  ]);

  // A rate limit is recovered inside the program; nothing is posted.
  const limited = executorLayer(() => ({ ok: false, retryAfter: 30 }));
  assert.equal(await Effect.runPromise(Effect.provide(main, limited.layer)), "Nothing stale.");
  assert.deepEqual(limited.journal.map((call) => call.path), ["github.listIssues"]);

  // Tool output that does not match the catalog schema is a defect at the boundary, not a value.
  const malformed = executorLayer(() => ({ ok: true, value: [{ number: "12", title: "Flaky deploy" }] }));
  const exit = await Effect.runPromiseExit(Effect.provide(main, malformed.layer));
  assert.equal(exit._tag, "Failure");
  assert.deepEqual(malformed.journal.map((call) => call.path), ["github.listIssues"]);

  // Manifest: no run touched a tool outside [GitHub.list-issues Slack.post-message].
  for (const call of [...live.journal, ...limited.journal, ...malformed.journal]) {
    assert.ok(["github.listIssues", "slack.postMessage"].includes(call.path));
  }
}

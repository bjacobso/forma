import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DurableDeferred, HumanTask } from "@smthrs/flow";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { compile } from "./compile.ts";
import { link, type Handler } from "./runtime.ts";
import { nodeCrypto } from "./node-host.ts";

export const prelude = readFileSync(new URL("./prelude.forma", import.meta.url), "utf8");
export const source = readFileSync(new URL("./example.forma", import.meta.url), "utf8");

export function fixtures(options: { pass?: boolean; failPublish?: boolean } = {}) {
  const trace: string[] = [];
  let checks = 0;
  const handlers: Record<string, Handler> = {
    implement: payload => Effect.sync(() => {
      trace.push(`implement: ${payload.issue}`);
      return { revision: "patch-123", summary: "Handle the reported edge case" };
    }),
    "test-patch": () => Effect.sync(() => {
      trace.push("test"); return { passed: options.pass ?? true };
    }),
    "review-patch": () => Effect.sync(() => {
      trace.push("review"); return { approved: true };
    }),
    "publish-patch": () => Effect.suspend(() => {
      trace.push("publish");
      return options.failPublish ? Effect.fail("Publish unavailable") : Effect.succeed("https://example.test/releases/patch-123");
    }),
    "deployment-status": () => Effect.sync(() => {
      trace.push("deployment-status");
      return { done: ++checks >= 2, value: "https://example.test/releases/patch-123" };
    }),
  };
  return { trace, handlers };
}

export async function runDemo(approve = true, options: Parameters<typeof fixtures>[0] = {}) {
  const program = compile(prelude, source);
  const { trace, handlers } = fixtures(options);
  const linked = link(program, handlers);
  const flow = linked.flows.get("resolve-issue")!;
  const executionId = "forma-smithers-demo";
  const payload = { issue: "Fix issue #42" };
  const work = Effect.gen(function*() {
    yield* flow.execute(payload, { executionId, discard: true });
    // Read the native run state before answering, just as an approvals UI does.
    for (let attempt = 0; ; attempt++) {
      const result = yield* flow.poll(executionId);
      if (Option.isSome(result) && result.value._tag === "Suspended") break;
      if (Option.isSome(result) && result.value._tag === "Complete") throw new Error("Run completed before approval.");
      if (attempt >= 100) throw new Error("Run did not reach approval.");
      yield* Effect.sleep(5);
    }
    trace.push("awaiting approval");
    const token = DurableDeferred.tokenFromExecutionId(HumanTask.deferred("question", 1), { flow, executionId });
    yield* HumanTask.answer({ token, value: approve });

    const result = yield* flow.execute(payload, { executionId });
    return { result, trace };
  });
  return Effect.runPromise(work.pipe(Effect.timeout(15000),
    Effect.provide(linked.layer().pipe(Layer.provideMerge(nodeCrypto)))) as Effect.Effect<{ result: string; trace: string[] }, unknown>);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await runDemo(), null, 2));
}

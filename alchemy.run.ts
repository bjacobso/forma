import * as Alchemy from "alchemy";
import { AlchemyContext } from "alchemy/AlchemyContext";
import { renamedFrom } from "alchemy/Rename";
import { localState } from "alchemy/State";
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import Website, { PlaygroundsBucket, WebsiteBuild } from "./apps/website/src/worker.ts";

// `alchemy dev` runs entirely locally with zero Cloudflare credentials; real
// plan/deploy/destroy stages use the shared Cloudflare state store.
const state = Layer.unwrap(
  Effect.map(AlchemyContext, (ctx) => (ctx.dev ? localState() : Cloudflare.state())),
);

export default Alchemy.Stack(
  "forma-lang",
  { providers: Cloudflare.providers(), state },
  Effect.gen(function* () {
    const ctx = yield* AlchemyContext;
    yield* PlaygroundsBucket;
    if (!ctx.dev) yield* WebsiteBuild;
    const website = yield* Website.pipe(renamedFrom("Website/Worker"));
    return { url: website.url };
  }),
);

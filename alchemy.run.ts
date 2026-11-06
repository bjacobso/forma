import * as Alchemy from "alchemy";
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Effect from "effect/Effect";
import * as RemovalPolicy from "alchemy/RemovalPolicy";

export default Alchemy.Stack(
  "forma-lang",
  { providers: Cloudflare.providers(), state: Cloudflare.state() },
  Effect.gen(function* () {
    const stage = yield* Alchemy.Stage;
    const playgrounds = yield* Cloudflare.R2.Bucket("Playgrounds", {
      name: stage === "prod" ? "forma-playgrounds" : `forma-playgrounds-${stage}`,
      forceDestroy: stage !== "prod",
    }).pipe(RemovalPolicy.retain(stage === "prod"));
    const website = yield* Cloudflare.Website.StaticSite("Website", {
      name: stage === "prod" ? "forma-website" : `forma-website-${stage}`,
      ...(stage === "prod" ? { domain: "forma-lang.com" } : {}),
      command: "pnpm website:build",
      outdir: "dist-site",
      main: "apps/website/src/worker.ts",
      compatibility: { date: "2026-06-10" },
      workersDev: true,
      env: {
        PLAYGROUNDS: playgrounds,
        PLAYGROUND_WRITES: Cloudflare.Workers.RateLimit("PlaygroundWrites", {
          namespaceId: 1001,
          simple: { limit: 10, period: 60 },
        }),
      },
      assets: {
        htmlHandling: "auto-trailing-slash",
        notFoundHandling: "404-page",
        runWorkerFirst: ["/playground", "/playground/*", "/about", "/demo", "/demo/*", "/workbench/demo", "/workbench/demo/"],
      },
      dev: { command: "pnpm dev" },
    });
    return { url: website.url };
  }),
);

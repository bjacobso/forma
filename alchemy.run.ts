import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";

export default Alchemy.Stack(
  "forma-lang",
  { providers: Cloudflare.providers(), state: Cloudflare.state() },
  Effect.gen(function* () {
    const stage = yield* Alchemy.Stage;
    const website = yield* Cloudflare.Website.StaticSite("Website", {
      name: stage === "prod" ? "forma-website" : `forma-website-${stage}`,
      ...(stage === "prod" ? { domain: "forma-lang.com" } : {}),
      command: "pnpm website:build",
      outdir: "apps/website/dist",
      main: "apps/website/src/worker.ts",
      compatibility: { date: "2026-06-10" },
      workersDev: true,
      assets: {
        htmlHandling: "none",
        notFoundHandling: "single-page-application",
        runWorkerFirst: ["/", "/about", "/demo", "/demo/*"],
      },
      dev: { command: "pnpm dev" },
    });
    return { url: website.url };
  }),
);

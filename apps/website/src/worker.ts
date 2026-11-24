/**
 * Effect-native Cloudflare Worker for forma-lang.com, defined and run end to
 * end with Alchemy (`Cloudflare.Worker`, `Cloudflare.DurableObject`,
 * `Cloudflare.R2.ReadWriteBucket`, `Cloudflare.Workers.RateLimit`).
 */
import * as Alchemy from "alchemy";
import { AlchemyContext } from "alchemy/AlchemyContext";
import * as Command from "alchemy/Command";
import * as Namespace from "alchemy/Namespace";
import * as RemovalPolicy from "alchemy/RemovalPolicy";
import type { RuntimeContext } from "alchemy/RuntimeContext";
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import { galleryDescription, plainText, playgroundDescription } from "./lib/siteCopy";
import { FORMA_WORKBENCH_URL } from "./lib/workbenchLocation";
import { getPipeline } from "./pipelines";
import {
  loadPlayground,
  playgroundApi,
  type PlaygroundEnv,
  type PlaygroundStorage,
} from "./playgroundStore";
import {
  McpRateLimit,
  ReplSessionClient,
  handleMcp,
  isMcpRequest,
} from "./mcp";
import { ReplSessionError } from "./mcpSchema";
import { ReplSession, ReplSessionLive } from "./replSession";

// ---------------------------------------------------------------------------
// Static site routing & resource declarations
// ---------------------------------------------------------------------------

export const RUN_WORKER_FIRST = [
  "/feed.xml",
  "/sitemap.xml",
  "/robots.txt",
  "/playground",
  "/playground/*",
  "/about",
  "/demo",
  "/demo/*",
  "/workbench/demo",
  "/workbench/demo/",
  "/mcp",
  "/mcp/",
] as const;

export const PlaygroundsBucket = Effect.gen(function* () {
  const stage = yield* Alchemy.Stage;
  return yield* Cloudflare.R2.Bucket("Playgrounds", {
    name: stage === "prod" ? "forma-playgrounds" : `forma-playgrounds-${stage}`,
    forceDestroy: stage !== "prod",
  }).pipe(RemovalPolicy.retain(stage === "prod"));
});

// ---------------------------------------------------------------------------
// Effect services for the Worker's HTTP router
// ---------------------------------------------------------------------------

export class StaticAssets extends Context.Service<
  StaticAssets,
  {
    readonly fetch: (request: Request) => Effect.Effect<Response>;
  }
>()("forma/StaticAssets") {}

export class PlaygroundService extends Context.Service<
  PlaygroundService,
  {
    readonly env: PlaygroundEnv;
  }
>()("forma/PlaygroundService") {
  static readonly Empty = Layer.succeed(PlaygroundService, { env: {} });
}

interface RouteMeta {
  readonly title: string;
  readonly description: string;
  readonly path: string;
}

const DISCOVERY_TYPES: Record<string, string> = {
  "/feed.xml": "application/atom+xml",
  "/sitemap.xml": "application/xml",
  "/robots.txt": "text/plain",
};

const toWebRequest = (request: HttpServerRequest.HttpServerRequest): Effect.Effect<Request> =>
  HttpServerRequest.toWeb(request).pipe(Effect.orDie);

/**
 * Pure Effect HTTP handler for the entire forma-lang.com Worker.
 * Runs inside Alchemy's `Cloudflare.Worker` in production/`alchemy dev`, and
 * directly against in-memory Effect Layers in unit tests.
 */
export const websiteFetch: Effect.Effect<
  HttpServerResponse.HttpServerResponse,
  never,
  HttpServerRequest.HttpServerRequest | StaticAssets | PlaygroundService | McpRateLimit | ReplSessionClient
> = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const webRequest = yield* toWebRequest(request);
  const requestUrl = new URL(webRequest.url);

  // MCP clients post to /mcp; browsers keep getting the MCP docs page there.
  if (
    (requestUrl.pathname === "/mcp" || requestUrl.pathname === "/mcp/") &&
    isMcpRequest(request)
  ) {
    return yield* handleMcp;
  }

  const assets = yield* StaticAssets;
  const playground = yield* PlaygroundService;

  if (
    requestUrl.pathname === "/playground/api/playgrounds" ||
    requestUrl.pathname.startsWith("/playground/api/playgrounds/")
  ) {
    const response = yield* Effect.tryPromise(() => playgroundApi(webRequest, playground.env)).pipe(
      Effect.catch(() =>
        Effect.succeed(
          Response.json(
            { error: "Playground storage is temporarily unavailable." },
            { status: 503 },
          ),
        ),
      ),
    );
    return HttpServerResponse.fromWeb(response);
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    return HttpServerResponse.fromWeb(yield* assets.fetch(webRequest));
  }

  const url = new URL(webRequest.url);
  const discoveryType = DISCOVERY_TYPES[url.pathname];
  if (discoveryType) {
    const response = yield* assets.fetch(webRequest);
    if (response.headers.get("content-type")?.includes("text/html")) {
      return HttpServerResponse.text("Not found", { status: 404 });
    }
    const headers = new Headers(response.headers);
    headers.set("content-type", `${discoveryType}; charset=utf-8`);
    return HttpServerResponse.fromWeb(
      new Response(response.body, { status: response.status, headers }),
    );
  }

  if (["/about", "/about/", "/playground/about", "/playground/about/"].includes(url.pathname)) {
    return HttpServerResponse.fromWeb(
      Response.redirect(new URL("/language", url).toString(), 301),
    );
  }

  if (url.pathname === "/workbench/demo" || url.pathname === "/workbench/demo/") {
    const destination = new URL(FORMA_WORKBENCH_URL);
    destination.search = url.search;
    return HttpServerResponse.fromWeb(Response.redirect(destination.toString(), 302));
  }

  if (url.pathname === "/demo" || url.pathname.startsWith("/demo/")) {
    url.pathname = `/playground${url.pathname}`;
    return HttpServerResponse.fromWeb(Response.redirect(url.toString(), 301));
  }

  const pathname =
    url.pathname === "/playground"
      ? "/"
      : url.pathname.startsWith("/playground/")
        ? url.pathname.slice("/playground".length)
        : null;
  let meta = pathname === null ? null : metaForPath(pathname);
  const sharedId = pathname?.match(/^\/p\/([a-f0-9]{32})$/)?.[1];

  if (pathname?.startsWith("/p/")) {
    const loaded = yield* Effect.tryPromise(() =>
      sharedId ? loadPlayground(playground.env, sharedId) : Promise.resolve(null),
    ).pipe(
      Effect.map((demo) => ({ ok: true as const, demo })),
      Effect.catch(() => Effect.succeed({ ok: false as const })),
    );
    if (!loaded.ok) {
      return HttpServerResponse.text("Playground storage is temporarily unavailable.", {
        status: 503,
      });
    }
    if (!loaded.demo) {
      return HttpServerResponse.text("Playground not found.", { status: 404 });
    }
    meta = {
      title: `${loaded.demo.title} - Forma`,
      description:
        "Explore this language: edit its prelude and example, and inspect the typed IR in your browser.",
      path: pathname,
    };
  }

  if (!meta) {
    return HttpServerResponse.fromWeb(yield* assets.fetch(webRequest));
  }

  const indexUrl = new URL("/playground/", url);
  const response = yield* assets.fetch(new Request(indexUrl, webRequest));
  const html = yield* Effect.promise(() => response.text());
  const headers = new Headers(response.headers);
  headers.set("content-type", "text/html; charset=utf-8");

  return HttpServerResponse.fromWeb(
    new Response(injectMeta(html, meta, "https://forma-lang.com"), {
      status: response.status,
      statusText: response.statusText,
      headers,
    }),
  );
});

/**
 * Convenience helper for running `websiteFetch` against a Web `Request` with
 * explicit Effect Layers (used in unit tests).
 */
export function runWebsiteRequest(
  request: Request,
  services: Layer.Layer<StaticAssets | PlaygroundService | McpRateLimit | ReplSessionClient>,
): Promise<Response> {
  return websiteFetch.pipe(
    Effect.provideService(
      HttpServerRequest.HttpServerRequest,
      HttpServerRequest.fromWeb(request),
    ),
    Effect.provide(services),
    Effect.map((response) => HttpServerResponse.toWeb(response)),
    Effect.runPromise,
  );
}

// ---------------------------------------------------------------------------
// Alchemy Effect-native Worker definition
// ---------------------------------------------------------------------------

export const WebsiteBuild = Command.Build("Build", {
  command: "pnpm website:build",
  outdir: "dist-site",
}).pipe(Namespace.push("Website"));

const websiteProps = Effect.gen(function* () {
  // At runtime inside workerd, props like static asset build/upload are unused;
  // Rolldown folds `globalThis.__ALCHEMY_RUNTIME__` to `true` and dead-code-eliminates this branch.
  if (globalThis.__ALCHEMY_RUNTIME__) {
    return { main: import.meta.url };
  }
  const stage = yield* Alchemy.Stage;
  const ctx = yield* AlchemyContext;
  // In `alchemy dev`, serve the prebuilt `dist-site/` directly instead of running
  // `Command.Build` (`turbo run build`) inside alchemy's own file-watcher loop,
  // where `tsdown` cleaning `packages/ts/dist/` trips a stack reload mid-build.
  const assets = ctx.dev
    ? {
        directory: "dist-site",
        htmlHandling: "auto-trailing-slash" as const,
        notFoundHandling: "404-page" as const,
        runWorkerFirst: [...RUN_WORKER_FIRST],
      }
    : yield* Effect.map(WebsiteBuild, (build) => ({
        directory: build.outdir,
        hash: build.hash.output,
        htmlHandling: "auto-trailing-slash" as const,
        notFoundHandling: "404-page" as const,
        runWorkerFirst: [...RUN_WORKER_FIRST],
      }));

  return {
    name: stage === "prod" ? "forma-website" : `forma-website-${stage}`,
    ...(stage === "prod" ? { domain: "forma-lang.com" } : {}),
    main: import.meta.url,
    compatibility: { date: "2026-06-10" },
    workersDev: true,
    assets,
    dev: {
      host: "127.0.0.1",
      port: 5182,
    },
  };
});

/**
 * Adapts Alchemy's Effect-native R2 & RateLimit clients into `PlaygroundEnv`
 * using the current request's `RuntimeContext`.
 */
function makePlaygroundEnv(
  playgrounds: Cloudflare.R2.ReadWriteBucketClient,
  playgroundWrites: Cloudflare.Workers.RateLimitClient,
  runtimeContext: Context.Context<RuntimeContext>,
): PlaygroundEnv {
  const storage: PlaygroundStorage = {
    get: (key) =>
      playgrounds.get(key).pipe(
        Effect.provideContext(runtimeContext),
        Effect.map((obj) =>
          obj
            ? {
                text: () =>
                  obj.text().pipe(Effect.provideContext(runtimeContext), Effect.runPromise),
              }
            : null,
        ),
        Effect.runPromise,
      ),
    put: (key, value, options) =>
      playgrounds.put(key, value, options).pipe(
        Effect.provideContext(runtimeContext),
        Effect.runPromise,
      ),
  };
  return {
    PLAYGROUNDS: storage,
    PLAYGROUND_WRITES: {
      limit: (options) =>
        playgroundWrites.limit(options).pipe(
          Effect.provideContext(runtimeContext),
          Effect.runPromise,
        ),
    },
  };
}

export class Website extends Cloudflare.Worker<Website>()(
  "Website",
  websiteProps,
  Effect.gen(function* () {
    // Phase 1: declare and bind every Cloudflare resource through Alchemy's Effect bindings.
    const playgroundsBucket = yield* PlaygroundsBucket;
    const playgrounds = yield* Cloudflare.R2.ReadWriteBucket(playgroundsBucket);
    const playgroundWrites = yield* Cloudflare.Workers.RateLimit("PLAYGROUND_WRITES", {
      namespaceId: 1001,
      simple: { limit: 10, period: 60 },
    });
    const mcpCalls = yield* Cloudflare.Workers.RateLimit("MCP_CALLS", {
      namespaceId: 1002,
      simple: { limit: 120, period: 60 },
    });
    const replSessions = yield* ReplSession;
    const env = yield* Cloudflare.Workers.WorkerEnvironment;

    // Phase 2: per-request Effect handler wired with live Cloudflare Layers.
    return {
      fetch: Effect.gen(function* () {
        const runtimeContext = yield* Effect.context<RuntimeContext>();
        const assetsBinding = env["ASSETS"] as { fetch(request: Request): Promise<Response> };

        const liveServices = Layer.mergeAll(
          Layer.succeed(StaticAssets, {
            fetch: (request) => Effect.promise(() => assetsBinding.fetch(request)),
          }),
          Layer.succeed(PlaygroundService, {
            env: makePlaygroundEnv(playgrounds, playgroundWrites, runtimeContext),
          }),
          Layer.succeed(McpRateLimit, {
            allow: (key) =>
              mcpCalls.limit({ key }).pipe(
                Effect.provideContext(runtimeContext),
                Effect.map((outcome) => outcome.success),
                Effect.catchTag("RateLimitError", () => Effect.succeed(false)),
              ),
          }),
          Layer.succeed(ReplSessionClient, {
            call: (sessionId, args) =>
              replSessions
                .getByName(sessionId)
                .call(args)
                .pipe(Effect.provideContext(runtimeContext)),
            clear: (sessionId) =>
              replSessions
                .getByName(sessionId)
                .clear()
                .pipe(Effect.provideContext(runtimeContext)),
          }),
        );

        return yield* websiteFetch.pipe(Effect.provide(liveServices));
      }),
    };
  }).pipe(
    Effect.provide(ReplSessionLive),
    Effect.provide(Cloudflare.R2.ReadWriteBucketBinding),
    Effect.provide(Cloudflare.Workers.RateLimitBinding),
  ),
) {}

export { ReplSession, ReplSessionLive, ReplSessionError };
export default Website;

// ---------------------------------------------------------------------------
// HTML social metadata helpers
// ---------------------------------------------------------------------------

function metaForPath(pathname: string): RouteMeta | null {
  if (pathname === "/read") {
    return {
      title: "Reading Forma",
      description: "Read Forma code with its types, effects, and prelude forms.",
      path: pathname,
    };
  }
  if (pathname === "/read/snippets" || pathname === "/embed/read") {
    return {
      title: "Forma reader snippets",
      description: "Inline, checked Forma snippets with types on hover, for posts, docs, and demos.",
      path: pathname,
    };
  }
  if (pathname === "/custom") {
    return {
      title: "Build and share a Forma DSL",
      description: "Define a prelude, try an example, and share your language in a live playground.",
      path: pathname,
    };
  }
  if (pathname === "/") {
    return {
      title: "Forma Playground",
      description: playgroundDescription,
      path: "/",
    };
  }

  if (pathname === "/demo") {
    return {
      title: "Forma Examples",
      description: galleryDescription,
      path: "/demo",
    };
  }

  const liveExample = pathname.match(/^\/(?:embed|live)\/([^/]+)$/)?.[1];
  if (liveExample) {
    return {
      title: "Live Forma workbench",
      description: playgroundDescription,
      path: pathname,
    };
  }

  const pipelineId = pathname.match(/^\/demo\/([^/]+)$/)?.[1];
  if (pipelineId) {
    const pipeline = getPipeline(pipelineId);
    return {
      title: `${pipeline.title} - Forma`,
      description: plainText(pipeline.tagline),
      path: `/demo/${pipeline.id}`,
    };
  }

  return null;
}

function injectMeta(html: string, meta: RouteMeta, origin: string): string {
  const title = escapeHtml(meta.title);
  const description = escapeHtml(meta.description);
  const url = escapeHtml(
    new URL(`/playground${meta.path === "/" ? "" : meta.path}`, origin).toString(),
  );
  const image = escapeHtml(new URL("/og-image.png", origin).toString());

  return html
    .replace(/<title>.*?<\/title>/, `<title>${title}</title>`)
    .replace(
      /<meta\s+name="description"\s+content="[^"]*"\s*\/>/,
      `<meta name="description" content="${description}" />`,
    )
    .replace(
      /<meta\s+property="og:title"\s+content="[^"]*"\s*\/>/,
      `<meta property="og:title" content="${title}" />`,
    )
    .replace(
      /<meta\s+property="og:description"\s+content="[^"]*"\s*\/>/,
      `<meta property="og:description" content="${description}" />`,
    )
    .replace(
      /<meta\s+property="og:image"\s+content="[^"]*"\s*\/>/,
      `<meta property="og:image" content="${image}" />\n    <meta property="og:url" content="${url}" />\n    <link rel="canonical" href="${url}" />`,
    );
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

import { galleryDescription, plainText, playgroundDescription } from "./lib/siteCopy";
import { getPipeline } from "./pipelines";
import { FORMA_WORKBENCH_URL } from "./lib/workbenchLocation";
import { snapshotPath } from "./lib/playgroundSnapshot";
import { loadPlayground, playgroundApi, type PlaygroundEnv } from "./playgroundStore";

interface Env extends PlaygroundEnv {
  readonly ASSETS: {
    fetch(request: Request): Promise<Response>;
  };
}

interface RouteMeta {
  readonly title: string;
  readonly description: string;
  readonly path: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const requestUrl = new URL(request.url);
    if (requestUrl.pathname === "/playground/api/playgrounds" || requestUrl.pathname.startsWith("/playground/api/playgrounds/")) {
      try { return await playgroundApi(request, env); }
      catch { return Response.json({ error: "Playground storage is temporarily unavailable." }, { status: 503 }); }
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return env.ASSETS.fetch(request);
    }

    const url = new URL(request.url);
    const discoveryType = ({ "/feed.xml": "application/atom+xml", "/sitemap.xml": "application/xml", "/robots.txt": "text/plain" } as Record<string, string>)[url.pathname];
    if (discoveryType) {
      const response = await env.ASSETS.fetch(request);
      if (response.headers.get("content-type")?.includes("text/html")) return new Response("Not found", { status: 404 });
      const headers = new Headers(response.headers);
      headers.set("content-type", `${discoveryType}; charset=utf-8`);
      return new Response(response.body, { status: response.status, headers });
    }
    if (["/about", "/about/", "/playground/about", "/playground/about/"].includes(url.pathname)) {
      return Response.redirect(new URL("/language", url).toString(), 301);
    }
    if (url.pathname === "/workbench/demo" || url.pathname === "/workbench/demo/") {
      const destination = new URL(FORMA_WORKBENCH_URL);
      destination.search = url.search;
      return Response.redirect(destination.toString(), 302);
    }
    if (url.pathname === "/demo" || url.pathname.startsWith("/demo/")) {
      url.pathname = `/playground${url.pathname}`;
      return Response.redirect(url.toString(), 301);
    }
    const pathname = url.pathname === "/playground" ? "/" : url.pathname.startsWith("/playground/")
      ? url.pathname.slice("/playground".length)
      : null;
    let meta = pathname === null ? null : metaForPath(pathname);
    const sharedId = pathname?.match(/^\/p\/([a-f0-9]{32})$/)?.[1];
    if (pathname?.startsWith("/p/")) {
      try {
        const snapshot = sharedId ? await loadPlayground(env, sharedId) : null;
        if (!snapshot) return new Response("Playground not found.", { status: 404 });
        // Reader and workbench snapshots open on their own pages.
        if (snapshot.kind !== "custom") return Response.redirect(new URL(snapshotPath(sharedId!, snapshot), url).toString(), 302);
        meta = { title: `${snapshot.title} - Forma`, description: "Explore this language: edit its prelude and example, and inspect the typed IR in your browser.", path: pathname };
      } catch { return new Response("Playground storage is temporarily unavailable.", { status: 503 }); }
    }
    // A shared reader or workbench: a link to a missing snapshot is a 404, as for playgrounds.
    const snapshotId = url.searchParams.get("snapshot");
    if (meta && snapshotId !== null && (pathname === "/read" || /^\/(?:embed|live)\/(?!read$|custom$)[^/]+$/.test(pathname!))) {
      try {
        const snapshot = await loadPlayground(env, snapshotId);
        if (!snapshot || snapshot.kind !== (pathname === "/read" ? "reader" : "workbench")) return new Response("Snapshot not found.", { status: 404 });
        meta = { ...meta, title: snapshot.kind === "reader" ? "Shared Forma code - Forma" : "Shared Forma workbench - Forma", path: `${pathname}?snapshot=${snapshotId}` };
      } catch { return new Response("Playground storage is temporarily unavailable.", { status: 503 }); }
    }
    if (!meta) {
      return env.ASSETS.fetch(request);
    }

    const indexUrl = new URL("/playground/", url);
    const response = await env.ASSETS.fetch(new Request(indexUrl, request));
    const html = await response.text();
    const headers = new Headers(response.headers);
    headers.set("content-type", "text/html; charset=utf-8");

    return new Response(injectMeta(html, meta, "https://forma-lang.com"), {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  },
};

function metaForPath(pathname: string): RouteMeta | null {
  if (pathname === "/read") {
    return { title: "Reading Forma", description: "Read Forma code with its types, effects, and prelude forms.", path: pathname };
  }
  if (pathname === "/read/snippets" || pathname === "/embed/read") {
    return { title: "Forma reader snippets", description: "Inline, checked Forma snippets with types on hover, for posts, docs, and demos.", path: pathname };
  }
  if (pathname === "/custom") {
    return { title: "Build and share a Forma DSL", description: "Define a prelude, try an example, and share your language in a live playground.", path: pathname };
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
  if (liveExample) return { title: "Live Forma workbench", description: playgroundDescription, path: pathname };

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
  const url = escapeHtml(new URL(`/playground${meta.path === "/" ? "" : meta.path}`, origin).toString());
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
    .replaceAll("\"", "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

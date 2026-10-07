import { aboutDescription, galleryDescription, plainText, playgroundDescription } from "./lib/siteCopy";
import { getPipeline } from "./pipelines";

interface Env {
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
    if (request.method !== "GET" && request.method !== "HEAD") {
      return env.ASSETS.fetch(request);
    }

    const url = new URL(request.url);
    if (url.pathname === "/about" || url.pathname === "/demo" || url.pathname.startsWith("/demo/")) {
      url.pathname = `/playground${url.pathname}`;
      return Response.redirect(url.toString(), 301);
    }
    const pathname = url.pathname === "/playground" ? "/" : url.pathname.startsWith("/playground/")
      ? url.pathname.slice("/playground".length)
      : null;
    const meta = pathname === null ? null : metaForPath(pathname);
    if (!meta) {
      return env.ASSETS.fetch(request);
    }

    const indexUrl = new URL("/playground/", url);
    const response = await env.ASSETS.fetch(new Request(indexUrl, request));
    const html = await response.text();
    const headers = new Headers(response.headers);
    headers.set("content-type", "text/html; charset=utf-8");

    return new Response(injectMeta(html, meta, url.origin), {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  },
};

function metaForPath(pathname: string): RouteMeta | null {
  if (pathname === "/") {
    return {
      title: "Forma Playground",
      description: playgroundDescription,
      path: "/",
    };
  }

  if (pathname === "/about") {
    return {
      title: "About Forma",
      description: aboutDescription,
      path: "/about",
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
  const image = escapeHtml(new URL("/playground/og-image.svg", origin).toString());

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
      `<meta property="og:image" content="${image}" />\n    <meta property="og:url" content="${url}" />`,
    );
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("\"", "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

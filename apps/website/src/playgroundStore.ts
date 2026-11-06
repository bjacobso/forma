import { MAX_SNAPSHOT_BYTES, readSnapshot, snapshotIdPattern } from "./lib/playgroundSnapshot";

export interface PlaygroundStorage {
  get(key: string): Promise<{ text(): Promise<string> } | null>;
  put(key: string, value: string, options: { onlyIf: { etagDoesNotMatch: string }; httpMetadata: { contentType: string } }): Promise<unknown>;
}

export interface PlaygroundEnv {
  readonly PLAYGROUNDS?: PlaygroundStorage;
  readonly PLAYGROUND_WRITES?: { limit(options: { key: string }): Promise<{ success: boolean }> };
}

export async function loadPlayground(env: PlaygroundEnv, id: string) {
  if (!snapshotIdPattern.test(id) || !env.PLAYGROUNDS) return null;
  const object = await env.PLAYGROUNDS.get(`v1/${id}.json`);
  return object ? readSnapshot(JSON.parse(await object.text())) : null;
}

export async function playgroundApi(request: Request, env: PlaygroundEnv): Promise<Response> {
  const url = new URL(request.url);
  const id = url.pathname.slice("/playground/api/playgrounds".length).replace(/^\//, "");
  if (!env.PLAYGROUNDS) return Response.json({ error: "Playground storage is unavailable." }, { status: 503 });
  if (id) {
    if (request.method !== "GET" && request.method !== "HEAD") return new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } });
    const demo = await loadPlayground(env, id);
    if (!demo) return Response.json({ error: "Playground not found." }, { status: 404 });
    return new Response(request.method === "HEAD" ? null : JSON.stringify({ version: 1, ...demo }), {
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" },
    });
  }
  if (request.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST" } });
  const origin = request.headers.get("Origin");
  if (origin && origin !== url.origin) return Response.json({ error: "Origin is not allowed." }, { status: 403 });
  if (request.headers.get("Content-Type")?.split(";")[0]?.trim() !== "application/json") return Response.json({ error: "Send application/json." }, { status: 415 });
  if (!env.PLAYGROUND_WRITES) return Response.json({ error: "Playground sharing is unavailable." }, { status: 503 });
  const permitted = await env.PLAYGROUND_WRITES.limit({ key: request.headers.get("CF-Connecting-IP") ?? "local" });
  if (!permitted.success) return Response.json({ error: "Too many snapshots. Try again in a minute." }, { status: 429, headers: { "Retry-After": "60" } });

  // Bound the actual stream, including requests without Content-Length.
  const reader = request.body?.getReader();
  if (!reader) return Response.json({ error: "A snapshot is required." }, { status: 400 });
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_SNAPSHOT_BYTES) {
      await reader.cancel();
      return Response.json({ error: "Playgrounds must fit within 128 KiB." }, { status: 413 });
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let demo;
  try { demo = readSnapshot(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))); }
  catch { return Response.json({ error: "Invalid snapshot JSON." }, { status: 400 }); }
  if (!demo) return Response.json({ error: "Expected a version 1 snapshot with a title, prelude, and source." }, { status: 400 });
  const body = JSON.stringify({ version: 1, ...demo });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
  const snapshotId = Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, "0")).join("").slice(0, 32);
  await env.PLAYGROUNDS.put(`v1/${snapshotId}.json`, body, { onlyIf: { etagDoesNotMatch: "*" }, httpMetadata: { contentType: "application/json" } });
  return Response.json({ id: snapshotId, path: `/playground/p/${snapshotId}` }, { status: 201, headers: { "Cache-Control": "no-store" } });
}

import { expect, test, vi } from "vitest";
import worker from "./worker";
import { MAX_SNAPSHOT_BYTES } from "./lib/playgroundSnapshot";
import { defaultPreludeDemo } from "./lib/preludeShare";
import { playgroundApi, type PlaygroundEnv } from "./playgroundStore";

function storage() {
  const objects = new Map<string, string>();
  const env = {
    PLAYGROUNDS: {
      get: vi.fn(async (key: string) => objects.has(key) ? { text: async () => objects.get(key)! } : null),
      put: vi.fn(async (key: string, value: string) => { if (!objects.has(key)) objects.set(key, value); }),
    },
    PLAYGROUND_WRITES: { limit: vi.fn(async () => ({ success: true })) },
  };
  return { env, objects };
}

function save(env: PlaygroundEnv, value: unknown = { version: 1, ...defaultPreludeDemo }) {
  return playgroundApi(new Request("https://forma-lang.com/playground/api/playgrounds", {
    method: "POST", headers: { "Content-Type": "application/json", Origin: "https://forma-lang.com", "CF-Connecting-IP": "192.0.2.1" }, body: JSON.stringify(value),
  }), env);
}

test("snapshots have stable content IDs and changing a file creates a new snapshot", async () => {
  const { env, objects } = storage();
  const first = await save(env);
  expect(first.status).toBe(201);
  const saved = await first.json() as { id: string; path: string };
  expect(saved.path).toBe(`/playground/p/${saved.id}`);
  expect(await (await save(env)).json()).toEqual(saved);
  const changed = await (await save(env, { version: 1, ...defaultPreludeDemo, source: "different" })).json();
  expect(changed).not.toEqual(saved);
  expect(objects.size).toBe(2);
  const response = await playgroundApi(new Request(`https://forma-lang.com/playground/api/playgrounds/${saved.id}`), env);
  expect(await response.json()).toEqual({ version: 1, ...defaultPreludeDemo });
  expect(response.headers.get("Cache-Control")).toContain("immutable");
  expect(env.PLAYGROUND_WRITES.limit).toHaveBeenCalledWith({ key: "192.0.2.1" });
  expect(env.PLAYGROUNDS.put).toHaveBeenCalledWith(expect.any(String), expect.any(String), expect.objectContaining({ onlyIf: { etagDoesNotMatch: "*" } }));
});

const reader = {
  version: 1, kind: "reader", preludes: "effect",
  files: [{ id: "main.lisp", source: '(import "./domain.lisp" [Order])' }, { id: "domain.lisp", source: "(export Order)" }, { id: "forma:cluster.lisp" }],
  active: "forma:cluster.lisp",
};
const workbench = { version: 1, kind: "workbench", example: "orders", source: "(define x 1)" };

test("reader and workbench snapshots share the store and open on their own pages", async () => {
  const { env } = storage();
  for (const [value, page] of [[reader, "/playground/read?snapshot="], [workbench, "/playground/live/orders?snapshot="]] as const) {
    const saved = await (await save(env, value)).json() as { id: string; path: string };
    expect(saved.path).toBe(`${page}${saved.id}`);
    expect(await (await save(env, value)).json()).toEqual(saved);
    expect(await (await playgroundApi(new Request(`https://forma-lang.com/playground/api/playgrounds/${saved.id}`), env)).json()).toEqual(value);
  }
  // The same files in another tab order, or with another file shown, are another snapshot.
  const reordered = await (await save(env, { ...reader, active: "main.lisp" })).json() as { id: string };
  expect(reordered.id).not.toBe((await (await save(env, reader)).json() as { id: string }).id);
});

test("rejects malformed, unsupported, oversized and cross-origin writes before storing", async () => {
  const { env } = storage();
  const malformedReaders = [
    { ...reader, active: "missing.lisp" },
    { ...reader, preludes: "unknown" },
    { ...reader, files: [] },
    { ...reader, files: [{ id: "forma:cluster.lisp" }] },
    { ...reader, files: [...reader.files, { id: "main.lisp", source: "" }] },
    { ...reader, files: [{ id: "main.lisp" }], active: "main.lisp" },
    { ...reader, files: [{ id: "main.lisp", source: "" }, { id: "forma:kernel.lisp", source: "(edited)" }], active: "main.lisp" },
    { ...workbench, example: "../orders" },
    { ...workbench, kind: "custom" },
  ];
  for (const value of [null, { ...defaultPreludeDemo, version: 2 }, { ...defaultPreludeDemo, version: 1, title: "" }, ...malformedReaders]) {
    expect((await save(env, value)).status).toBe(400);
  }
  expect((await save(env, { version: 1, ...defaultPreludeDemo, source: "x".repeat(MAX_SNAPSHOT_BYTES) })).status).toBe(413);
  const invalid = new Request("https://forma-lang.com/playground/api/playgrounds", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" });
  expect((await playgroundApi(invalid, env)).status).toBe(400);
  const crossOrigin = new Request("https://forma-lang.com/playground/api/playgrounds", { method: "POST", headers: { Origin: "https://other.invalid", "Content-Type": "application/json" }, body: "{}" });
  expect((await playgroundApi(crossOrigin, env)).status).toBe(403);
  expect(env.PLAYGROUNDS.put).not.toHaveBeenCalled();
});

test("enforces the write limit and fails closed when bindings are unavailable", async () => {
  const { env } = storage();
  env.PLAYGROUND_WRITES.limit.mockResolvedValue({ success: false });
  expect((await save(env)).status).toBe(429);
  expect((await save({ PLAYGROUNDS: env.PLAYGROUNDS })).status).toBe(503);
  expect((await save({})).status).toBe(503);
  expect(env.PLAYGROUNDS.put).not.toHaveBeenCalled();
});

test("does not expose bucket keys or allow modification through the API", async () => {
  const { env } = storage();
  const base = "https://forma-lang.com/playground/api/playgrounds";
  expect((await playgroundApi(new Request(`${base}/bad-id`), env)).status).toBe(404);
  expect((await playgroundApi(new Request(base), env)).status).toBe(405);
  expect((await playgroundApi(new Request(`${base}/${"a".repeat(32)}`, { method: "DELETE" }), env)).status).toBe(405);
  expect(env.PLAYGROUNDS.get).not.toHaveBeenCalled();
});

test("the website serves saved titles as escaped social metadata and handles missing snapshots", async () => {
  const { env } = storage();
  const saved = await (await save(env, { version: 1, ...defaultPreludeDemo, title: '<DSL & "friends">' })).json() as { path: string };
  const website = { ...env, ASSETS: { fetch: vi.fn(async () => new Response('<title>Forma</title><meta property="og:title" content="Forma" />')) } };
  const response = await worker.fetch(new Request(`https://forma-lang.com${saved.path}`), website);
  expect(await response.text()).toContain('<meta property="og:title" content="&lt;DSL &amp; &quot;friends&quot;&gt; - Forma" />');
  const missing = await worker.fetch(new Request(`https://forma-lang.com/playground/p/${"a".repeat(32)}`), website);
  expect(missing.status).toBe(404);
  const sharedReader = await (await save(env, reader)).json() as { id: string; path: string };
  const redirect = await worker.fetch(new Request(`https://forma-lang.com/playground/p/${sharedReader.id}`), website);
  expect(redirect.status).toBe(302);
  expect(redirect.headers.get("Location")).toBe(`https://forma-lang.com${sharedReader.path}`);
  const page = await worker.fetch(new Request(`https://forma-lang.com${sharedReader.path}`), website);
  expect(page.status).toBe(200);
  expect(await page.text()).toContain('<meta property="og:title" content="Shared Forma code - Forma" />');
  for (const path of [`/playground/read?snapshot=${"a".repeat(32)}`, `/playground/live/orders?snapshot=${sharedReader.id}`, "/playground/read?snapshot=bad-id"]) {
    expect((await worker.fetch(new Request(`https://forma-lang.com${path}`), website)).status).toBe(404);
  }
  env.PLAYGROUNDS.get.mockRejectedValue(new Error("offline"));
  expect((await worker.fetch(new Request(`https://forma-lang.com${saved.path}`), website)).status).toBe(503);
});

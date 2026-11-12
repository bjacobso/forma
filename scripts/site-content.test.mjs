import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadPosts, writeDiscovery } from "./site-content.mjs";

test("posts have dates, canonical links and deterministic newest-first order", () => {
  const posts = loadPosts();
  const files = readdirSync(new URL("../docs/blog/", import.meta.url), { recursive: true });
  assert.equal(posts.length, files.filter(file => file.endsWith(".md") && !file.endsWith("index.md")).length);
  assert.ok(posts.length > 0);
  assert.ok(posts.every(post => /^\d{4}-\d{2}-\d{2}$/.test(post.date)));
  assert.ok(posts.every(post => post.url.startsWith("https://forma-lang.com/blog/")));
  assert.deepEqual(posts.map(post => post.date), posts.map(post => post.date).sort().reverse());
});

test("discovery files contain posts and real built routes, never the HTML fallback", async () => {
  const output = await mkdtemp(join(tmpdir(), "forma-discovery-"));
  await mkdir(join(output, "preludes"));
  await writeFile(join(output, "index.html"), "home");
  await writeFile(join(output, "404.html"), "missing");
  await writeFile(join(output, "preludes", "kernel.html"), "kernel");
  await writeDiscovery(output);
  const feed = await readFile(join(output, "feed.xml"), "utf8");
  assert.match(feed, /xmlns="http:\/\/www.w3.org\/2005\/Atom"/);
  assert.equal((feed.match(/<entry>/g) ?? []).length, loadPosts().length);
  assert.match(feed, /<updated>\d{4}-\d{2}-\d{2}T00:00:00Z<\/updated>/);
  const sitemap = await readFile(join(output, "sitemap.xml"), "utf8");
  assert.match(sitemap, /https:\/\/forma-lang.com\/preludes\/kernel/);
  assert.doesNotMatch(sitemap, /404/);
  assert.match(await readFile(join(output, "robots.txt"), "utf8"), /Sitemap: https:\/\/forma-lang.com\/sitemap.xml/);
});

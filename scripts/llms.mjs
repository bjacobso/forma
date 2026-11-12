#!/usr/bin/env node
// Generate the agent entry point from a docs page, then check actual files
// rather than accepting an HTML fallback as proof that a link exists.
import { access, readFile, writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
const output = resolve(root, process.argv[2] === "--generate" ? "dist-docs" : (process.argv[2] ?? "dist-docs"));
const source = await readFile(resolve(root, "docs/agents.md"), "utf8");

if (process.argv[2] === "--generate") {
  await writeFile(resolve(output, "llms.txt"), source);
}

const text = await readFile(resolve(output, "llms.txt"), "utf8");
if (!/^# Forma\n\n> .+pre-alpha.+`npm install @forma-language\/forma effect`/u.test(text)) {
  throw new Error("llms.txt needs the Forma H1 and a summary with maturity and installation.");
}
const sections = text.split(/^## .+$/mu).slice(1);
if (sections.length < 2 || sections.some((section) => !/^- \[[^\]]+\]\(https:\/\/[^)]+\): .+/mu.test(section))) {
  throw new Error("llms.txt needs sections containing titled links with notes.");
}

for (const match of text.matchAll(/\[[^\]]+\]\(([^)]+)\)/gu)) {
  const url = new URL(match[1]);
  let path;
  if (url.origin === "https://raw.githubusercontent.com" && url.pathname.startsWith("/bjacobso/forma/main/")) {
    path = decodeURIComponent(url.pathname.slice("/bjacobso/forma/main/".length));
    const local = resolve(root, path);
    if (!local.startsWith(root + sep)) throw new Error(`Invalid source path: ${url}`);
    await access(local);
    // Linked documentation must also have a real built page. RFCs are
    // repository-only design records and are not built into the site.
    if (path.startsWith("docs/") && !path.startsWith("docs/rfcs/") && path.endsWith(".md")) {
      await access(resolve(output, path.slice("docs/".length).replace(/\.md$/u, ".html")));
    }
  } else if (url.origin === "https://forma-lang.com") {
    path = decodeURIComponent(url.pathname).replace(/^\//u, "");
    const local = resolve(output, path.endsWith("/") || !path ? `${path}index.html` : `${path}.html`);
    if (!local.startsWith(output + sep)) throw new Error(`Invalid site path: ${url}`);
    await access(local);
  } else {
    throw new Error(`Use canonical site pages or public Forma Markdown sources: ${url}`);
  }
}

if (text !== source) throw new Error("llms.txt differs from docs/agents.md; run pnpm docs:build.");
console.log(`llms.txt structure, source, and link targets checked in ${output}.`);

// Discovery and sharing are checked on disk: an SPA fallback cannot satisfy them.
const feed = await readFile(resolve(output, "feed.xml"), "utf8");
const { loadPosts } = await import("./site-content.mjs");
if (!feed.includes('xmlns="http://www.w3.org/2005/Atom"') || (feed.match(/<entry>/gu) ?? []).length !== loadPosts().length) {
  throw new Error("feed.xml must be Atom with one entry per dated blog post.");
}
const sitemap = await readFile(resolve(output, "sitemap.xml"), "utf8");
if (!sitemap.includes("https://forma-lang.com/language") || !sitemap.includes("https://forma-lang.com/preludes/kernel")) {
  throw new Error("sitemap.xml needs real docs and generated prelude pages.");
}
if (!(await readFile(resolve(output, "robots.txt"), "utf8")).includes("Sitemap: https://forma-lang.com/sitemap.xml")) {
  throw new Error("robots.txt must advertise the sitemap.");
}
const image = await readFile(resolve(output, "og-image.png"));
if (image.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" || image.readUInt32BE(16) !== 1200 || image.readUInt32BE(20) !== 630) {
  throw new Error("Share image must be a 1200 × 630 PNG.");
}
const { readdir } = await import("node:fs/promises");
for (const file of await readdir(output, { recursive: true })) {
  if (!file.endsWith(".html") || file.startsWith("playground/")) continue;
  const html = await readFile(resolve(output, file), "utf8");
  for (const marker of ['rel="canonical"', 'property="og:title"', 'property="og:description"', 'https://forma-lang.com/og-image.png']) {
    if (!html.includes(marker)) throw new Error(`${file} is missing ${marker}`);
  }
  // VitePress's generated 404 has an empty SSR body and renders the shell on hydration.
  if (file !== "404.html" && !html.includes('aria-label="WorldVM family"')) throw new Error(`${file} is missing the family strip.`);
  // Publishing is maintained by the package workstream and explicitly describes
  // private workspace names; it is the only public-page exception.
  if (file !== "publishing.html" && html.includes("@formalang")) throw new Error(`${file} teaches an internal package name.`);
  if (html.includes("incubation project within")) throw new Error(`${file} still has the old banner.`);
}
console.log("Site discovery, share metadata, family strip, and public package names checked.");

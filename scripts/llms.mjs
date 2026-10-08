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
if (!/^# Forma\n\n> .+pre-alpha.+`pnpm add @formalang\/ts`/u.test(text)) {
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
    // Linked documentation must also have a real built page.
    if (path.startsWith("docs/") && path.endsWith(".md")) {
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

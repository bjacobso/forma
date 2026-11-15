/**
 * Every live Forma block in the docs checks, the way the docs' <FormaBlock>
 * loads it: with its page's earlier blocks on a continued page, and the page's
 * named files beside a named block. Mark a block that is not a whole program
 * `fragment` (see docs/.vitepress/formaFences.ts).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { fenceOptions, pageMode } from "../../../../docs/.vitepress/formaFences";
import { loadPreludes, renderPrelude } from "../../../../docs/.vitepress/preludes";
import { analyze, dispose, inScope } from "./analysis";
import { isPreludeStack, type PreludeStack } from "./protocol";

const docs = resolve(import.meta.dirname, "../../../../docs");

function pages(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (["rfcs", "proposals", ".vitepress", "snippets", "public"].includes(name)) return [];
    return statSync(path).isDirectory() ? pages(path) : name.endsWith(".md") ? [path] : [];
  });
}

interface Block { readonly line: number; readonly info: string; readonly source: string }

/** Fences and `<<<` imports, with their info strings as VitePress sees them. */
function blocks(text: string): Block[] {
  const lines = text.split("\n");
  const found: Block[] = [];
  for (let i = 0; i < lines.length; i++) {
    // VitePress's snippet syntax: <<< @/path{lines lang attrs} [title]
    const imported = /^<<<\s+@\/(\S+?\.(\w+))(?:\{(\d+(?:[,-]\d+)*)? ?(\S+)? ?(\S+)?\})?\s*(?:\[[^\]]*\])?\s*$/.exec(lines[i]!);
    if (imported) {
      const [, file, extension, , lang, attrs] = imported;
      found.push({ line: i + 1, info: `${lang ?? extension} ${attrs ?? ""}`, source: readFileSync(join(docs, file!), "utf8") });
      continue;
    }
    const open = /^(\s*)(`{3,}|~{3,})(.*)$/.exec(lines[i]!);
    if (!open) continue;
    const [, indent, marker, info] = open;
    const body: string[] = [];
    let j = i + 1;
    for (; j < lines.length; j++) {
      const close = /^\s*(`{3,}|~{3,})\s*$/.exec(lines[j]!);
      if (close && close[1]![0] === marker![0] && close[1]!.length >= marker!.length) break;
      body.push(lines[j]!.startsWith(indent!) ? lines[j]!.slice(indent!.length) : lines[j]!);
    }
    found.push({ line: i + 1, info: info!.trim(), source: `${body.join("\n")}\n` });
    i = j;
  }
  return found.filter(block => fenceOptions(block.info) !== undefined);
}

const frontmatter = (text: string): Record<string, unknown> => {
  const head = /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? "";
  return Object.fromEntries([...head.matchAll(/^(\w+):\s*(.+)$/gm)].map(match => [match[1], match[2]!.trim()]));
};

// Markdown pages, then the prelude reference pages VitePress generates.
const sources: readonly (readonly [string, string])[] = [
  ...pages(docs).map(path => [relative(docs, path), readFileSync(path, "utf8")] as const),
  ...loadPreludes().map(prelude => [`preludes/${prelude.slug}.md`, renderPrelude(prelude)] as const),
];

describe("docs Forma blocks", () => {
  for (const [name, text] of sources) {
    const mode = pageMode(frontmatter(text));
    const live = mode === "static" ? [] : blocks(text).filter(block => fenceOptions(block.info)!.live);
    if (!live.length) continue;
    test(name, () => {
      const failures: string[] = [];
      const named = live.flatMap(block => fenceOptions(block.info)!.file ? [{ id: fenceOptions(block.info)!.file!, source: block.source }] : []);
      live.forEach((block, index) => {
        const options = fenceOptions(block.info)!;
        const preludes: PreludeStack = isPreludeStack(options.preludes) ? options.preludes : "effect";
        if (options.preludes && !isPreludeStack(options.preludes)) failures.push(`line ${block.line}: unknown preludes=${options.preludes}`);
        const before = mode === "continued"
          ? live.slice(0, index).filter(earlier => !fenceOptions(earlier.info)!.file).map(earlier => earlier.source).join("\n\n")
          : "";
        const file = options.file ?? "main.lisp";
        const scope = `${name}:${block.line}`;
        inScope(scope, { preludes, ...(before ? { before } : {}) });
        const files = [{ id: file, source: block.source }, ...(options.file ? named.filter(other => other.id !== file) : [])];
        const errors = analyze(files, file).diagnostics.filter(d => d.severity === "error");
        dispose(scope);
        for (const error of errors.slice(0, 2)) failures.push(`line ${block.line}: ${error.code}: ${error.message}`);
      });
      expect(failures).toEqual([]);
    }, 120_000);
  }
});

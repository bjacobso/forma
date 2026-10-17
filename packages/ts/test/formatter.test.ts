import { ignoredRanges } from "../src/format/ignore.js";
import { describe, expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { formatLisp, formatRange, formatMarkdown, type FormatOptions } from "../src/Format.js";
import { tokenizeWithTrivia } from "../src/reader/lexer.js";
import { parse } from "../src/reader/parser.js";
import { toSExprMany } from "../src/reader/to-sexpr.js";
import { extractMarkdownFences, isFormaFence } from "../src/source/markdown.js";

const root = resolve(import.meta.dirname, "../../..");
const tokens = (source: string) => tokenizeWithTrivia(source).filter(t => t.token.type !== "eof").map(t => source.slice(t.token.loc.start, t.token.loc.end));
const comments = (source: string) => {
  let previous = 0;
  return tokenizeWithTrivia(source).flatMap(({ token, leadingTrivia }, index) => {
    const result = leadingTrivia.filter(t => t.kind === "line-comment").map(t => ({ text: t.text.replace(/\r$/, ""), index,
      trailing: index > 0 && !source.slice(previous, t.loc.start).includes("\n") }));
    previous = token.loc.end;
    return result;
  });
};
const structure = (source: string) => JSON.stringify(toSExprMany(parse(source).redTree), (key, value) => key === "loc" ? undefined : value);
const blanks = (source: string) => tokenizeWithTrivia(source).flatMap(({ leadingTrivia }, index) => leadingTrivia.flatMap((t, i) =>
  t.kind === "whitespace" && (t.text.match(/\n/g)?.length ?? 0) >= 2 ? [`${index}:${leadingTrivia.slice(0, i).filter(t => t.kind === "line-comment").length}`] : []));

function invariants(source: string, id: string, options: FormatOptions = {}): string {
  const result = formatLisp(source, options);
  if (parse(source).errors.length) {
    expect(result.text, id).toBe(source); expect(result.diagnostics.length, id).toBeGreaterThan(0); return source;
  }
  expect(result.diagnostics, id).toEqual([]);
  expect(tokens(result.text), id).toEqual(tokens(source));
  expect(structure(result.text), id).toBe(structure(source));
  expect(comments(result.text), id).toEqual(comments(source));
  expect(formatLisp(result.text, options).text, id + " idempotence").toBe(result.text);
  // Leading/trailing whitespace may be normalized; internal blank boundaries survive.
  const sourceTokens = tokens(source), outputBlanks = blanks(result.text);
  for (const blank of blanks(source).filter(b => !b.startsWith("0:") && !b.startsWith(`${sourceTokens.length}:`))) {
    expect(outputBlanks, id + " blank " + blank).toContain(blank);
  }
  const width = options.softWrap ?? 80;
  const outputTokens = tokenizeWithTrivia(result.text);
  const outputComments = outputTokens.flatMap(t => t.leadingTrivia.filter(t => t.kind === "line-comment"));
  const ignored = ignoredRanges(parse(result.text).greenTree, result.text);
  let lineStart = 0;
  for (const line of result.text.split("\n")) {
    const start = lineStart, end = start + line.length;
    lineStart = end + 1;
    if (line.length <= width || outputComments.some(c => c.loc.start >= start && c.loc.start <= end) || ignored.some(r => start < r.end && end > r.start)) continue;
    const significant = outputTokens.filter(t => t.token.loc.start <= end && t.token.loc.end > start && !["eof", "lparen", "rparen", "lbracket", "rbracket", "lbrace", "rbrace", "quote", "backtick", "tilde", "tilde-at"].includes(t.token.type));
    if (significant.length <= 1) continue;
    expect(line.length, id + " width: " + line).toBeLessThanOrEqual(width);
  }
  return result.text;
}

const files = execFileSync("git", ["ls-files", "*.lisp", "*.forma", "*.md"], { cwd: root, encoding: "utf8" }).trim().split("\n");
const units = files.flatMap(path => {
  const source = readFileSync(resolve(root, path), "utf8");
  return path.endsWith(".md") ? extractMarkdownFences(source, path).filter(isFormaFence).filter(b => !b.unsupported).map(b => ({ id: `${path}#${b.origin.blockIndex}`, source: b.text })) : [{ id: path, source }];
});

describe("lossless formatter", () => {
  test("authored spelling, shorthand, trivia and comments", () => {
    invariants("; heading\n(define x 'x) ; trailing\n\n\n(define y `(~x ~@xs))\n(define s \"tab\\there\\n\")\n[2. 1e400 -0.0]\n", "spelling");
    expect(formatLisp("(a ; open\n b ; item\n ) ; end\n").text).toBe("(a ; open\n  b ; item\n) ; end\n");
  });
  test("range formatting touches only intersecting top-level forms", () => {
    expect(formatRange("(a   b)\n(c   d)\n", { start: 2, end: 3 }).text).toBe("(a b)\n(c   d)\n");
  });
  test("all tracked Lisp files and supported Markdown fences", () => {
    expect(units.length).toBeGreaterThan(500);
    for (const unit of units) invariants(unit.source, unit.id);
  }, 30_000);
  test("seeded whitespace and comment insertion over corpus forms", () => {
    let seed = 0x5eed;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
    const valid = units.filter(u => !parse(u.source).errors.length);
    for (let i = 0; i < 100; i++) {
      const unit = valid[random() % valid.length]!;
      const mutated = tokens(unit.source).map(t => t + [" ", "\n", "\n\n", " ; generated\n"][random() % 4]).join("");
      invariants(mutated, `${unit.id}:seed:${seed}`);
    }
  }, 30_000);
  test("largest prelude stays within an interactive budget", () => {
    const largest = units.filter(u => u.id.startsWith("preludes/")).sort((a, b) => b.source.length - a.source.length)[0]!;
    const start = performance.now(); formatLisp(largest.source);
    expect(performance.now() - start).toBeLessThan(2000);
  });
  for (const entry of readdirSync(resolve(root, "conformance/format"), { withFileTypes: true }).filter(e => e.isDirectory())) {
    const dir = resolve(root, "conformance/format", entry.name);
    test(`golden ${entry.name}`, () => {
      const ext = existsSync(resolve(dir, "input.md")) ? "md" : "lisp";
      const input = readFileSync(resolve(dir, `input.${ext}`), "utf8");
      const options = existsSync(resolve(dir, "options.json")) ? JSON.parse(readFileSync(resolve(dir, "options.json"), "utf8")) : {};
      const output = ext === "md" ? formatMarkdown(input, options).text : invariants(input, entry.name, options);
      expect(output).toBe(readFileSync(resolve(dir, `output.${ext}`), "utf8"));
      if (ext === "md") expect(formatMarkdown(output, options).text).toBe(output);
    });
  }
});

test("module layouts include visible imported and re-exported descriptors", async () => {
  const { readModuleGraph } = await import("../src/Node.js");
  const { moduleFormatOptions } = await import("../src/Format.js");
  const graph = readModuleGraph(resolve(root, "conformance/compile-time-modules/main.forma"));
  const options = moduleFormatOptions(graph);
  expect(options.descriptors?.map(d => d.name)).toContain("picklist-of");
  const source = '(picklist-of LongDeclarationName billing/prices)';
  expect(formatLisp(source, { ...options, softWrap: 38 }).text).toBe('(picklist-of LongDeclarationName\n  billing/prices)\n');
});

test("module layouts preserve authored namespace aliases and macro signatures", async () => {
  const { resolveModuleGraph, sourceModuleResolver } = await import("../src/modules/graph.js");
  const { moduleFormatOptions } = await import("../src/Format.js");
  const graph = resolveModuleGraph({ id: "main.forma", source: '(import "./stripe.forma" :as vendor)\n(import "./macros.forma" [whenish])' }, sourceModuleResolver([
    { id: "stripe.forma", source: readFileSync(resolve(root, "conformance/compile-time-modules/stripe.forma"), "utf8") },
    { id: "macros.forma", source: '(export whenish)\n(macro (whenish test body ...) `(if ~test (do ~@body) nil))' },
  ]));
  const options = moduleFormatOptions(graph);
  expect(options.descriptors?.map(d => d.name)).toContain("vendor/price");
  expect(options.macroSignatures?.has("whenish")).toBe(true);
  expect(formatLisp('(whenish condition (first-step input) (second-step input))', { ...options, softWrap: 40 }).text)
    .toBe('(whenish condition\n  (first-step input)\n  (second-step input))\n');
});

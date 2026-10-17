import { describe, expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { formatLisp, formatRange } from "../src/Format.js";
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

function invariants(source: string, id: string): string {
  const result = formatLisp(source);
  if (parse(source).errors.length) {
    expect(result.text, id).toBe(source); expect(result.diagnostics.length, id).toBeGreaterThan(0); return source;
  }
  expect(result.diagnostics, id).toEqual([]);
  expect(tokens(result.text), id).toEqual(tokens(source));
  expect(structure(result.text), id).toBe(structure(source));
  expect(comments(result.text), id).toEqual(comments(source));
  expect(formatLisp(result.text).text, id + " idempotence").toBe(result.text);
  // Leading/trailing whitespace may be normalized; internal blank boundaries survive.
  const sourceTokens = tokens(source), outputBlanks = blanks(result.text);
  for (const blank of blanks(source).filter(b => !b.startsWith("0:") && !b.startsWith(`${sourceTokens.length}:`))) {
    expect(outputBlanks, id + " blank " + blank).toContain(blank);
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
      const input = readFileSync(resolve(dir, "input.lisp"), "utf8");
      expect(invariants(input, entry.name)).toBe(readFileSync(resolve(dir, "output.lisp"), "utf8"));
    });
  }
});

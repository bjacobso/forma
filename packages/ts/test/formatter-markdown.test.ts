import { describe, expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { formatLisp, formatMarkdown, formatRange, formattingEdits } from "../src/Format.js";
import { extractMarkdownFences, isFormaFence } from "../src/source/markdown.js";
import { tokenizeWithTrivia } from "../src/reader/lexer.js";

function prose(source: string): string {
  let result = "", cursor = 0;
  for (const block of extractMarkdownFences(source).filter(isFormaFence)) {
    result += source.slice(cursor, block.bodyStart) + "<body>"; cursor = block.bodyEnd;
  }
  return result + source.slice(cursor);
}
const tokens = (source: string) => tokenizeWithTrivia(source).filter(t => t.token.type !== "eof").map(t => source.slice(t.token.loc.start, t.token.loc.end));

describe("Markdown formatting", () => {
  test("only Lisp and Forma bodies change, including tilde and indented CRLF fences", () => {
    const source = "# Prose  \r\n\r\n  ~~~~forma title\r\n  (a   b)\r\n  ~~~~~\r\n\r\n```js\n(a   b)\n```\n```clj\n(a   b)\n```\n";
    const result = formatMarkdown(source);
    expect(result.diagnostics).toEqual([]);
    expect(result.text).toBe(source.replace("(a   b)\r\n", "(a b)\n"));
    expect(prose(result.text)).toBe(prose(source));
    expect(formatMarkdown(result.text).text).toBe(result.text);
  });
  test("prose and fence markers survive multiline layout", () => {
    const source = "before\n  ```lisp\n  (call one two three four five six)\n  ```\nafter";
    const result = formatMarkdown(source, { softWrap: 20 });
    expect(result.text).toBe("before\n  ```lisp\n  (call one\n    two\n    three\n    four\n    five\n    six)\n  ```\nafter");
    expect(formatMarkdown(result.text, { softWrap: 20 }).text).toBe(result.text);
    expect(prose(result.text)).toBe(prose(source));
  });
  test("fragments are unchanged with diagnostics at authored offsets", () => {
    const source = "before\n  ```lisp\n  (a\n  ```\nafter";
    const result = formatMarkdown(source);
    expect(result.text).toBe(source);
    expect(result.diagnostics[0]).toMatchObject({ code: "format/markdown-fragment", start: source.indexOf("(a"), end: source.indexOf("(a") + 1 });
  });
  test("ignore comments, unsupported blockquotes and directive-like strings", () => {
    const source = "<!-- forma-fmt-ignore -->\n```lisp\n(a   b)\n```\n> ```lisp\n> (a   b)\n> ```\n";
    const result = formatMarkdown(source);
    expect(result.text).toBe(source);
    expect(result.diagnostics.map(d => d.code)).toEqual(["format/markdown-unsupported"]);
    expect(formatLisp('(a   "; forma-fmt: off")').text).toBe('(a "; forma-fmt: off")\n');
  });
  test("ranges select only intersecting top-level forms in a fence", () => {
    const source = "prose\n```lisp\n(a   b)\n(c   d)\n```\n```lisp\n(e   f)\n```\n";
    const start = source.indexOf("b)");
    expect(formatRange(source, { start, end: start + 1 }, { language: "markdown" }).text).toBe(source.replace("(a   b)", "(a b)"));
  });
  test("every tracked Markdown file preserves prose, tokens and idempotence", () => {
    const root = resolve(import.meta.dirname, "../../..");
    const paths = execFileSync("git", ["ls-files", "*.md"], { cwd: root, encoding: "utf8" }).trim().split("\n");
    for (const path of paths) {
      const source = readFileSync(resolve(root, path), "utf8"), result = formatMarkdown(source);
      expect(prose(result.text), path).toBe(prose(source));
      expect(formatMarkdown(result.text).text, path).toBe(result.text);
      const before = extractMarkdownFences(source).filter(isFormaFence), after = extractMarkdownFences(result.text).filter(isFormaFence);
      expect(after.length, path).toBe(before.length);
      before.forEach((block, i) => expect(tokens(after[i]!.text), `${path}#${i}`).toEqual(tokens(block.text)));
    }
  }, 30_000);
});

describe("ignore regions and minimal edits", () => {
  test("paired directives preserve their bytes within a body", () => {
    const source = "(do\n  (a   b)\n  ; forma-fmt: off\n       (c    d) ; raw\n\n\n  ; forma-fmt: on\n  (e   f))\n";
    const result = formatLisp(source);
    expect(result.text).toContain("  ; forma-fmt: off\n       (c    d) ; raw\n\n\n  ; forma-fmt: on\n");
    expect(result.text).toContain("(a b)"); expect(result.text).toContain("(e f)");
    expect(formatLisp(result.text).text).toBe(result.text);
    const selected = source.indexOf("(c");
    expect(formatRange(source, { start: selected, end: selected + 1 }).text).toContain("(c    d)");
  });
  test("an unmatched off preserves the tail, including its line endings", () => {
    const source = "(a   b)\r\n; forma-fmt: off\r\n(c    d)  ";
    expect(formatLisp(source).text).toBe("(a b)\r\n; forma-fmt: off\r\n(c    d)  ");
  });
  test("edits touch whitespace only and apply atomically", () => {
    const source = "(a   b)\n\n(c d)", result = formatLisp(source);
    const edits = formattingEdits(source, result.text);
    expect(edits).toHaveLength(2);
    let applied = source;
    for (const edit of [...edits].reverse()) applied = applied.slice(0, edit.start) + edit.text + applied.slice(edit.end);
    expect(applied).toBe(result.text);
    expect(formattingEdits(result.text, result.text)).toEqual([]);
  });
});

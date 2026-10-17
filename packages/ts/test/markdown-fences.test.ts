import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { extractMarkdownFences, isFormaFence } from "../src/source/markdown.js";

describe("Markdown fence extraction", () => {
  test("delimiters, info, indentation, CRLF and source origins", () => {
    const source = "prose\r\n  ~~~~forma title\r\n  (x)\r\n  ~~~\r\n  ~~~~~\r\n";
    const [block] = extractMarkdownFences(source, "doc.md");
    expect(block).toMatchObject({ language: "forma", text: "(x)\r\n~~~\r\n", closed: true, indent: "  ",
      origin: { kind: "markdown-fence", fileId: "doc.md", blockIndex: 0, blockStartLine: 3, blockStartColumn: 3 } });
    expect(source.slice(block!.bodyStart, block!.bodyEnd)).toBe("  (x)\r\n  ~~~\r\n");
  });
  test("long fences contain short fences; backtick info cannot contain backticks", () => {
    expect(extractMarkdownFences("```lisp `bad`\n(x)\n")).toEqual([]);
    expect(extractMarkdownFences("````lisp\n```\n````\n")[0]!.text).toBe("```\n");
    expect(extractMarkdownFences("```lisp\n(x)\n")[0]!.closed).toBe(false);
  });
  test("ignore comments and unsupported containers are explicit", () => {
    expect(extractMarkdownFences("<!-- forma-fmt-ignore -->\n```lisp\nx\n```\n")[0]!.ignored).toBe(true);
    expect(extractMarkdownFences("> ```lisp\n> (x)\n> ```\n")[0]!.unsupported).toBe(true);
    expect(extractMarkdownFences("<pre>\n```lisp\nx\n```\n</pre>\n")).toEqual([]);
    expect(extractMarkdownFences("    ```lisp\nx\n    ```\n")).toEqual([]);
  });
  test("the existing example corpus extracts exactly the same modules", () => {
    const root = resolve(import.meta.dirname, "../../..");
    const paths = execFileSync("git", ["ls-files", "examples/*.md"], { cwd: root, encoding: "utf8" }).trim().split("\n");
    for (const path of paths) {
      const source = readFileSync(resolve(root, path), "utf8");
      const old = [...source.matchAll(/```(?:lisp|clojure|clj)\n([\s\S]*?)```/g)].map(m => m[1]!);
      expect(extractMarkdownFences(source, path).filter(isFormaFence).map(b => b.text), path).toEqual(old);
    }
  });
});

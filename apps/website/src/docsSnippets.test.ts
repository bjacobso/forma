import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { homeSnippetDir, homeSnippets } from "./docsSnippets";
import { effectPageSnippets, effectSnippetDir, typecheck } from "./effectPageSnippets";

const repoRoot = resolve(import.meta.dirname, "../../..");
const snippetDir = resolve(repoRoot, homeSnippetDir);
const update = process.env.UPDATE_HOME_SNIPPETS === "1";

describe("docs homepage snippets", () => {
  const snippets = homeSnippets();

  if (update) {
    mkdirSync(snippetDir, { recursive: true });
    for (const [name, content] of Object.entries(snippets)) {
      writeFileSync(resolve(snippetDir, name), content);
    }
  }

  test("contain exactly the generated files", () => {
    expect(readdirSync(snippetDir).sort()).toEqual(Object.keys(snippets).sort());
  });

  test.each(Object.keys(snippets))("%s matches engine output", (name) => {
    expect(
      readFileSync(resolve(snippetDir, name), "utf8"),
      "Run `pnpm --filter @formalang/website snippets:home` to regenerate.",
    ).toBe(snippets[name]);
  });


});

describe("docs /effect page snippets", () => {
  const snippets = effectPageSnippets();
  const dir = resolve(repoRoot, effectSnippetDir);

  if (update) {
    mkdirSync(dir, { recursive: true });
    for (const [name, content] of Object.entries(snippets)) {
      writeFileSync(resolve(dir, name), content);
    }
  }

  test("contain exactly the generated files", () => {
    expect(readdirSync(dir).sort()).toEqual(Object.keys(snippets).sort());
  });

  test.each(Object.keys(snippets))("%s matches engine output", (name) => {
    expect(
      readFileSync(resolve(dir, name), "utf8"),
      "Run `pnpm --filter @formalang/website snippets:home` to regenerate.",
    ).toBe(snippets[name]);
  });

  test("the generated example typechecks under the strict suite settings", () => {
    expect(typecheck(snippets["orders.ts"]!, "orders.ts")).toEqual([]);
  });

  test("the page's size claim matches the table", () => {
    const total = snippets["sizes.md"]!.match(/\*\*All cases\*\* \| \*\*(\d+)\*\* \| \*\*(\d+)\*\*/);
    expect(total).not.toBeNull();
    const ratio = (Number(total![2]) / Number(total![1])).toFixed(1);
    const page = readFileSync(resolve(repoRoot, "docs/effect.md"), "utf8");
    expect(page).toContain(`about ${ratio} times as many lines`);
  });

  test("the remaining static examples use the generated snippets", () => {
    const page = readFileSync(resolve(repoRoot, "docs/effect.md"), "utf8");
    for (const name of ["orders.lisp", "strict.lisp", "strict.forma.txt", "strict.tsc.txt", "sizes.md"]) {
      expect(snippets[name]).toBeDefined();
      expect(page).toContain(`snippets/effect/${name}`);
    }
  });
});

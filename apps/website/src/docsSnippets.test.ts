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

describe("docs /foldkit page excerpts", () => {
  const dir = resolve(repoRoot, "docs/snippets/foldkit");
  const page = readFileSync(resolve(repoRoot, "docs/foldkit.md"), "utf8");
  // Each excerpt is copied from the workbench; `// …` marks omitted lines.
  const sources: Record<string, string> = {
    "main.ts": "apps/workbench/src/main.ts",
    "host.ts": "packages/workbench/src/host.ts",
    "commands.ts": "packages/workbench/src/commands.ts",
    "update.ts": "packages/workbench/src/update.ts",
    "capabilities.ts": "apps/workbench/src/program/capabilities.ts",
    "run-commands.ts": "packages/workbench/src/run-commands.ts",
  };
  // The tests the page cites as evidence, by file and title.
  const evidence: ReadonlyArray<readonly [string, string]> = [
    ["packages/workbench/test/run.test.ts", "gates every host call, propagates requirements, and cancels a stale permission on edits"],
    ["packages/workbench/test/values.test.ts", "observes calls inside functions and macro arguments without running capabilities"],
    ["packages/workbench/test/values.test.ts", "projects retained values in their own session, then releases them"],
    ["packages/workbench/test/workspace.test.ts", "REPL replay never performs a host capability"],
    ["packages/workbench/test/source.test.ts", "reconciles source edits without changing untouched node ids or layout"],
    ["packages/workbench/test/edits.test.ts", "renames a definition and its uses, preserves shadowing, and undoes atomically with exact source"],
    ["apps/workbench/e2e/capabilities.pw.ts", "requires approval for read and write calls and shows the completed values"],
    ["apps/workbench/e2e/editing.pw.ts", "analyzes each edit and underlines the new type error"],
  ];

  test("contain exactly the listed excerpts", () => {
    expect(readdirSync(dir).sort()).toEqual(Object.keys(sources).sort());
  });

  test.each(Object.entries(sources))("%s is an excerpt of %s", (name, path) => {
    const source = readFileSync(resolve(repoRoot, path), "utf8");
    let from = 0;
    for (const chunk of readFileSync(resolve(dir, name), "utf8").split(/^[ \t]*\/\/ …\n/mu)) {
      const at = source.indexOf(chunk, from);
      expect(at, `Copy the current text of ${path} into docs/snippets/foldkit/${name}.`).toBeGreaterThanOrEqual(0);
      from = at + chunk.length;
    }
    expect(page).toContain(`snippets/foldkit/${name}`);
  });

  test.each(evidence)("%s has the cited test", (path, title) => {
    expect(readFileSync(resolve(repoRoot, path), "utf8")).toContain(`("${title}"`);
    expect(page).toContain(title);
  });
});

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { homeSnippetDir, homeSnippets, spanLines, typecheckDiagnostic } from "./docsSnippets";
import { undeclaredCapabilitySource } from "./pipelines/sources";

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

  test("the homepage highlights the lines the diagnostic points at", () => {
    const diagnostic = typecheckDiagnostic(undeclaredCapabilitySource, "log.lisp");
    const [start, end] = spanLines(`${undeclaredCapabilitySource}\n`, diagnostic);
    const homepage = readFileSync(resolve(repoRoot, "docs/index.md"), "utf8");

    expect(homepage).toContain(`<<< @/snippets/home/log-undeclared.lisp{${start}-${end}}`);
  });
});

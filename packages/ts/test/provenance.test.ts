/**
 * Provenance is data, written once (docs/language-services.md, 7.3).
 *
 * Every program of the corpus is expanded, and the expanded tree is checked:
 * every node has exactly one origin, no node object occurs twice, none is a
 * node of the parse or of a macro definition, and every author node an origin
 * names is in the parsed document.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, test } from "vitest";
import fc from "fast-check";

import { Builtins, Expander, Evaluator } from "../src/index.js";
import { parse, toSExprMany, type SExpr } from "../src/reader/index.js";
import { children } from "../src/reader/types.js";
import { runs } from "./support/runs.js";

const root = new URL("../../..", import.meta.url).pathname;

const filesUnder = (directory: string, extension: string): string[] =>
  readdirSync(join(root, directory), { recursive: true, encoding: "utf8" })
    .filter((path) => path.endsWith(extension))
    .sort()
    .map((path) => join(directory, path));

interface Program {
  readonly name: string;
  readonly source: string;
}

/** The Forma code blocks of a Markdown file, as one program and one per block. */
const markdownPrograms = (path: string): Program[] => {
  const text = readFileSync(join(root, path), "utf8");
  const blocks = [...text.matchAll(/```lisp\n([\s\S]*?)```/g)].map((match) => match[1]!);
  if (blocks.length === 0) return [];
  return [
    { name: path, source: blocks.join("\n") },
    ...blocks.map((source, index) => ({ name: `${path}#${index}`, source })),
  ];
};

const corpus: readonly Program[] = [
  ...filesUnder("examples", ".md").flatMap(markdownPrograms),
  ...[
    ...filesUnder("preludes", ".lisp"),
    ...filesUnder("conformance", ".lisp"),
    ...filesUnder("packages/ts/test/fixtures", ".lisp"),
  ].map((path) => ({ name: path, source: readFileSync(join(root, path), "utf8") })),
];

const subtree = (nodes: readonly SExpr[]): SExpr[] => {
  const result: SExpr[] = [];
  const visit = (node: SExpr): void => {
    result.push(node);
    children(node).forEach(visit);
  };
  nodes.forEach(visit);
  return result;
};

const macroNodes = (env: ReturnType<typeof Expander.getPreludeEnvSync>) =>
  env
    .bindingNames()
    .map((name) => env.lookup(name) ?? null)
    .filter(Evaluator.isKMacro)
    .flatMap((macro) => subtree([macro.body]));

/** Violations of the provenance invariant in the expansion of `exprs`. */
const violations = (
  exprs: readonly SExpr[],
  expanded: readonly SExpr[],
  definitions: ReadonlySet<SExpr>,
): string[] => {
  const parsed = new Set(subtree(exprs));
  const seen = new Set<SExpr>();
  const found: string[] = [];
  const describe = (node: SExpr) => `${node._tag} at ${node.loc.start}`;
  for (const node of subtree(expanded)) {
    if (seen.has(node)) found.push(`${describe(node)} occurs twice`);
    seen.add(node);
    if (parsed.has(node)) found.push(`${describe(node)} is a parse node`);
    if (definitions.has(node)) found.push(`${describe(node)} is a macro definition's node`);
    const origin = Expander.originOf(node);
    if (!origin) {
      found.push(`${describe(node)} has no origin`);
      continue;
    }
    if (!parsed.has(origin.site)) found.push(`${describe(node)} is located outside the document`);
    if (origin.authors.some((author) => !parsed.has(author))) {
      found.push(`${describe(node)} stands for a node outside the document`);
    }
    if (origin.role === "source" && origin.authors.length !== 1) {
      found.push(`${describe(node)} is source for ${origin.authors.length} nodes`);
    }
    const standsForNothing = origin.role === "introduced" || origin.role === "desugared";
    if (standsForNothing && origin.authors.length > 0) {
      found.push(`${describe(node)} is ${origin.role} but stands for author code`);
    }
    if (node.loc !== origin.site.loc) found.push(`${describe(node)} is not at its site`);
  }
  return found;
};

describe("expansion provenance", () => {
  const builtins = Builtins.defaultBuiltins;
  const preludeDefinitions = macroNodes(Expander.getPreludeEnvSync(builtins));

  test("every expanded node of the corpus has one origin and is fresh", () => {
    let expandedPrograms = 0;
    const failures: string[] = [];
    for (const { name, source } of corpus) {
      const parsed = parse(source);
      if (parsed.errors.length > 0) continue;
      const exprs = toSExprMany(parsed.redTree);
      for (const keepMacroDefs of [false, true]) {
        let result: ReturnType<typeof Expander.expandProgramSync>;
        try {
          result = Expander.expandProgramSync(exprs, { builtins, keepMacroDefs });
        } catch {
          continue; // A program that does not expand on its own.
        }
        expandedPrograms++;
        const definitions = new Set([...preludeDefinitions, ...macroNodes(result.env)]);
        for (const violation of violations(exprs, result.exprs, definitions)) {
          failures.push(`${relative(root, join(root, name))}: ${violation}`);
        }
      }
    }
    expect(failures.slice(0, 20)).toEqual([]);
    expect(expandedPrograms).toBeGreaterThan(300);
  });

  test("an origin is written once", () => {
    const [expr] = toSExprMany(parse("(when true 1)").redTree);
    const [expanded] = Expander.expandProgramSync([expr!], { builtins }).exprs;
    expect(Expander.originOf(expanded!)).toMatchObject({ role: "expansion", authors: [expr] });
    // Handing an emitted node back to the expander copies it; it never re-registers it.
    const [again] = Expander.expandProgramSync([expanded!], { builtins }).exprs;
    expect(again).not.toBe(expanded);
    expect(Expander.originOf(again!)).toBe(Expander.originOf(expanded!));
  });

  test("public origins cannot be rewritten through a returned reference", () => {
    const exprs = toSExprMany(parse("(when true 1)").redTree);
    const [expanded] = Expander.expandProgramSync(exprs, { builtins }).exprs;
    const origin = Expander.originOf(expanded!)!;
    expect(Object.isFrozen(origin)).toBe(true);
    expect(Object.isFrozen(origin.authors)).toBe(true);
    expect(Object.isFrozen(origin.macroOrigins)).toBe(true);
    expect(origin.macroOrigins!.every(Object.isFrozen)).toBe(true);
    expect(Reflect.set(origin, "role", "introduced")).toBe(false);
    expect(Reflect.set(origin.authors, "0", expanded)).toBe(false);
    expect(Reflect.set(origin.macroOrigins![0]!, "macroName", "other")).toBe(false);
    expect(origin.role).toBe("expansion");
    expect(origin.authors).toEqual(exprs);
  });

  test("random nested expansions emit disjoint trees with fixed author origins", () => {
    const expr = fc.letrec<{ expr: string }>((tie) => ({
      expr: fc.oneof(
        { depthSize: "small", withCrossShrink: true },
        fc.integer({ min: -10, max: 10 }).map(String),
        tie("expr").map((item) => `(dup (id ${item}))`),
        fc.tuple(tie("expr"), tie("expr")).map(([a, b]) => `(when true [${a} ${b}])`),
        fc.tuple(tie("expr"), tie("expr")).map(([a, b]) => `(let [[x y] [${a} ${b}]] (+ x y))`),
        tie("expr").map((item) => `'{:key [${item}]}`),
        tie("expr").map((item) => `\`(datum ~${item})`),
      ),
    })).expr;
    fc.assert(
      fc.property(expr, (body) => {
        const source = `(define-macro id [x] x)\n(define-macro dup [x] \`(do ~x ~x))\n${body}`;
        const exprs = toSExprMany(parse(source).redTree);
        const first = Expander.expandProgramSync(exprs, { builtins, keepMacroDefs: true });
        const second = Expander.expandProgramSync(exprs, { builtins, keepMacroDefs: true });
        const definitions = new Set([...preludeDefinitions, ...macroNodes(first.env), ...macroNodes(second.env)]);
        expect(violations(exprs, first.exprs, definitions)).toEqual([]);
        expect(violations(exprs, second.exprs, definitions)).toEqual([]);
        const firstNodes = new Set(subtree(first.exprs));
        for (const node of subtree(second.exprs)) {
          expect(firstNodes.has(node)).toBe(false);
          expect(Object.isFrozen(Expander.originOf(node))).toBe(true);
        }
      }),
      { numRuns: runs(200) },
    );
  }, Math.max(60_000, runs(60_000)));
});

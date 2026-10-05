/**
 * Effect TypeScript conformance suite: conformance/effect-typescript/cases.
 *
 * A positive case (program.lisp + expected.ts + harness.ts) must elaborate
 * with no diagnostics, generate exactly expected.ts, typecheck under the
 * repository's strict tsconfig with no `any` escapes, and pass its runtime
 * harness. A negative case (program.lisp + expected-diagnostics.json) must be
 * rejected with exactly those located diagnostics.
 *
 * Set FORMA_UPDATE_GOLDEN=1 to rewrite expected.ts and expected-diagnostics.json.
 */
import { beforeAll, describe, expect, test } from "vitest";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
import { Mechanics } from "../src/index.js";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const suiteDir = resolve(packageDir, "../../conformance/effect-typescript");
const casesDir = resolve(suiteDir, "cases");
const update = process.env["FORMA_UPDATE_GOLDEN"] === "1";

interface ConformanceCase {
  readonly name: string;
  readonly dir: string;
  readonly source: string;
}

const cases: readonly ConformanceCase[] = readdirSync(casesDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(resolve(casesDir, entry.name, "program.lisp")))
  .map((entry) => ({
    name: entry.name,
    dir: resolve(casesDir, entry.name),
    source: readFileSync(resolve(casesDir, entry.name, "program.lisp"), "utf8"),
  }))
  .sort((left, right) => left.name.localeCompare(right.name));

const positive = cases.filter((item) => existsSync(resolve(item.dir, "harness.ts")));
const negative = cases.filter((item) => existsSync(resolve(item.dir, "expected-diagnostics.json")));

function normalize(code: string): string {
  return `${code
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trimEnd()}\n`;
}

function sourceId(item: ConformanceCase): string {
  return `cases/${item.name}/program.lisp`;
}

interface DiagnosticRecord {
  readonly phase: string;
  readonly severity: string;
  readonly code: string;
  readonly message: string;
  readonly line?: number;
  readonly column?: number;
  readonly endLine?: number;
  readonly endColumn?: number;
}

function diagnosticRecords(source: string, item: ConformanceCase): readonly DiagnosticRecord[] {
  return Mechanics.elaborateEffectProgram(source, { sourceId: sourceId(item) }).diagnostics.map((diagnostic) => ({
    phase: diagnostic.phase,
    severity: diagnostic.severity,
    code: diagnostic.code,
    message: diagnostic.message,
    ...(diagnostic.span
      ? {
          line: diagnostic.span.startLine,
          column: diagnostic.span.startColumn,
          endLine: diagnostic.span.endLine,
          endColumn: diagnostic.span.endColumn,
        }
      : {}),
  }));
}

let program: ts.Program | undefined;

/** One TypeScript program over every golden and harness, with the suite tsconfig. */
function typescriptProgram(): ts.Program {
  if (program) return program;
  const configPath = resolve(suiteDir, "tsconfig.json");
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, "\n"));
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, suiteDir);
  program = ts.createProgram(parsed.fileNames, parsed.options);
  return program;
}

function location(file: ts.SourceFile, node: ts.Node): string {
  const { line, character } = file.getLineAndCharacterOfPosition(node.getStart(file));
  return `${line + 1}:${character + 1}`;
}

/** Identifiers in type annotations, imports, and declarations name things rather than evaluate them. */
function isValuePosition(node: ts.Node): boolean {
  for (let current: ts.Node | undefined = node; current; current = current.parent) {
    if (ts.isTypeNode(current) || ts.isImportDeclaration(current) || ts.isHeritageClause(current)) return false;
    if (ts.isStatement(current)) break;
  }
  const parent = node.parent;
  if (parent && (ts.isPropertyAccessExpression(parent) && parent.name === node)) return false;
  if (parent && ts.isPropertyAssignment(parent) && parent.name === node) return false;
  if (parent && (ts.isVariableDeclaration(parent) || ts.isParameter(parent) || ts.isClassDeclaration(parent)) && parent.name === node) return false;
  return true;
}

/** Explicit escapes (`any`, casts, non-null assertions, ts-comments) and inferred `any`. */
function anyEscapes(file: ts.SourceFile, checker: ts.TypeChecker): readonly string[] {
  const problems: string[] = [];
  if (/@ts-(ignore|expect-error|nocheck)/.test(file.text)) problems.push("contains a @ts- directive");
  const visit = (node: ts.Node): void => {
    if (node.kind === ts.SyntaxKind.AnyKeyword) problems.push(`${location(file, node)} explicit any`);
    if (node.kind === ts.SyntaxKind.UnknownKeyword) problems.push(`${location(file, node)} explicit unknown`);
    if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) {
      const isConst = ts.isAsExpression(node) && node.type.getText(file) === "const";
      if (!isConst) problems.push(`${location(file, node)} type assertion ${node.getText(file)}`);
    }
    if (ts.isNonNullExpression(node)) problems.push(`${location(file, node)} non-null assertion`);
    if ((ts.isIdentifier(node) || ts.isCallExpression(node) || ts.isPropertyAccessExpression(node)) && isValuePosition(node)) {
      const type = checker.getTypeAtLocation(node);
      if (type.flags & ts.TypeFlags.Any) problems.push(`${location(file, node)} ${node.getText(file)} has type any`);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return problems;
}

describe("Effect TypeScript conformance", () => {
  beforeAll(() => {
    if (!update) return;
    for (const item of positive) {
      const result = Mechanics.generateEffectProgram(item.source, { sourceId: sourceId(item) });
      if (result.code) writeFileSync(resolve(item.dir, "expected.ts"), normalize(result.code));
    }
  });

  test("has cases", () => {
    expect(positive.length).toBeGreaterThan(0);
    expect(negative.length).toBeGreaterThan(0);
    for (const item of cases) {
      expect(positive.includes(item) || negative.includes(item), `${item.name} needs harness.ts or expected-diagnostics.json`).toBe(true);
    }
  });

  describe.each(positive)("$name", (item) => {
    const goldenPath = resolve(item.dir, "expected.ts");

    test("elaborates with no diagnostics and matches expected.ts", () => {
      const result = Mechanics.generateEffectProgram(item.source, { sourceId: sourceId(item) });
      expect(diagnosticRecords(item.source, item)).toEqual([]);
      expect(result.code).toBeDefined();
      expect(normalize(result.code ?? "")).toBe(normalize(readFileSync(goldenPath, "utf8")));
    });

    test("typechecks under the strict tsconfig without any escapes", () => {
      const tsProgram = typescriptProgram();
      const files = [goldenPath, resolve(item.dir, "harness.ts")];
      const diagnostics = files.flatMap((file) => {
        const sourceFile = tsProgram.getSourceFile(file);
        if (!sourceFile) return [`${file} is not part of the suite tsconfig`];
        return ts
          .getPreEmitDiagnostics(tsProgram, sourceFile)
          .map((diagnostic) => {
            const position = diagnostic.start === undefined ? "" : (() => {
              const { line, character } = sourceFile.getLineAndCharacterOfPosition(diagnostic.start);
              return `${line + 1}:${character + 1} `;
            })();
            return `${file.slice(casesDir.length + 1)} ${position}${ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")}`;
          });
      });
      expect(diagnostics).toEqual([]);
      const golden = tsProgram.getSourceFile(goldenPath)!;
      expect(anyEscapes(golden, tsProgram.getTypeChecker())).toEqual([]);
    }, 60_000);

    test("runs the harness", async () => {
      const harness = (await import(pathToFileURL(resolve(item.dir, "harness.ts")).href)) as {
        readonly default: () => Promise<void>;
      };
      await harness.default();
    }, 30_000);
  });

  describe.each(negative)("$name", (item) => {
    const expectedPath = resolve(item.dir, "expected-diagnostics.json");

    test("is rejected with located diagnostics", () => {
      const actual = diagnosticRecords(item.source, item);
      if (update) writeFileSync(expectedPath, `${JSON.stringify(actual, null, 2)}\n`);
      const expected = JSON.parse(readFileSync(expectedPath, "utf8")) as readonly DiagnosticRecord[];
      expect(actual.some((diagnostic) => diagnostic.severity === "error")).toBe(true);
      expect(actual.every((diagnostic) => diagnostic.line !== undefined)).toBe(true);
      expect(actual).toEqual(expected);
      expect(Mechanics.generateEffectProgram(item.source, { sourceId: sourceId(item) }).code).toBeUndefined();
    });
  });
});

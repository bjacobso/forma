import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import {
  generateEffectProgram,
  generateMechanicsEffectTypeScriptModule,
  mechanicsPackageableDeclarations,
} from "@formalang/ts/mechanics";
import { parseManyToSExpr } from "@formalang/ts/reader";
import { Effect } from "effect";
import { ordersSource, ordersUndeclaredSource, strictSource } from "./effectPageSources";

/** Directory, relative to the repository root, that the docs `/effect` page imports. */
export const effectSnippetDir = "docs/snippets/effect";

const repoRoot = resolve(import.meta.dirname, "../../..");
const suiteDir = resolve(repoRoot, "conformance/effect-typescript");

/**
 * Every code sample and number on the `/effect` page: Forma sources, the
 * TypeScript they generate, Forma's diagnostics, what `tsc` says about the
 * same mistakes when the checker is bypassed, and source/output sizes of the
 * conformance cases. Regenerate with `pnpm --filter @formalang/website snippets:home`.
 */
export function effectPageSnippets(): Record<string, string> {
  return {
    "orders.lisp": `${ordersSource}\n`,
    "orders.ts": generated(ordersSource, "orders.lisp"),
    "orders-undeclared.lisp": `${ordersUndeclaredSource}\n`,
    "orders-undeclared.forma.txt": formaDiagnostics(ordersUndeclaredSource, "orders.lisp"),
    "orders-undeclared.tsc.txt": uncheckedTsc(ordersUndeclaredSource, "orders.ts"),
    "strict.lisp": `${strictSource}\n`,
    "strict.forma.txt": formaDiagnostics(strictSource, "strict.lisp"),
    "strict.tsc.txt": uncheckedTsc(strictSource, "strict.ts"),
    "sizes.md": sizesTable(),
  };
}

function generated(source: string, sourceId: string): string {
  const result = generateEffectProgram(source, { sourceId });
  if (!result.code || result.diagnostics.length > 0) {
    throw new Error(`${sourceId} did not generate: ${JSON.stringify(result.diagnostics)}`);
  }
  return result.code;
}

function formaDiagnostics(source: string, sourceId: string): string {
  const result = generateEffectProgram(source, { sourceId });
  if (result.diagnostics.length === 0) throw new Error(`${sourceId} was accepted`);
  return `${result.diagnostics
    .map((diagnostic) => {
      const at = diagnostic.span ? `${sourceId}:${diagnostic.span.startLine}:${diagnostic.span.startColumn}` : sourceId;
      return `${at} ${diagnostic.severity} ${diagnostic.code}\n  ${diagnostic.message}`;
    })
    .join("\n\n")}\n`;
}

/** Generates TypeScript with the Forma checker bypassed and reports what tsc says about it. */
function uncheckedTsc(source: string, fileName: string): string {
  const forms = Effect.runSync(parseManyToSExpr(source));
  const projected = mechanicsPackageableDeclarations(forms, fileName);
  if (!projected.ok) throw new Error(`${fileName} did not project`);
  const code = generateMechanicsEffectTypeScriptModule(projected.declarations).code;
  const diagnostics = typecheck(code, fileName);
  if (diagnostics.length === 0) return `$ tsc --noEmit ${fileName}\n(no errors)\n`;
  return `$ tsc --noEmit ${fileName}\n${diagnostics.join("\n\n")}\n`;
}

/** Typechecks a module with the conformance suite's strict settings. */
export function typecheck(code: string, fileName: string): readonly string[] {
  const config = ts.readConfigFile(resolve(suiteDir, "tsconfig.json"), ts.sys.readFile);
  const options = ts.parseJsonConfigFileContent(config.config, ts.sys, suiteDir).options;
  const path = resolve(suiteDir, `__effect_page__${fileName}`);
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile.bind(host);
  const fileExists = host.fileExists.bind(host);
  host.getSourceFile = (name, version, onError, create) =>
    name === path ? ts.createSourceFile(name, code, version, true) : getSourceFile(name, version, onError, create);
  host.fileExists = (name) => name === path || fileExists(name);
  const program = ts.createProgram([path], options, host);
  const file = program.getSourceFile(path)!;
  return ts.getPreEmitDiagnostics(program, file).map((diagnostic) => {
    const { line, character } = file.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
    return `${fileName}:${line + 1}:${character + 1} - error TS${diagnostic.code}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n  ")}`;
  });
}

/** Non-blank, non-comment lines and characters of each conformance program and its output. */
function sizesTable(): string {
  const casesDir = resolve(suiteDir, "cases");
  const rows: string[] = [];
  let totalSource = 0;
  let totalOutput = 0;
  for (const name of readdirSync(casesDir).sort()) {
    if (!existsSync(resolve(casesDir, name, "harness.ts"))) continue;
    const source = meaningfulLines(readFileSync(resolve(casesDir, name, "program.lisp"), "utf8"), ";");
    const output = meaningfulLines(readFileSync(resolve(casesDir, name, "expected.ts"), "utf8"), "//");
    totalSource += source;
    totalOutput += output;
    rows.push(`| \`${name}\` | ${source} | ${output} | ${(output / source).toFixed(2)}× |`);
  }
  return [
    "| Conformance case | Forma lines | Generated TypeScript lines | Ratio |",
    "| --- | ---: | ---: | ---: |",
    ...rows,
    `| **All cases** | **${totalSource}** | **${totalOutput}** | **${(totalOutput / totalSource).toFixed(2)}×** |`,
    "",
  ].join("\n");
}

function meaningfulLines(text: string, comment: string): number {
  return text.split("\n").filter((line) => line.trim() !== "" && !line.trim().startsWith(comment)).length;
}

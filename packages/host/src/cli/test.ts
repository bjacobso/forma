import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, join, resolve, sep } from "node:path";
import { readModuleGraph, readNodePackages } from "@formalang/ts/node";
import { ModuleError } from "@formalang/ts/modules";
import { TsLanguageHost } from "../ts-host.js";
import type { AstNode, Diagnostic, Span } from "../types.js";
import { displayPath, renderDiagnostics } from "./output.js";

const STEP_LIMIT = 50_000;
const ignored = new Set(["node_modules", ".git", ".context", "dist", "dist-ts"]);

function discover(paths: readonly string[]): string[] {
  const files = new Set<string>();
  const visited = new Set<string>();
  function visit(path: string, explicit: boolean, inTest = false) {
    const canonical = realpathSync(path);
    if (statSync(canonical).isFile()) {
      if (explicit || canonical.endsWith("-test.lisp") || (inTest && canonical.endsWith(".lisp"))) files.add(canonical);
      return;
    }
    if (visited.has(canonical)) return;
    visited.add(canonical);
    for (const entry of readdirSync(canonical, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isSymbolicLink() || ignored.has(entry.name)) continue;
      visit(join(canonical, entry.name), false, inTest || basename(canonical) === "test");
    }
  }
  for (const path of paths) visit(resolve(path), true, resolve(path).split(sep).includes("test"));
  return [...files].sort();
}

interface TestCase { name: string; span: Span; head: Span; nameSpan: Span }
interface TestResult { module: string; name: string; status: "passed" | "failed"; span: Span; diagnostics: readonly Diagnostic[] }
interface FileResult { module: string; status: "passed" | "failed"; diagnostics: readonly Diagnostic[] }

function cases(ast: readonly AstNode[]): TestCase[] {
  return ast.flatMap(node => {
    if (node.kind !== "list" || node.items[0]?.kind !== "symbol" || node.items[0].value !== "test") return [];
    const name = node.items[1];
    if (name?.kind !== "string" || !node.span || !node.items[0].span || !name.span) throw new Error("A top-level test needs a literal string name.");
    return [{ name: name.value, span: node.span, head: node.items[0].span, nameSpan: name.span }];
  });
}

/** Replace only the selected macro's head/name, preserving every body offset. */
function selectedSource(source: string, test: TestCase): string {
  const blank = source.slice(test.head.startOffset, test.nameSpan.endOffset).replace(/[^\r\n]/g, " ");
  return source.slice(0, test.head.startOffset) + "do" + blank.slice(2) + source.slice(test.nameSpan.endOffset);
}

export async function testFiles(args: readonly string[]): Promise<boolean> {
  const paths: string[] = [];
  let json = false, filter = "";
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--json") json = true;
    else if (arg === "--filter") {
      const value = args[++i];
      if (value === undefined || value.startsWith("-")) return false;
      filter = value;
    } else if (arg.startsWith("-")) return false;
    else paths.push(arg);
  }
  const results: TestResult[] = [], files: FileResult[] = [];
  for (const module of discover(paths.length ? paths : ["."])) {
    try {
      const graph = readModuleGraph(module);
      const packages = readNodePackages(module);
      const source = readFileSync(module, "utf8");
      async function session<T>(text: string, action: (host: TsLanguageHost, sessionId: string) => Promise<T>): Promise<T> {
        const host = new TsLanguageHost();
        const { sessionId } = await host.openSession();
        try {
          if (packages) await host.configureSession({ sessionId, packages: packages.table });
          const loaded = await host.loadSourceBundle({ sessionId, sources: graph.modules.map(m => ({ kind: "source" as const, sourceId: m.id, source: m.id === graph.entry ? text : m.source })) });
          if (loaded.diagnostics.some(d => d.severity === "error")) throw new ModuleError(loaded.diagnostics[0]!, loaded.diagnostics.slice(1));
          return await action(host, sessionId);
        } finally { await host.closeSession({ sessionId }); }
      }
      const checked = await session(source, (host, sessionId) => host.typecheck({ sessionId, sourceId: graph.entry }));
      if (checked.diagnostics.some(d => d.severity === "error")) {
        files.push({ module, status: "failed", diagnostics: checked.diagnostics });
        continue;
      }
      const parsed = await new TsLanguageHost().parse({ sourceId: module, source });
      const tests = cases(parsed.ast);
      files.push({ module, status: "passed", diagnostics: checked.diagnostics });
      for (const test of tests.filter(test => test.name.includes(filter))) {
        const state = await session(selectedSource(source, test), (host, sessionId) => host.evaluateInSession({ sessionId, sourceId: graph.entry, stepLimit: STEP_LIMIT }));
        const diagnostics = state.status === "failed" ? state.diagnostics : state.status === "completed" ? state.result.diagnostics : [];
        results.push({ module, name: test.name, span: test.span, status: state.status === "completed" && !diagnostics.some(d => d.severity === "error") ? "passed" : "failed", diagnostics });
      }
    } catch (error) {
      files.push({ module, status: "failed", diagnostics: error instanceof ModuleError ? error.diagnostics : [{ severity: "error", code: "io/error", message: String(error) }] });
    }
  }
  const ok = files.every(f => f.status === "passed") && results.every(r => r.status === "passed");
  if (json) process.stdout.write(JSON.stringify({ ok, files, results }) + "\n");
  else {
    for (const file of files) {
      if (file.status === "failed") process.stdout.write(`FAIL ${displayPath(file.module)} (check)\n`);
      if (file.diagnostics.length) process.stderr.write(renderDiagnostics(file.diagnostics));
    }
    for (const result of results) {
      process.stdout.write(`${result.status === "passed" ? "PASS" : "FAIL"} ${result.name} (${displayPath(result.module)})\n`);
      if (result.diagnostics.length) process.stderr.write(renderDiagnostics(result.diagnostics));
    }
    process.stdout.write(`${results.filter(r => r.status === "passed").length} passed, ${results.filter(r => r.status === "failed").length} failed; ${files.filter(f => f.status === "failed").length} files failed\n`);
  }
  if (!ok) process.exitCode = 1;
  return true;
}

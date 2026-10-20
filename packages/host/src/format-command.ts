import { readFileSync, writeFileSync, statSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";
import { fileFormatOptions } from "@formalang/ts/node";
import { formatSource, formattingEdits } from "./format.js";

class FormatUsageError extends Error {}
const usage = "Usage: forma fmt [--check] [--strict] <paths…> | forma fmt [--check] [--strict] --stdin [--stdin-filepath file.forma]\n";
const supported = (path: string) => [".lisp", ".forma", ".md"].includes(extname(path).toLowerCase());
function shortDiff(before: string, after: string): string {
  const edit = formattingEdits(before, after)[0];
  if (!edit) return "";
  const line = before.slice(0, edit.start).split("\n").length;
  const oldLines = before.split("\n"), newLines = after.split("\n");
  const clip = (s: string) => s.length > 120 ? s.slice(0, 117) + "..." : s;
  return `@@ line ${line} @@\n-${clip(oldLines[line - 1] ?? "")}\n+${clip(newLines[line - 1] ?? "")}\n${before.endsWith("\n") ? "" : "\\ No newline at end of file\n"}`;
}
export function formatCommand(args: readonly string[]): number {
  let check = false, strict = false, stdin = false, filepath: string | undefined, positional = false;
  const paths: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (positional) paths.push(arg);
    else if (arg === "--") positional = true;
    else if (arg === "--check") check = true;
    else if (arg === "--strict") strict = true;
    else if (arg === "--stdin") stdin = true;
    else if (arg === "--stdin-filepath" && args[i + 1] && !args[i + 1]!.startsWith("--")) filepath = args[++i];
    else if (arg.startsWith("-")) { process.stderr.write(usage); return 64; }
    else paths.push(arg);
  }
  if (stdin && paths.length || !stdin && (!paths.length || filepath !== undefined) || filepath !== undefined && !supported(filepath)) { process.stderr.write(usage); return 64; }
  const files = new Set<string>();
  const collect = (path: string): void => {
    if (statSync(path).isDirectory()) {
      for (const entry of readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
        const child = join(path, entry.name);
        if (entry.isDirectory()) collect(child); else if (entry.isFile() && supported(child)) files.add(child);
      }
    } else if (supported(path)) files.add(path);
    else throw new FormatUsageError(`Unsupported formatter path: ${path}`);
  };
  let exit = 0;
  const run = (path: string, source: string) => {
    const context = fileFormatOptions(path, source);
    const result = formatSource({ source, language: /\.md$/i.test(path) ? "markdown" : "lisp", options: context.options });
    for (const d of [...context.diagnostics, ...result.diagnostics]) {
      process.stderr.write(`${path}:${source.slice(0, d.start).split("\n").length}: ${d.code}: ${d.message}\n`);
      if (strict || d.code === "format/parse") exit = 1;
    }
    if (check) { if (result.changed) { process.stdout.write(path + "\n" + shortDiff(source, result.text)); exit = 1; } }
    else if (stdin) process.stdout.write(result.text);
    else if (result.changed) { writeFileSync(path, result.text); process.stdout.write(path + "\n"); }
  };
  try {
    if (stdin) run(filepath ?? "stdin.forma", readFileSync(0, "utf8"));
    else { for (const path of paths) collect(path); for (const file of [...files].sort()) run(file, readFileSync(file, "utf8")); }
  } catch (error) { process.stderr.write(String(error) + "\n"); if (error instanceof FormatUsageError) { process.stderr.write(usage); return 64; } return 1; }
  return exit;
}

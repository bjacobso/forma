import { readFileSync } from "node:fs";
import { isAbsolute, relative } from "node:path";
import type { Diagnostic } from "../types.js";
import type { JsonResponse } from "../json-abi.js";
import { authorNames, locateDiagnostic, locateResponse } from "../diagnostic-locations.js";

export function fileText(sourceId: string): string | undefined {
  try { return isAbsolute(sourceId) ? readFileSync(sourceId, "utf8") : undefined; } catch { return undefined; }
}
export const displayPath = (path: string) => isAbsolute(path) ? relative(process.cwd(), path) || "." : path;
export function printJson(response: JsonResponse) {
  process.stdout.write(JSON.stringify(response) + "\n");
}
export function located(response: JsonResponse): JsonResponse {
  return locateResponse(response, fileText);
}

/** Temporary compatibility with messages that still embed their source position. */
export function diagnosticMessage(message: string): string {
  return authorNames(message).replace(/\s*\(at line \d+, column \d+\)\s*$/, "");
}

export function renderDiagnostics(diagnostics: readonly Pick<Diagnostic, "code" | "severity" | "message" | "span" | "help" | "fix">[], sourceText = fileText, color = Boolean(process.stderr.isTTY) && process.env.NO_COLOR === undefined): string {
  const lines: string[] = [];
  for (const raw of diagnostics) {
    const diagnostic = locateDiagnostic(raw, sourceText);
    const heading = `${diagnostic.severity}[${diagnostic.code}]`;
    lines.push(`${color ? `\x1b[${diagnostic.severity === "error" ? 31 : 33}m${heading}\x1b[0m` : heading}: ${diagnosticMessage(diagnostic.message)}`);
    const span = diagnostic.span;
    if (span) {
      const source = sourceText(span.sourceId ?? "");
      const line = span.startLine, column = span.startColumn;
      lines.push(`  --> ${displayPath(span.sourceId ?? "<source>")}${line === undefined ? "" : `:${line}:${column ?? 1}`}`);
      if (source !== undefined && line !== undefined && column !== undefined) {
        const text = source.split(/\r?\n/)[line - 1] ?? "";
        const gutter = String(line).length;
        const length = span.endLine === line ? (span.endColumn ?? column + 1) - column : text.length - column + 2;
        const prefix = text.slice(0, column - 1).replace(/[^\t]/g, " ");
        lines.push(`${" ".repeat(gutter + 2)}|`, ` ${line} | ${text}`, `${" ".repeat(gutter + 2)}| ${prefix}${"^".repeat(Math.max(1, Math.min(length, text.length - column + 2)))}`);
      }
    }
    if (diagnostic.help) lines.push(`  = help: ${diagnosticMessage(diagnostic.help)}`);
    for (const fix of diagnostic.fix ?? []) {
      const source = sourceText(fix.span.sourceId ?? span?.sourceId ?? "");
      const previous = source?.slice(fix.span.startOffset, fix.span.endOffset);
      lines.push(`  = fix: replace ${previous === undefined ? "source" : `\`${previous}\``} with \`${fix.newText}\``);
    }
  }
  lines.push(`${diagnostics.filter(d => d.severity === "error").length} errors, ${diagnostics.filter(d => d.severity === "warning").length} warnings`);
  return lines.join("\n") + "\n";
}
export function report(response: JsonResponse, json: boolean, summary = true) {
  if (json) printJson(located(response));
  else if (summary || response.diagnostics.length) process.stderr.write(renderDiagnostics(response.diagnostics));
  if (!response.ok) process.exitCode = 1;
}

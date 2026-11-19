/** Diagnostic text without file-system access, shared by the CLI and hosted REPLs. */
import type { Diagnostic } from "../types.js";
import { authorNames, diagnosticLocator } from "@formalang/ts/diagnostic";

export function diagnosticMessage(message: string): string {
  return authorNames(message);
}

export function formatDiagnostics(diagnostics: readonly Pick<Diagnostic, "code" | "severity" | "message" | "span" | "help" | "fix" | "related">[], sourceText: (sourceId: string) => string | undefined, color = false, displayPath = (sourceId: string) => sourceId): string {
  const lines: string[] = [];
  for (const raw of diagnostics) {
    const diagnostic = diagnosticLocator(sourceText)(raw as Parameters<ReturnType<typeof diagnosticLocator>>[0]);
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
    for (const note of diagnostic.related ?? []) {
      lines.push(`  note: ${diagnosticMessage(note.message)} --> ${displayPath(note.span.sourceId)}${note.span.startLine === undefined ? "" : `:${note.span.startLine}:${note.span.startColumn ?? 1}`}`);
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

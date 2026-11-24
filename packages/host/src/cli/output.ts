import { readFileSync } from "node:fs";
import { isAbsolute, relative } from "node:path";
import type { Diagnostic } from "../types.js";
import type { JsonResponse } from "../json-abi.js";
import { formatDiagnostics } from "./diagnostic-text.js";

export function fileText(sourceId: string): string | undefined {
  try { return isAbsolute(sourceId) ? readFileSync(sourceId, "utf8") : undefined; } catch { return undefined; }
}
export const displayPath = (path: string) => isAbsolute(path) ? relative(process.cwd(), path) || "." : path;
export function printJson(response: JsonResponse) {
  process.stdout.write(JSON.stringify(response) + "\n");
}
/** File responses carry diagnostics once, at the top level (the engine locates them). */
export function located(response: JsonResponse): JsonResponse {
  if (!response.value || typeof response.value !== "object" || Array.isArray(response.value)) return response;
  const { diagnostics: _diagnostics, ...value } = response.value as Record<string, unknown>;
  if (value.result && typeof value.result === "object" && !Array.isArray(value.result)) {
    const { diagnostics: _resultDiagnostics, ...result } = value.result as Record<string, unknown>;
    value.result = result;
  }
  return { ...response, value };
}

export { diagnosticMessage } from "./diagnostic-text.js";

export function renderDiagnostics(diagnostics: Parameters<typeof formatDiagnostics>[0], sourceText = fileText, color = Boolean(process.stderr.isTTY) && process.env.NO_COLOR === undefined): string {
  return formatDiagnostics(diagnostics, sourceText, color, displayPath);
}
export function report(response: JsonResponse, json: boolean, summary = true) {
  if (json) printJson(located(response));
  else if (summary || response.diagnostics.length) process.stderr.write(renderDiagnostics(response.diagnostics));
  if (!response.ok) process.exitCode = 1;
}

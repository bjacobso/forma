/**
 * Author-facing diagnostics at the JSON boundary: every located diagnostic gets
 * a line and column, offsets in messages become line and column, and resolved
 * module names (`name__forma_<module>_d<name>`) read as their author names.
 */
import type * as Engine from "@formalang/ts/engine";

const RESOLVED_NAME = /__forma_[0-9a-f]+_d[0-9a-f]+/g;

/** Strip module-resolution suffixes, leaving the names the author wrote. */
export function authorNames(text: string): string {
  return text.replace(RESOLVED_NAME, "");
}

/** 1-based line and column of an offset. */
export function lineColumn(source: string, offset: number): { line: number; column: number } {
  let line = 1, start = 0;
  const end = Math.max(0, Math.min(offset, source.length));
  for (let i = 0; i < end; i++) if (source.charCodeAt(i) === 10) { line++; start = i + 1; }
  return { line, column: end - start + 1 };
}

type SourceText = (sourceId: string) => string | undefined;

type Locatable = { readonly message: string; readonly span?: Engine.Span | undefined };

export function locateDiagnostic<D extends Locatable>(diagnostic: D, sourceText: SourceText, fallbackSourceId?: string): D {
  const span = diagnostic.span;
  const source = sourceText(span?.sourceId ?? fallbackSourceId ?? "");
  let message = authorNames(diagnostic.message);
  if (source !== undefined)
    message = message.replace(/\(at offset (\d+)\)/g, (_, offset: string) => {
      const at = lineColumn(source, Number(offset));
      return `(at line ${at.line}, column ${at.column})`;
    });
  let located = span;
  if (span && source !== undefined) {
    const start = lineColumn(source, span.startOffset), end = lineColumn(source, span.endOffset);
    located = {
      ...span,
      startLine: span.startLine ?? start.line,
      startColumn: span.startColumn ?? start.column,
      endLine: span.endLine ?? end.line,
      endColumn: span.endColumn ?? end.column,
    };
  }
  return { ...diagnostic, message, ...(located ? { span: located } : {}) };
}

/** Locate the diagnostics a JSON response carries at its top level and in its value. */
export function locateResponse<R extends { readonly diagnostics: readonly Locatable[]; readonly value?: unknown }>(
  response: R,
  sourceText: SourceText,
  fallbackSourceId?: string,
): R {
  const locate = (list: unknown): unknown =>
    Array.isArray(list)
      ? list.map((d) => (d && typeof d === "object" && typeof (d as { message?: unknown }).message === "string"
        ? locateDiagnostic(d as Locatable, sourceText, fallbackSourceId) : d))
      : list;
  const value = response.value;
  let located: unknown = value;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as { diagnostics?: unknown; result?: { diagnostics?: unknown } };
    located = {
      ...record,
      ...("diagnostics" in record ? { diagnostics: locate(record.diagnostics) } : {}),
      ...(record.result && typeof record.result === "object" && "diagnostics" in record.result
        ? { result: { ...record.result, diagnostics: locate(record.result.diagnostics) } } : {}),
    };
  }
  return { ...response, diagnostics: locate(response.diagnostics) as R["diagnostics"], ...("value" in response ? { value: located } : {}) };
}

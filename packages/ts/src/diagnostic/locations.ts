import { authorNames, type Diagnostic, type Span } from "./diagnostic.js";

/** A span projected against its author source. Lines and columns are 1-based. */
export interface LocatedSpan extends Span {
  readonly startLine: number;
  readonly startColumn: number;
  readonly endLine: number;
  readonly endColumn: number;
}

/** Diagnostics whose located spans have been projected against author source. */
export interface LocatedDiagnostic extends Omit<Diagnostic, "span" | "fix" | "related"> {
  readonly span?: LocatedSpan | undefined;
  readonly related?: readonly { readonly span: LocatedSpan; readonly message: string }[] | undefined;
  readonly fix?: readonly { readonly span: LocatedSpan; readonly newText: string }[] | undefined;
}

/** Build once per source so projecting many diagnostics does not rescan the text. */
export function spanLocator(source: string): (span: Span) => LocatedSpan {
  const starts = [0];
  for (let i = 0; i < source.length; i++) if (source.charCodeAt(i) === 10) starts.push(i + 1);
  const position = (offset: number) => {
    const end = Math.max(0, Math.min(offset, source.length));
    let low = 0, high = starts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (starts[mid]! <= end) low = mid;
      else high = mid - 1;
    }
    return { line: low + 1, column: end - starts[low]! + 1 };
  };
  return span => {
    const start = position(span.startOffset), end = position(span.endOffset);
    return { ...span, startLine: start.line, startColumn: start.column, endLine: end.line, endColumn: end.column };
  };
}

/** Locate diagnostic spans and replacement edits using their own source IDs. */
export function diagnosticLocator(sourceText: (sourceId: string) => string): (diagnostic: Diagnostic) => LocatedDiagnostic;
export function diagnosticLocator(sourceText: (sourceId: string) => string | undefined): (diagnostic: Diagnostic) => Diagnostic;
export function diagnosticLocator(sourceText: (sourceId: string) => string | undefined): (diagnostic: Diagnostic) => Diagnostic {
  const locators = new Map<string, ReturnType<typeof spanLocator>>();
  const locate = (span: Span): Span => {
    let locator = locators.get(span.sourceId);
    if (!locator) {
      const source = sourceText(span.sourceId);
      if (source === undefined) return span;
      locator = spanLocator(source);
      locators.set(span.sourceId, locator);
    }
    return locator(span);
  };
  return diagnostic => ({
    ...diagnostic,
    message: authorNames(diagnostic.message),
    ...(diagnostic.span ? { span: locate(diagnostic.span) } : {}),
    ...(diagnostic.related ? {related:diagnostic.related.map(note => ({...note,message:authorNames(note.message),span:locate({...note.span,sourceId:note.span.sourceId || diagnostic.span?.sourceId || ""})}))} : {}),
    ...(diagnostic.fix ? { fix: diagnostic.fix.map(edit => ({ ...edit, span: locate({ ...edit.span, sourceId: edit.span.sourceId || diagnostic.span?.sourceId || "" }) })) } : {}),
  });
}

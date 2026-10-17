/** Shared browser-safe formatting entry point for hosts and editors. */
import { formatLisp, formatMarkdown, formatRange, type FormatOptions } from "@formalang/ts/format";
export { formatLisp, formatMarkdown, formatRange, formattingEdits } from "@formalang/ts/format";
export type { FormatOptions, FormatResult, FormatDiagnostic, FormatEdit } from "@formalang/ts/format";
export interface FormatRequest {
  readonly source: string;
  readonly language?: "lisp" | "forma" | "markdown";
  readonly range?: { readonly start: number; readonly end: number };
  readonly options?: FormatOptions;
}
export function formatSource(request: FormatRequest) {
  const options = { ...request.options, language: request.language ?? "lisp" };
  return request.range ? formatRange(request.source, request.range, options) : request.language === "markdown" ? formatMarkdown(request.source, options) : formatLisp(request.source, options);
}

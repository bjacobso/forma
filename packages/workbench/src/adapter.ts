// The one adapter from Forma's analysis to the text-intelligence
// vocabulary. Facts are in source coordinates and keyed by node id; the
// source pane uses them as they are, and outline rows use them through each
// row's layout. Both surfaces get the same tokens and diagnostics.

import type { Diagnostic, SemanticToken } from "@foldworks/text-intelligence";
import { identifySyntax, type SyntaxNode } from "@formalang/ts/syntax";

import { analyzedText, type Analysis, type SourceDiagnostic } from "./analysis.js";
import { rangeInRow, rowContaining, type RowLayout } from "./rows.js";
import { tokensOf } from "./tokens.js";

/** What a row shows of an analysis. */
export interface RowView {
  readonly layout: RowLayout;
  readonly tokens: ReadonlyArray<SemanticToken>;
  readonly diagnostics: ReadonlyArray<Diagnostic>;
  /** The most serious diagnostic's severity, for the row's tone. */
  readonly tone?: "error" | "warning" | undefined;
}

export interface AnalysisView {
  readonly rows: ReadonlyMap<string, RowView>;
  /** Diagnostics no row contains, such as a failure without a location. */
  readonly unplaced: ReadonlyArray<SourceDiagnostic>;
}

const toDiagnostic = (
  diagnostic: SourceDiagnostic,
  range: { readonly from: number; readonly to: number },
): Diagnostic => ({
  ...range,
  severity: diagnostic.severity,
  message: diagnostic.message,
  ...(diagnostic.code === undefined ? {} : { code: diagnostic.code }),
});

/** The kind of a symbol node the analysis resolved. */
const symbolKind = (analysis: Analysis, nodeId: string | undefined): string | undefined =>
  nodeId === undefined ? undefined : analysis.symbols[nodeId]?.kind;

/** Tokens for a row's text: its syntax, with the analysis's kinds for its symbols. */
const rowTokens = (analysis: Analysis, layout: RowLayout): ReadonlyArray<SemanticToken> => {
  const byRange = new Map(layout.nodes.map((node) => [`${node.from}:${node.to}`, node.nodeId]));
  return tokensOf(layout.text, identifySyntax(layout.text), (node: SyntaxNode) =>
    symbolKind(analysis, byRange.get(`${node.span.start}:${node.span.end}`)),
  );
};

const views = new WeakMap<Analysis, AnalysisView>();

/** Every row's tokens and diagnostics. Cached per analysis. */
export const viewOf = (analysis: Analysis): AnalysisView => {
  const cached = views.get(analysis);
  if (cached !== undefined) return cached;
  const layouts = new Map(analysis.rows.map((layout) => [layout.id, layout as RowLayout]));
  const diagnostics = new Map<string, Diagnostic[]>();
  const unplaced: SourceDiagnostic[] = [];
  for (const diagnostic of analysis.diagnostics) {
    const row = rowContaining(layouts, diagnostic.start, diagnostic.end);
    if (row === undefined) {
      unplaced.push(diagnostic);
      continue;
    }
    const list = diagnostics.get(row.id) ?? [];
    list.push(toDiagnostic(diagnostic, rangeInRow(row, diagnostic.start, diagnostic.end)));
    diagnostics.set(row.id, list);
  }
  // A row that does not read is one error over its whole text.
  for (const broken of analysis.brokenRows) {
    const layout = layouts.get(broken.id);
    if (layout === undefined) continue;
    diagnostics.set(broken.id, [
      { from: 0, to: layout.text.length, severity: "error", message: broken.message, code: "parse/syntax" },
      ...(diagnostics.get(broken.id) ?? []),
    ]);
  }
  const rows = new Map<string, RowView>();
  for (const layout of layouts.values()) {
    const own = diagnostics.get(layout.id) ?? [];
    const tone = own.some((diagnostic) => diagnostic.severity === "error")
      ? "error"
      : own.some((diagnostic) => diagnostic.severity === "warning")
        ? "warning"
        : undefined;
    rows.set(layout.id, { layout, tokens: rowTokens(analysis, layout), diagnostics: own, tone });
  }
  const view = { rows, unplaced };
  views.set(analysis, view);
  return view;
};

/**
 * Tokens for the whole document, for the source pane. While rows do not
 * read, the analysis describes other text, so the document gets its syntax
 * with the kinds of the symbols whose ids it shares.
 */
export const sourceTokens = (analysis: Analysis): ReadonlyArray<SemanticToken> =>
  tokensOf(analysis.document.source, analysis.document.identity, (node) =>
    symbolKind(analysis, node.id),
  );

/**
 * Diagnostics for the whole document, for the source pane: the analysis's
 * own, or, while rows do not read, where reading stopped.
 */
export const sourceDiagnostics = (analysis: Analysis): ReadonlyArray<Diagnostic> =>
  analysis.analyzed === null
    ? analysis.diagnostics.map((diagnostic) =>
        toDiagnostic(diagnostic, { from: diagnostic.start, to: diagnostic.end }),
      )
    : analysis.document.identity.errors.map((error) => ({
        from: error.span.start,
        to: Math.max(error.span.end, error.span.start + 1),
        severity: "error",
        message: error.message,
        code: "parse/syntax",
      }));

/** Counts for the title bar. */
export const summary = (
  analysis: Analysis,
): { readonly forms: number; readonly errors: number; readonly warnings: number } => ({
  forms: analyzedText(analysis).identity.nodes.filter(
    (node) => node.parent === null && node.kind !== "Comment",
  ).length,
  errors:
    analysis.brokenRows.length +
    analysis.diagnostics.filter((diagnostic) => diagnostic.severity === "error").length,
  warnings: analysis.diagnostics.filter((diagnostic) => diagnostic.severity === "warning").length,
});

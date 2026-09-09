/**
 * useLispAnalysis
 *
 * Editor-agnostic hook for Lisp analysis.
 * Runs HM type inference and optionally merges domain-specific diagnostics
 * and completions via provider interfaces.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  type EditorAnalysisResult,
  type Span,
  type SyntaxTreeProjection,
} from "@formalang/host/types";
import { getDefaultEditorAnalysisHost, type EditorAnalysisHost } from "../analysis-host.js";
import { diagnosticRangeFromLoc } from "../codemirror/types.js";
import type { CompletionProvider, DiagnosticsProvider } from "../codemirror/types.js";
import type {
  LispEditorCursorContext,
  LispEditorDebugState,
  LispEditorDebugTreeNode,
} from "./debug-types.js";

export interface LispSemanticVisibilityOptions {
  showTypeHints?: boolean;
  showArgumentHints?: boolean;
  showBreadcrumbs?: boolean;
  showCodeLenses?: boolean;
}

export interface LispAnalysisProviders {
  diagnostics?: DiagnosticsProvider | undefined;
  completion?: CompletionProvider | undefined;
}

const DEBOUNCE_MS = 150;

function debugTreeFromProjection(
  node: SyntaxTreeProjection | null,
): LispEditorDebugTreeNode | null {
  if (!node) return null;
  return {
    kind: node.kind,
    span: { start: node.span.startOffset, end: node.span.endOffset },
    ...(node.text ? { text: node.text } : {}),
    ...(node.tokenType ? { tokenType: node.tokenType } : {}),
    ...(node.children
      ? { children: node.children.map(debugTreeFromProjection).filter(isTree) }
      : {}),
  };
}

function isTree(value: LispEditorDebugTreeNode | null): value is LispEditorDebugTreeNode {
  return value !== null;
}

function containsOffset(node: SyntaxTreeProjection, offset: number): boolean {
  return node.span.startOffset <= offset && offset < node.span.endOffset;
}

function computeBreadcrumbs(tree: SyntaxTreeProjection, offset: number): string[] {
  const breadcrumbs: string[] = [];
  let node: SyntaxTreeProjection | undefined = tree;

  while (node) {
    if (node.kind === "List") {
      const firstChild = node.children?.[0];
      if (firstChild?.text) breadcrumbs.push(firstChild.text);
    }

    const containing: readonly SyntaxTreeProjection[] = (node.children ?? []).filter((child) =>
      containsOffset(child, offset),
    );
    if (containing.length === 0) break;
    node = containing.reduce((smallest: SyntaxTreeProjection, current: SyntaxTreeProjection) => {
      const smallestSize = smallest.span.endOffset - smallest.span.startOffset;
      const currentSize = current.span.endOffset - current.span.startOffset;
      return currentSize < smallestSize ? current : smallest;
    });
  }

  return breadcrumbs.filter(Boolean);
}

function diagnosticRangeFromSpan(source: string, span: Span) {
  const from = span.startOffset;
  const to = span.endOffset;
  const startLines = source.slice(0, from).split("\n");
  const endLines = source.slice(0, to).split("\n");
  return {
    from,
    to,
    range: {
      startLineNumber: startLines.length,
      startColumn: (startLines[startLines.length - 1]?.length ?? 0) + 1,
      endLineNumber: endLines.length,
      endColumn: (endLines[endLines.length - 1]?.length ?? 0) + 1,
    },
  };
}

function analysisDiagnostics(
  source: string,
  analysis: EditorAnalysisResult,
): LispEditorDebugState["diagnostics"] {
  const diagnostics: LispEditorDebugState["diagnostics"] = [];

  for (const err of analysis.errors) {
    if (!err.span) continue;
    diagnostics.push({
      source: "hm",
      severity: "error",
      message: err.message,
      range: diagnosticRangeFromSpan(source, err.span).range,
    });
  }

  for (const diagnostic of analysis.diagnostics) {
    if (!diagnostic.span) continue;
    diagnostics.push({
      source: diagnostic.code.split("/")[0] ?? "hm",
      severity: diagnostic.severity,
      message: diagnostic.message,
      range: diagnosticRangeFromSpan(source, diagnostic.span).range,
    });
  }

  return diagnostics;
}

export interface UseLispAnalysisResult {
  analysis: EditorAnalysisResult | null;
  debugState: LispEditorDebugState;
  updateCursorContext: (offset: number, line: number, col: number, word: string | null) => void;
  scheduleAnalysis: (source: string) => void;
  runAnalysis: (source: string) => void;
}

export function useLispAnalysis(
  options: LispSemanticVisibilityOptions = {},
  providers?: LispAnalysisProviders,
  editorHost: EditorAnalysisHost = getDefaultEditorAnalysisHost(),
): UseLispAnalysisResult {
  const analysisRef = useRef<EditorAnalysisResult | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [debugState, setDebugState] = useState<LispEditorDebugState>({
    source: "",
    analysis: null,
    parse: { errors: [], greenTree: null, redTree: null },
    diagnostics: [],
    cursorContext: null,
    lastCompletion: null,
  });

  const runAnalysis = useCallback(
    (source: string) => {
      editorHost
        .analyzeEditor({ sourceId: "editor", source })
        .then((analysis) => {
          analysisRef.current = analysis;

          const diagnostics = analysisDiagnostics(source, analysis);

          // Domain-specific diagnostics via provider
          if (providers?.diagnostics) {
            try {
              const dslDiags = providers.diagnostics.getDiagnostics(source);

              for (const d of dslDiags) {
                const { from } = diagnosticRangeFromLoc(source, d.loc);
                const isDuplicate = diagnostics.some((existing) => {
                  const existingFrom = source.slice(0, existing.range.startColumn - 1).length;
                  return existingFrom === from && existing.message === d.message;
                });

                if (!isDuplicate) {
                  const range = diagnosticRangeFromLoc(source, d.loc);
                  const startLines = source.slice(0, range.from).split("\n");
                  const endLines = source.slice(0, range.to).split("\n");
                  diagnostics.push({
                    source: "dsl",
                    severity: "error",
                    message: d.message,
                    range: {
                      startLineNumber: startLines.length,
                      startColumn: (startLines[startLines.length - 1]?.length ?? 0) + 1,
                      endLineNumber: endLines.length,
                      endColumn: (endLines[endLines.length - 1]?.length ?? 0) + 1,
                    },
                  });
                }
              }
            } catch {
              // Swallow
            }
          }

          setDebugState((prev) => ({
            ...prev,
            source,
            analysis,
            parse: {
              errors: analysis.parse.errors.map((error) => ({
                message: error.message,
                ...(error.span ? { loc: error.span } : {}),
              })),
              greenTree: debugTreeFromProjection(analysis.parse.greenTree),
              redTree: debugTreeFromProjection(analysis.parse.redTree),
            },
            diagnostics,
          }));
        })
        .catch(() => {
          // Swallow analysis errors
        });
    },
    [editorHost, providers?.diagnostics],
  );

  const scheduleAnalysis = useCallback(
    (source: string) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => runAnalysis(source), DEBOUNCE_MS);
    },
    [runAnalysis],
  );

  const updateCursorContext = useCallback(
    (offset: number, line: number, col: number, word: string | null) => {
      const analysis = analysisRef.current;
      const hmHover = analysis
        ? editorHost.findTypeAtOffset(analysis.typedSpans, offset)
        : undefined;
      const source = debugState.source;

      let breadcrumbs: string[] | undefined;
      if (options.showBreadcrumbs && source) {
        try {
          breadcrumbs = analysis?.parse.redTree
            ? computeBreadcrumbs(analysis.parse.redTree, offset)
            : [];
        } catch {
          breadcrumbs = [];
        }
      }

      const cursorContext: LispEditorCursorContext = {
        lineNumber: line,
        column: col,
        offset,
        word,
        breadcrumbs,
        ...(hmHover
          ? {
              hmTypeAtCursor: {
                display: hmHover.display,
                span: {
                  startOffset: hmHover.span.startOffset,
                  endOffset: hmHover.span.endOffset,
                },
              },
            }
          : {}),
      };

      // Compute completions for debug via provider
      let lastCompletion: LispEditorDebugState["lastCompletion"] = null;
      if (providers?.completion) {
        try {
          const completions = providers.completion.getCompletions(source, offset)?.options ?? [];
          lastCompletion = {
            offset,
            lineNumber: line,
            column: col,
            suggestions: completions.map((c) => ({
              label: c.label,
              kind: c.type,
              insertText: c.apply,
              ...(c.detail ? { detail: c.detail } : {}),
              ...(c.info ? { documentation: c.info } : {}),
            })),
          };
        } catch {
          // Swallow
        }
      }

      setDebugState((prev) => ({
        ...prev,
        cursorContext,
        lastCompletion,
      }));
    },
    [debugState.source, editorHost, options.showBreadcrumbs, providers?.completion],
  );

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return {
    analysis: analysisRef.current,
    debugState,
    updateCursorContext,
    scheduleAnalysis,
    runAnalysis,
  };
}

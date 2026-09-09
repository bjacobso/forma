/**
 * CodeMirror 6 linter extension.
 *
 * Runs HM type inference and optionally merges domain-specific diagnostics
 * from a DiagnosticsProvider.
 */

import { linter, type Diagnostic } from "@codemirror/lint";
import type { EditorAnalysisResult } from "@formalang/host/types";
import { getDefaultEditorAnalysisHost, type EditorAnalysisHost } from "../analysis-host.js";
import { diagnosticRangeFromLoc, type DiagnosticsProvider } from "./types.js";

export type AnalysisSetter = (result: EditorAnalysisResult | null) => void;

export interface DiagnosticsExtensionOptions {
  onAnalysis?: AnalysisSetter | undefined;
  diagnosticsProvider?: DiagnosticsProvider | undefined;
  editorHost?: EditorAnalysisHost | undefined;
}

export function createDiagnosticsExtension(options: DiagnosticsExtensionOptions) {
  return linter(
    async (view): Promise<Diagnostic[]> => {
      const source = view.state.doc.toString();
      if (!source.trim()) {
        options.onAnalysis?.(null);
        return [];
      }

      const diagnostics: Diagnostic[] = [];
      const editorHost = options.editorHost ?? getDefaultEditorAnalysisHost();

      try {
        const analysis = await editorHost.analyzeEditor({ sourceId: "codemirror", source });
        options.onAnalysis?.(analysis);

        // HM type errors
        for (const err of analysis.errors) {
          if (err.span) {
            diagnostics.push({
              from: err.span.startOffset,
              to: err.span.endOffset,
              severity: "error",
              message: err.message,
              source: "hm",
            });
          }
        }

        for (const diagnostic of analysis.diagnostics) {
          if (!diagnostic.span) continue;
          diagnostics.push({
            from: diagnostic.span.startOffset,
            to: diagnostic.span.endOffset,
            severity: diagnostic.severity === "error" ? "error" : "warning",
            message: diagnostic.message,
            source: diagnostic.code.split("/")[0] ?? "hm",
          });
        }
      } catch {
        options.onAnalysis?.(null);
      }

      // Domain-specific diagnostics
      if (options.diagnosticsProvider) {
        try {
          const dslDiags = options.diagnosticsProvider.getDiagnostics(source);

          for (const d of dslDiags) {
            const { from, to } = diagnosticRangeFromLoc(source, d.loc);

            const isDuplicate = diagnostics.some(
              (existing) => existing.from === from && existing.message === d.message,
            );

            if (!isDuplicate) {
              diagnostics.push({
                from,
                to,
                severity: "error",
                message: d.message,
                source: "dsl",
              });
            }
          }
        } catch {
          // Swallow
        }
      }

      return diagnostics;
    },
    { delay: 150 },
  );
}

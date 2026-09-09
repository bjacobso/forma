/**
 * LispEditor
 *
 * Generic CodeMirror 6 editor for Lisp code.
 *
 * Features:
 * - Auto-grows with content (no fixed height)
 * - Inline diagnostics (red squiggly underlines)
 * - Hover for documentation and type info
 * - Structural editing (slurp/barf/wrap)
 *
 * When `intelligence` is provided, also enables:
 * - Typeahead / completion suggestions
 * - Semantic token highlighting
 * - Domain-specific hover and diagnostics
 */

import { useState, useEffect, useRef, useImperativeHandle, forwardRef, useCallback } from "react";
import { EditorView, placeholder as cmPlaceholder, lineNumbers } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { bracketMatching } from "@codemirror/language";
import { closeBrackets } from "@codemirror/autocomplete";
import { history, defaultKeymap, historyKeymap } from "@codemirror/commands";
import { keymap } from "@codemirror/view";
import { lispSupport } from "../codemirror/syntax.js";
import {
  appDarkTheme,
  appDarkSyntaxHighlighting,
  appLightTheme,
  appLightSyntaxHighlighting,
} from "../codemirror/theme.js";
import { structuralKeymap } from "../codemirror/structural.js";
import { createCompletionExtension } from "../codemirror/completion.js";
import { createHoverExtension } from "../codemirror/hover.js";
import { createDiagnosticsExtension } from "../codemirror/diagnostics.js";
import { createSemanticHighlightPlugin } from "../codemirror/highlight.js";
import type { LispEditorIntelligence } from "../codemirror/types.js";
import type { EditorAnalysisResult } from "@formalang/host/types";
import type { EditorAnalysisHost } from "../analysis-host.js";
import { useLispAnalysis } from "./use-lisp-analysis.js";
import type { LispSemanticVisibilityOptions } from "./use-lisp-analysis.js";
import { LispEditorDebugPanel } from "./debug-panel.js";
import { TypeStatusBar } from "./type-status-bar.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LispEditorProps {
  /** Current source code (controlled) */
  value?: string;
  /** Called on change */
  onChange?: (source: string) => void;
  /** Read-only mode */
  readOnly?: boolean;
  /** Minimum height in px (default: 60) */
  minHeight?: number;
  /** Maximum height in px — beyond this, scroll (default: Infinity) */
  maxHeight?: number;
  /** Show line numbers (default: false — compact for embedding) */
  lineNumbers?: boolean;
  /** Theme (default: "app-dark") */
  theme?: "app-dark" | "vs-dark" | "light";
  /** Additional className for outer container */
  className?: string;
  /** Placeholder text when editor is empty */
  placeholder?: string;
  /** Show type status bar below the editor (default: true) */
  showStatusBar?: boolean;
  /** Show LSP debug panel under the editor */
  debug?: boolean;
  /** Semantic visibility options */
  semanticVisibility?: LispSemanticVisibilityOptions;
  /** Emit debug state changes */
  onDebugState?: (state: import("./debug-types.js").LispEditorDebugState) => void;
  /** Domain-specific intelligence (completion, hover, diagnostics, highlighting) */
  intelligence?: LispEditorIntelligence;
  /** Host used for generic editor analysis. Defaults to the TypeScript host. */
  editorHost?: EditorAnalysisHost;
  /** Accessible label for the editable CodeMirror surface */
  ariaLabel?: string;
}

export interface LispEditorRef {
  /** Reveal a specific line (centers the line in view) */
  revealLine: (line: number) => void;
  /** Get the underlying CodeMirror EditorView instance */
  getEditor: () => EditorView | null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const LispEditor = forwardRef<LispEditorRef, LispEditorProps>(function LispEditor(
  {
    value,
    onChange,
    readOnly = false,
    minHeight = 60,
    maxHeight = Infinity,
    lineNumbers: showLineNumbers = false,
    theme = "app-dark",
    className,
    placeholder,
    showStatusBar = true,
    debug = false,
    semanticVisibility,
    onDebugState,
    intelligence,
    editorHost,
    ariaLabel,
  },
  ref,
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const [height, setHeight] = useState(minHeight);

  const resolvedSemanticVisibility: LispSemanticVisibilityOptions = semanticVisibility ?? {
    showTypeHints: false,
    showArgumentHints: false,
    showBreadcrumbs: false,
    showCodeLenses: false,
  };

  // Analysis hook (editor-agnostic), with optional domain providers
  const { debugState, updateCursorContext, scheduleAnalysis, runAnalysis } = useLispAnalysis(
    resolvedSemanticVisibility,
    intelligence
      ? { diagnostics: intelligence.diagnostics, completion: intelligence.completion }
      : undefined,
    editorHost,
  );

  // Stable ref for analysis result used by hover
  const analysisRef = useRef<EditorAnalysisResult | null>(null);
  useEffect(() => {
    analysisRef.current = debugState.analysis;
  }, [debugState.analysis]);

  useEffect(() => {
    onDebugState?.(debugState);
  }, [debugState, onDebugState]);

  // Expose imperative methods
  useImperativeHandle(ref, () => ({
    revealLine: (line: number) => {
      const view = viewRef.current;
      if (view) {
        const lineInfo = view.state.doc.line(Math.min(line, view.state.doc.lines));
        view.dispatch({
          effects: EditorView.scrollIntoView(lineInfo.from, { y: "center" }),
          selection: { anchor: lineInfo.from },
        });
        view.focus();
      }
    },
    getEditor: () => viewRef.current,
  }));

  // Create and mount the editor
  const createEditor = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    // Clean up existing editor
    if (viewRef.current) {
      viewRef.current.destroy();
      viewRef.current = null;
    }

    const getAnalysis = () => analysisRef.current;
    const setAnalysis = (result: EditorAnalysisResult | null) => {
      analysisRef.current = result;
    };

    const extensions = [
      // Language support (grammar + folding + indentation)
      lispSupport(),
      // Theme
      ...(theme === "app-dark" || theme === "vs-dark"
        ? [appDarkTheme, appDarkSyntaxHighlighting]
        : [appLightTheme, appLightSyntaxHighlighting]),
      // Core editing
      history(),
      bracketMatching(),
      closeBrackets(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      // Line numbers
      ...(showLineNumbers ? [lineNumbers()] : []),
      // Placeholder
      ...(placeholder ? [cmPlaceholder(placeholder)] : []),
      // Read-only
      ...(readOnly ? [EditorState.readOnly.of(true)] : []),
      // Hover tooltips (always enabled for HM types, optionally with domain hover)
      createHoverExtension({
        analysisProvider: getAnalysis,
        hoverProvider: intelligence?.hover,
        findTypeAtOffset: editorHost?.findTypeAtOffset,
      }),
      // Diagnostics / linter (always enabled for HM errors, optionally with domain diagnostics)
      createDiagnosticsExtension({
        onAnalysis: setAnalysis,
        diagnosticsProvider: intelligence?.diagnostics,
        editorHost,
      }),
      ...(ariaLabel ? [EditorView.contentAttributes.of({ "aria-label": ariaLabel })] : []),
      // Domain-specific extensions (only when intelligence is provided)
      ...(intelligence?.completion ? [createCompletionExtension(intelligence.completion)] : []),
      ...(intelligence?.semanticHighlight
        ? [createSemanticHighlightPlugin(intelligence.semanticHighlight)]
        : []),
      // Structural editing keymap
      structuralKeymap,
      // Listen for doc changes
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          const source = update.state.doc.toString();
          onChangeRef.current?.(source);
          scheduleAnalysis(source);
        }
        // Update cursor context on selection change
        if (update.selectionSet || update.docChanged) {
          const sel = update.state.selection.main;
          const line = update.state.doc.lineAt(sel.head);
          const col = sel.head - line.from + 1;

          // Find word at cursor
          const text = update.state.doc.toString();
          let word: string | null = null;
          const wordMatch = /[\w\-!?*+/<>=$.&:]+/.exec(
            text.slice(Math.max(0, sel.head - 50), sel.head + 50),
          );
          if (wordMatch) {
            const matchStart = Math.max(0, sel.head - 50) + wordMatch.index;
            const matchEnd = matchStart + wordMatch[0].length;
            if (sel.head >= matchStart && sel.head <= matchEnd) {
              word = wordMatch[0];
            }
          }

          updateCursorContext(sel.head, line.number, col, word);
        }
        // Auto-grow
        const contentHeight = update.view.contentDOM.offsetHeight + 24; // + padding
        const clamped = Math.max(minHeight, Math.min(maxHeight, contentHeight));
        setHeight(clamped);
      }),
      // Word wrap
      EditorView.lineWrapping,
    ];

    const state = EditorState.create({
      doc: value ?? "",
      extensions,
    });

    const view = new EditorView({
      state,
      parent: container,
    });

    viewRef.current = view;

    // Run initial analysis
    runAnalysis(value ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mount editor on first render
  useEffect(() => {
    createEditor();
    return () => {
      viewRef.current?.destroy();
      viewRef.current = null;
    };
  }, [createEditor]);

  // Sync external value changes
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    const currentValue = view.state.doc.toString();
    if (value !== undefined && value !== currentValue) {
      view.dispatch({
        changes: { from: 0, to: currentValue.length, insert: value },
      });
    }
  }, [value]);

  return (
    <div className={className}>
      <div
        ref={containerRef}
        style={{
          height: `${height}px`,
          position: "relative",
          overflow: "hidden",
        }}
      />
      {showStatusBar && <TypeStatusBar cursorContext={debugState.cursorContext} />}
      {debug ? <LispEditorDebugPanel debugState={debugState} /> : null}
    </div>
  );
});

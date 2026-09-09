import type { EditorAnalysisResult } from "@formalang/host/types";

export interface LispEditorCursorContext {
  lineNumber: number;
  column: number;
  offset: number;
  word: string | null;
  hmTypeAtCursor?: {
    display: string;
    span: { startOffset: number; endOffset: number };
  };
  breadcrumbs?: string[] | undefined;
}

export interface LispEditorDebugTreeNode {
  kind: string;
  span: { start: number; end: number };
  text?: string;
  tokenType?: string;
  children?: LispEditorDebugTreeNode[];
}

export interface LispEditorDebugState {
  source: string;
  analysis: EditorAnalysisResult | null;
  parse: {
    errors: Array<{
      message: string;
      loc?: unknown;
    }>;
    greenTree: LispEditorDebugTreeNode | null;
    redTree: LispEditorDebugTreeNode | null;
  };
  diagnostics: Array<{
    source: string;
    severity: "error" | "warning" | "info" | "hint";
    message: string;
    range: {
      startLineNumber: number;
      startColumn: number;
      endLineNumber: number;
      endColumn: number;
    };
  }>;
  cursorContext: LispEditorCursorContext | null;
  lastCompletion: {
    offset: number;
    lineNumber: number;
    column: number;
    suggestions: Array<{
      label: string;
      kind: string;
      detail?: string;
      documentation?: string;
      insertText?: string;
      isSnippet?: boolean;
    }>;
  } | null;
}

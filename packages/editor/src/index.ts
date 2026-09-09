/**
 * @formalang/editor
 *
 * Generic Lisp language editor built on CodeMirror 6.
 * Provides syntax highlighting, structural editing, HM type inference,
 * and pluggable intelligence via provider interfaces.
 *
 * Domain-specific editors can extend this
 * by implementing LispEditorIntelligence.
 */

export * from "./codemirror/index.js";
export * from "./react/index.js";
export { createDefaultEditorAnalysisHost, getDefaultEditorAnalysisHost } from "./analysis-host.js";
export type { EditorAnalysisHost } from "./analysis-host.js";

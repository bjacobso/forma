/**
 * CodeMirror 6 extensions for the Lisp language editor.
 */

export { lispLanguage, lispSupport } from "./syntax.js";
export {
  appLightTheme,
  appLightHighlightStyle,
  appLightSyntaxHighlighting,
  appDarkTheme,
  appDarkHighlightStyle,
  appDarkSyntaxHighlighting,
} from "./theme.js";
export { structuralKeymap } from "./structural.js";
export { createCompletionExtension } from "./completion.js";
export {
  createHoverExtension,
  type AnalysisProvider,
  type HoverExtensionOptions,
} from "./hover.js";
export {
  createDiagnosticsExtension,
  type AnalysisSetter,
  type DiagnosticsExtensionOptions,
} from "./diagnostics.js";
export { createSemanticHighlightPlugin } from "./highlight.js";
export {
  diagnosticRangeFromLoc,
  type CompletionProvider,
  type EditorCompletion,
  type HoverProvider,
  type EditorHover,
  type DiagnosticsProvider,
  type EditorDiagnostic,
  type SemanticRangeProvider,
  type SemanticRange,
  type LispEditorIntelligence,
} from "./types.js";
export { editorAppearance, type SyntaxPalette } from "./appearance.js";

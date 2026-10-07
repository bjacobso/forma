/**
 * Language services over a workspace of preludes and documents: diagnostics,
 * types, hover, completion, definitions, references, rename, document
 * symbols, semantic tokens, and formatting, each a memoized query.
 *
 * @module Analysis
 */

export {
  AnalysisWorkspace,
  type DocumentAnalysis,
  type DocumentSymbol,
  type Hover,
  type RenameResult,
  type TextEdit,
  type TypedSpan,
  type WorkspaceOptions,
} from "./analysis/workspace.js";
export { type CompletionItem, type CompletionKind } from "./analysis/completion.js";
export {
  TOKEN_MODIFIERS,
  TOKEN_TYPES,
  type SemanticToken,
  type SemanticTokens,
  type TokenModifier,
  type TokenType,
} from "./analysis/semantic-tokens.js";
export {
  buildPreludeScopes,
  type PreludeLayer,
  type PreludeScopes,
  type Scope,
  type SourceText,
} from "./analysis/scope.js";
export type { Diagnostic, Span } from "./diagnostic/diagnostic.js";

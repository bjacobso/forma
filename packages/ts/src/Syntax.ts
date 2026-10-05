/**
 * Stable node identity and the outline codec for editors.
 *
 * @module Syntax
 */

export {
  diffChange,
  identifySyntax,
  indexSyntax,
  matchesSyntaxKind,
  reconcileSyntax,
  type IdentifyOptions,
  type PreviousSyntax,
  type ReconcileOptions,
  type SyntaxAnchor,
  type SyntaxIdentity,
  type SyntaxIndex,
  type SyntaxNode,
  type SyntaxNodeKind,
  type SyntaxParseError,
  type SyntaxSpan,
  type TextChange,
} from "./syntax/identity.js";
export {
  outlineToSource,
  sourceToOutline,
  type OutlineItem,
  type OutlineRowError,
  type OutlineRowSpan,
  type OutlineToSourceOptions,
  type OutlineToSourceResult,
  type SourceToOutlineOptions,
  type SourceToOutlineResult,
} from "./syntax/outline.js";

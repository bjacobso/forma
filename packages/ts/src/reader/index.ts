/**
 * @formalang/ts/reader
 *
 * S-expression parser for the Lisp query DSL
 *
 * Features:
 * - Green/Red tree architecture for LSP-ready parsing
 * - Trivia preservation (whitespace and comments)
 * - Error recovery for partial parsing
 * - Support for lists (), vectors [], and maps {}
 * - Full location tracking for error reporting
 */

// Primary parser API
export { parse, parseToSExpr, parseManyToSExpr, type ParseResult } from "./parser.js";

// SExpr types and constructors
// Values with same-named types automatically export both
export type { SExpr, Loc, Span, Trivia, TriviaKind } from "./types.js";
export { List, Vector, SMap, SSet, Sym, Str, Num, Bool, ErrorNode, ParseError } from "./types.js";

// Green tree
export type { GreenElement, SyntaxKind, GreenNode, GreenToken } from "./green-tree.js";
export {
  GreenNode as createGreenNode,
  GreenToken as createGreenToken,
  isGreenNode,
  isGreenToken,
} from "./green-tree.js";

// Red tree
export type { RedNode, RedToken, RedElement } from "./red-tree.js";
export {
  createRedTree,
  isRedNode,
  isRedToken,
  nodeAtOffset,
  elementAtOffset,
  elementsInRange,
} from "./red-tree.js";

// Conversion
export { toSExpr, toSExprMany } from "./to-sexpr.js";

// Lexer
export { tokenize, tokenizeWithTrivia, type Token, type TokenWithTrivia } from "./lexer.js";

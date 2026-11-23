/**
 * S-expression parser with green/red tree support
 *
 * This module provides the public API for parsing S-expressions.
 * It builds a lossless green/red tree with error recovery, then
 * converts to SExpr for downstream consumption.
 */

import { Effect } from "effect";
import type { GreenNode } from "./green-tree.js";
import { buildGreenTree } from "./green-tree-builder.js";
import type { RedNode } from "./red-tree.js";
import { createRedTree } from "./red-tree.js";
import { toSExpr, toSExprMany } from "./to-sexpr.js";
import type { SExpr } from "./types.js";
import { ParseError } from "./types.js";

// =============================================================================
// Parse Result Types
// =============================================================================

/**
 * Full parse result with tree access and errors
 */
export interface ParseResult {
  readonly greenTree: GreenNode;
  readonly redTree: RedNode;
  readonly errors: readonly ParseError[];
  readonly source: string;
}

// =============================================================================
// Primary API
// =============================================================================

/**
 * Parse source to green/red tree with error recovery
 *
 * This is the primary parsing function. It returns a full parse result
 * including the lossless tree representation and any errors encountered.
 */
export function parse(source: string): ParseResult {
  const { tree, errors } = buildGreenTree(source);
  const redTree = createRedTree(tree, source);
  return { greenTree: tree, redTree, errors, source };
}

/**
 * Parse and convert to SExpr (single expression)
 *
 * Returns an Effect that fails with ParseError on parse errors.
 */
export function parseToSExpr(source: string): Effect.Effect<SExpr, ParseError> {
  return Effect.gen(function* () {
    const { redTree, errors } = parse(source);

    if (errors.length > 0) {
      return yield* Effect.fail(errors[0]!);
    }

    return toSExpr(redTree);
  });
}

/**
 * Parse multiple expressions and convert to SExpr array
 *
 * Returns an Effect that fails with ParseError on parse errors.
 */
export function parseManyToSExpr(source: string, sourceId?: string): Effect.Effect<readonly SExpr[], ParseError> {
  return Effect.gen(function* () {
    const { redTree, errors } = parse(source);

    if (errors.length > 0) {
      return yield* Effect.fail(errors[0]!);
    }

    return toSExprMany(redTree, sourceId);
  });
}

// =============================================================================
// Re-exports
// =============================================================================

export { ParseError } from "./types.js";
export type {
  SExpr,
  List,
  Vector,
  SMap,
  Sym,
  Str,
  Num,
  Bool,
  ErrorNode,
  Loc,
  Span,
  Trivia,
  TriviaKind,
} from "./types.js";

// Green tree exports
export type { GreenNode, GreenToken, GreenElement, SyntaxKind } from "./green-tree.js";
export { isGreenNode, isGreenToken } from "./green-tree.js";

// Red tree exports
export type { RedNode, RedToken, RedElement } from "./red-tree.js";
export {
  createRedTree,
  isRedNode,
  isRedToken,
  nodeAtOffset,
  elementAtOffset,
  elementsInRange,
} from "./red-tree.js";

// Conversion exports
export { toSExpr, toSExprMany } from "./to-sexpr.js";

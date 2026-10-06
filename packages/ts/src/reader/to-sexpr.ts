/**
 * Convert Red Tree to SExpr
 *
 * This module provides conversion from the red tree representation to the
 * SExpr AST used by downstream consumers like lisp-schema validation.
 */

import { type RedNode, type RedToken, isRedNode, isRedToken } from "./red-tree.js";
import type { SExpr, Loc } from "./types.js";
import * as T from "./types.js";

// =============================================================================
// Loc Helpers
// =============================================================================

/**
 * Get location from a node spanning from its first to last token.
 */
function getNodeLoc(node: RedNode): Loc {
  const first = getFirstToken(node);
  if (!first) {
    return { start: 0, end: 0, line: 1, col: 1 };
  }
  const last = getLastToken(node);
  return {
    start: first.loc().start,
    end: last ? last.loc().end : first.loc().end,
    line: first.loc().line,
    col: first.loc().col,
  };
}

// =============================================================================
// Token Value Extraction
// =============================================================================

/**
 * Parse string value, handling escape sequences
 */
function parseStringValue(text: string): string {
  // Remove quotes
  let content: string;
  if (text.startsWith('"""') && text.endsWith('"""')) {
    content = text.slice(3, -3);
  } else {
    content = text.slice(1, -1);
  }

  // Process escapes for regular strings
  if (!text.startsWith('"""')) {
    let result = "";
    let i = 0;
    while (i < content.length) {
      if (content[i] === "\\") {
        i++;
        if (i >= content.length) break;
        switch (content[i]) {
          case "n":
            result += "\n";
            break;
          case "t":
            result += "\t";
            break;
          case "r":
            result += "\r";
            break;
          case "\\":
            result += "\\";
            break;
          case '"':
            result += '"';
            break;
          default:
            result += content[i];
        }
        i++;
      } else {
        result += content[i];
        i++;
      }
    }
    return result;
  }

  return content;
}

// =============================================================================
// Conversion Functions
// =============================================================================

/**
 * Convert a red node to SExpr
 */
export function toSExpr(node: RedNode): SExpr {
  switch (node.kind()) {
    case "Root":
      // Root contains multiple forms, return the first non-EOF one
      for (const child of node.children()) {
        if (isRedNode(child) && child.kind() !== "Error") {
          return toSExpr(child);
        }
      }
      // Empty input - return error node
      return T.ErrorNode("Empty input", { start: 0, end: 0, line: 1, col: 1 });

    case "List":
      return toList(node);

    case "Vector":
      return toVector(node);

    case "Map":
      return toMap(node);

    case "Set":
      return toSet(node);

    case "Symbol":
      return toSymbol(node);

    case "String":
      return toString(node);

    case "Number":
      return toNumber(node);

    case "Boolean":
      return toBoolean(node);

    case "ReaderMacro":
      return toReaderMacro(node);

    case "Error":
      return toErrorNode(node);

    default:
      return T.ErrorNode(`Unknown node kind: ${node.kind()}`, getNodeLoc(node));
  }
}

/**
 * Convert all top-level forms from a Root node
 */
export function toSExprMany(root: RedNode): readonly SExpr[] {
  const result: SExpr[] = [];

  for (const child of root.children()) {
    if (isRedNode(child)) {
      // Skip error nodes and EOF
      if (child.kind() !== "Error") {
        result.push(toSExpr(child));
      }
    }
    // Skip bare tokens (EOF)
  }

  return result;
}

/**
 * Convert a List node
 */
function toList(node: RedNode): T.List {
  const items: SExpr[] = [];

  for (const child of node.children()) {
    // Skip delimiter tokens (lparen, rparen)
    if (isRedToken(child)) {
      const tt = child.tokenType();
      if (tt === "lparen" || tt === "rparen") continue;
    }

    if (isRedNode(child)) {
      items.push(toSExpr(child));
    }
  }

  return T.List(items, getNodeLoc(node));
}

/**
 * Convert a Vector node
 */
function toVector(node: RedNode): T.Vector {
  const items: SExpr[] = [];

  for (const child of node.children()) {
    // Skip delimiter tokens (lbracket, rbracket)
    if (isRedToken(child)) {
      const tt = child.tokenType();
      if (tt === "lbracket" || tt === "rbracket") continue;
    }

    if (isRedNode(child)) {
      items.push(toSExpr(child));
    }
  }

  return T.Vector(items, getNodeLoc(node));
}

/**
 * Convert a Map node
 */
function toMap(node: RedNode): T.SMap {
  const pairs: [SExpr, SExpr][] = [];
  const elements: SExpr[] = [];

  for (const child of node.children()) {
    // Skip delimiter tokens (lbrace, rbrace)
    if (isRedToken(child)) {
      const tt = child.tokenType();
      if (tt === "lbrace" || tt === "rbrace") continue;
    }

    if (isRedNode(child)) {
      elements.push(toSExpr(child));
    }
  }

  // Pair up elements
  for (let i = 0; i < elements.length; i += 2) {
    const key = elements[i]!;
    const value = elements[i + 1] ?? key; // Handle odd number gracefully
    pairs.push([key, value]);
  }

  return T.SMap(pairs, getNodeLoc(node));
}

/**
 * Convert a Set node
 */
function toSet(node: RedNode): T.SSet {
  const items: SExpr[] = [];

  for (const child of node.children()) {
    // Skip delimiter tokens (lbrace, rbrace)
    if (isRedToken(child)) {
      const tt = child.tokenType();
      if (tt === "lbrace" || tt === "rbrace") continue;
    }

    if (isRedNode(child)) {
      items.push(toSExpr(child));
    }
  }

  return T.SSet(items, getNodeLoc(node));
}

/**
 * Convert a Symbol node
 */
function toSymbol(node: RedNode): T.Sym {
  const token = getFirstToken(node);
  if (!token) {
    return T.Sym("", getNodeLoc(node));
  }
  return T.Sym(token.text(), token.loc());
}

/**
 * Convert a String node
 */
function toString(node: RedNode): T.Str {
  const token = getFirstToken(node);
  if (!token) {
    return T.Str("", getNodeLoc(node));
  }
  const value = parseStringValue(token.text());
  return T.Str(value, token.loc());
}

/**
 * Convert a Number node
 */
function toNumber(node: RedNode): T.Num {
  const token = getFirstToken(node);
  if (!token) {
    return T.Num(0, getNodeLoc(node));
  }
  const value = Number(token.text());
  return T.Num(value, token.loc());
}

/**
 * Convert a Boolean node
 */
function toBoolean(node: RedNode): T.Bool {
  const token = getFirstToken(node);
  if (!token) {
    return T.Bool(false, getNodeLoc(node));
  }
  const value = token.text() === "true";
  return T.Bool(value, token.loc());
}

/**
 * Convert a ReaderMacro node to a List: 'expr → (quote expr), `expr → (quasiquote expr),
 * ~expr → (unquote expr), ~@expr → (unquote-splicing expr)
 */
function toReaderMacro(node: RedNode): T.List {
  const loc = getNodeLoc(node);

  // Find the macro token to determine which reader macro
  let symbolName = "quote"; // default
  for (const child of node.children()) {
    if (isRedToken(child)) {
      const tt = child.tokenType();
      if (tt === "quote") symbolName = "quote";
      else if (tt === "backtick") symbolName = "quasiquote";
      else if (tt === "tilde") symbolName = "unquote";
      else if (tt === "tilde-at") symbolName = "unquote-splicing";
    }
  }

  // Find the inner form (the first RedNode child)
  let innerExpr: SExpr = T.ErrorNode("Missing reader macro form", loc);
  for (const child of node.children()) {
    if (isRedNode(child)) {
      innerExpr = toSExpr(child);
      break;
    }
  }

  return T.List([T.Sym(symbolName, loc), innerExpr], loc);
}

/**
 * Convert an Error node
 */
function toErrorNode(node: RedNode): T.ErrorNode {
  return T.ErrorNode("Parse error", getNodeLoc(node));
}

/**
 * Get the first token in a node, including nested reader macros
 */
function getFirstToken(node: RedNode): RedToken | undefined {
  for (const child of node.children()) {
    if (isRedToken(child)) return child;
    const token = getFirstToken(child);
    if (token) return token;
  }
  return undefined;
}

/**
 * Get the last token in a node, including nested reader macros
 */
function getLastToken(node: RedNode): RedToken | undefined {
  const children = node.children();
  for (let i = children.length - 1; i >= 0; i--) {
    const child = children[i]!;
    if (isRedToken(child)) return child;
    const token = getLastToken(child);
    if (token) return token;
  }
  return undefined;
}

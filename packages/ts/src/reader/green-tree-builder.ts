/**
 * Green Tree Builder - Parse source into a green tree with error recovery
 *
 * The builder tokenizes with trivia preservation and constructs an immutable
 * green tree. It implements error recovery to produce partial trees even
 * when the input is malformed.
 */

import { tokenizeWithTrivia, type TokenWithTrivia } from "./lexer.js";
import {
  GreenNode,
  GreenToken,
  isGreenNode,
  isGreenToken,
  type GreenElement,
  type SyntaxKind,
} from "./green-tree.js";
import { ParseError } from "./types.js";

// =============================================================================
// Builder State
// =============================================================================

/**
 * Builder state during green tree construction
 */
interface BuilderState {
  readonly tokens: readonly TokenWithTrivia[];
  readonly source: string;
  pos: number;
}

/**
 * Result of parsing a form
 */
interface FormResult {
  readonly node: GreenElement;
  readonly errors: ParseError[];
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Result of building a green tree
 */
export interface BuildResult {
  readonly tree: GreenNode;
  readonly errors: readonly ParseError[];
}

/**
 * Build a green tree from source with error recovery
 */
export function buildGreenTree(source: string): BuildResult {
  const tokens = tokenizeWithTrivia(source);
  const state: BuilderState = { tokens, source, pos: 0 };

  const children: GreenElement[] = [];
  const errors: ParseError[] = [];

  while (state.pos < state.tokens.length) {
    const twt = state.tokens[state.pos]!;

    if (twt.token.type === "eof") {
      // Include EOF token with trivia
      children.push(makeGreenToken(twt, state.source));
      break;
    }

    const result = parseForm(state);
    children.push(result.node);
    errors.push(...result.errors);
  }

  return {
    tree: GreenNode("Root", children),
    errors,
  };
}

// =============================================================================
// Token Helpers
// =============================================================================

/**
 * Get current token with trivia at position
 */
function current(state: BuilderState): TokenWithTrivia {
  return state.tokens[state.pos] ?? state.tokens[state.tokens.length - 1]!;
}

/**
 * Advance to next token
 */
function advance(state: BuilderState): void {
  if (state.pos < state.tokens.length) {
    state.pos++;
  }
}

/**
 * Create a GreenToken from a TokenWithTrivia
 */
function makeGreenToken(twt: TokenWithTrivia, source: string): GreenToken {
  const text = source.slice(twt.token.loc.start, twt.token.loc.end);
  return GreenToken(twt.token.type, text, twt.leadingTrivia, twt.token.loc);
}

/**
 * Consume current token and return as GreenToken
 */
function consumeToken(state: BuilderState): GreenToken {
  const twt = current(state);
  const gt = makeGreenToken(twt, state.source);
  advance(state);
  return gt;
}

// =============================================================================
// Parsing Functions
// =============================================================================

/**
 * Parse any form: list, vector, map, or atom
 */
function parseForm(state: BuilderState): FormResult {
  const twt = current(state);
  const { token } = twt;

  switch (token.type) {
    case "lparen":
      return parseList(state);
    case "lbracket":
      return parseVector(state);
    case "lbrace":
      return parseMap(state);
    case "keyword":
    case "symbol":
      return parseAtom(state, "Symbol");
    case "string":
      return parseAtom(state, "String");
    case "number":
      return parseAtom(state, "Number");
    case "bool":
      return parseAtom(state, "Boolean");
    case "quote":
      return parseReaderMacro(state, "quote");
    case "backtick":
      return parseReaderMacro(state, "quasiquote");
    case "tilde":
      return parseReaderMacro(state, "unquote");
    case "tilde-at":
      return parseReaderMacro(state, "unquote-splicing");
    case "error":
      return { node: GreenNode("Error", [consumeToken(state)]), errors: [token.error] };
    default:
      // Error: unexpected token
      return {
        node: GreenNode("Error", [consumeToken(state)]),
        errors: [new ParseError({ message: `Unexpected token: ${token.type}`, loc: token.loc })],
      };
  }
}

/**
 * Parse an atom (symbol, string, number, boolean)
 */
function parseAtom(state: BuilderState, kind: SyntaxKind): FormResult {
  return {
    node: GreenNode(kind, [consumeToken(state)]),
    errors: [],
  };
}

/**
 * Parse a reader macro: 'expr, `expr, ~expr, ~@expr
 *
 * Creates a ReaderMacro node containing the macro token and the following form.
 * The toSExpr converter handles desugaring to (quote expr), (quasiquote expr),
 * (unquote expr), etc.
 *
 * We use a dedicated ReaderMacro node (not a synthetic List) to preserve correct
 * source widths for position tracking.
 */
function parseReaderMacro(state: BuilderState, _symbolName: string): FormResult {
  const macroToken = current(state);
  const loc = macroToken.token.loc;

  // Consume the reader macro token
  const macroGreenToken = consumeToken(state);

  // Check for missing form after reader macro
  const next = current(state);
  if (next.token.type === "eof") {
    return {
      node: GreenNode("Error", [macroGreenToken]),
      errors: [new ParseError({ message: `Expected form after ${macroGreenToken.text}`, loc })],
    };
  }

  // Parse the following form
  const formResult = parseForm(state);

  // Build ReaderMacro node: [macroToken, form]
  return {
    node: GreenNode("ReaderMacro", [macroGreenToken, formResult.node]),
    errors: formResult.errors,
  };
}

/**
 * Parse a list: (...)
 */
function parseList(state: BuilderState): FormResult {
  const children: GreenElement[] = [];
  const errors: ParseError[] = [];

  // Opening paren
  const lparen = current(state);
  children.push(consumeToken(state));

  // Items
  while (state.pos < state.tokens.length) {
    const twt = current(state);

    if (twt.token.type === "rparen") {
      children.push(consumeToken(state));
      return { node: GreenNode("List", children), errors };
    }

    if (twt.token.type === "eof") {
      errors.push(new ParseError({ message: "Unclosed list", loc: lparen.token.loc }));
      return { node: GreenNode("List", children), errors };
    }

    // Handle unexpected closing delimiters (recovery)
    if (twt.token.type === "rbracket" || twt.token.type === "rbrace") {
      errors.push(
        new ParseError({ message: `Unexpected ${twt.token.type} in list`, loc: twt.token.loc }),
      );
      children.push(GreenNode("Error", [consumeToken(state)]));
      continue;
    }

    const result = parseForm(state);
    children.push(result.node);
    errors.push(...result.errors);
  }

  return { node: GreenNode("List", children), errors };
}

/**
 * Parse a vector: [...]
 */
function parseVector(state: BuilderState): FormResult {
  const children: GreenElement[] = [];
  const errors: ParseError[] = [];

  // Opening bracket
  const lbracket = current(state);
  children.push(consumeToken(state));

  // Items
  while (state.pos < state.tokens.length) {
    const twt = current(state);

    if (twt.token.type === "rbracket") {
      children.push(consumeToken(state));
      return { node: GreenNode("Vector", children), errors };
    }

    if (twt.token.type === "eof") {
      errors.push(new ParseError({ message: "Unclosed vector", loc: lbracket.token.loc }));
      return { node: GreenNode("Vector", children), errors };
    }

    // Handle unexpected closing delimiters (recovery)
    if (twt.token.type === "rparen" || twt.token.type === "rbrace") {
      errors.push(
        new ParseError({ message: `Unexpected ${twt.token.type} in vector`, loc: twt.token.loc }),
      );
      children.push(GreenNode("Error", [consumeToken(state)]));
      continue;
    }

    const result = parseForm(state);
    children.push(result.node);
    errors.push(...result.errors);
  }

  return { node: GreenNode("Vector", children), errors };
}

/**
 * Parse a map: {...}
 */
function parseMap(state: BuilderState): FormResult {
  const children: GreenElement[] = [];
  const errors: ParseError[] = [];

  // Opening brace
  const lbrace = current(state);
  children.push(consumeToken(state));

  // Key-value pairs
  const keys = new Set<string>();
  let elementCount = 0;
  while (state.pos < state.tokens.length) {
    const twt = current(state);

    if (twt.token.type === "rbrace") {
      // Check for odd number of elements in maps
      if (elementCount % 2 !== 0) {
        errors.push(
          new ParseError({
            message: "Map requires an even number of elements",
            loc: lbrace.token.loc,
          }),
        );
      }
      children.push(consumeToken(state));
      return { node: GreenNode("Map", children), errors };
    }

    if (twt.token.type === "eof") {
      errors.push(new ParseError({ message: "Unclosed map", loc: lbrace.token.loc }));
      if (elementCount % 2 !== 0) {
        errors.push(
          new ParseError({
            message: "Map requires an even number of elements",
            loc: lbrace.token.loc,
          }),
        );
      }
      return { node: GreenNode("Map", children), errors };
    }

    // Handle unexpected closing delimiters (recovery)
    if (twt.token.type === "rparen" || twt.token.type === "rbracket") {
      errors.push(
        new ParseError({ message: `Unexpected ${twt.token.type} in map`, loc: twt.token.loc }),
      );
      children.push(GreenNode("Error", [consumeToken(state)]));
      continue;
    }

    if (elementCount % 2 === 0) {
      const token = twt.token;
      const key = token.type === "string" ? `string:${token.value}` : token.type === "keyword" ? `keyword:${token.name}` : undefined;
      if (key !== undefined) {
        if (keys.has(key)) errors.push(new ParseError({message: "Duplicate map key", loc: token.loc}));
        keys.add(key);
      }
    }
    const result = parseForm(state);
    children.push(result.node);
    errors.push(...result.errors);
    elementCount++;
  }

  return { node: GreenNode("Map", children), errors };
}

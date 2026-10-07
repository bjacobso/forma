/**
 * Semantic tokens: every literal, comment, and symbol of a document,
 * classified by what it means. Symbols are classified by the symbol index,
 * so a name a macro or descriptor form defines highlights like any other
 * definition, and the heads of described forms highlight as keywords.
 */

import type { FormDescriptor } from "../descriptor/FormDescriptor.js";
import {
  kernelNameKind,
  type DefinitionKind,
  type SymbolIndex,
} from "../editor/symbols.js";
import type { SyntaxIndex, SyntaxNode } from "../syntax/identity.js";

/** Token types, in the order of their LSP legend indices. */
export const TOKEN_TYPES = [
  "namespace",
  "class",
  "type",
  "parameter",
  "variable",
  "property",
  "enumMember",
  "function",
  "macro",
  "keyword",
  "comment",
  "string",
  "number",
  "operator",
] as const;

/** Token modifiers, in the order of their LSP legend bits. */
export const TOKEN_MODIFIERS = ["declaration", "definition", "defaultLibrary"] as const;

export type TokenType = (typeof TOKEN_TYPES)[number];
export type TokenModifier = (typeof TOKEN_MODIFIERS)[number];

export interface SemanticToken {
  readonly start: number;
  readonly end: number;
  readonly type: TokenType;
  readonly modifiers: readonly TokenModifier[];
}

export interface SemanticTokens {
  /** Tokens in document order. A token never spans lines. */
  readonly tokens: readonly SemanticToken[];
  /** The tokens in the LSP's relative five-integer encoding. */
  readonly data: readonly number[];
}

export interface SemanticTokensRequest {
  readonly sourceId: string;
  readonly text: string;
  readonly syntax: SyntaxIndex;
  readonly symbols: SymbolIndex;
  readonly descriptors: readonly FormDescriptor[];
}

export function semanticTokens(request: SemanticTokensRequest): SemanticTokens {
  const { sourceId, text, syntax, symbols } = request;
  const definitions = new Map(
    symbols.definitions
      .filter((definition) => definition.sourceId === sourceId)
      .map((definition) => [definition.nodeId, definition] as const),
  );
  const byKey = new Map(symbols.definitions.map((definition) => [definition.key, definition]));
  const references = new Map(
    symbols.references
      .filter((reference) => reference.sourceId === sourceId)
      .map((reference) => [reference.nodeId, reference] as const),
  );
  const forms = new Set(request.descriptors.map((descriptor) => descriptor.name));

  const tokens: SemanticToken[] = [];
  const push = (node: SyntaxNode, type: TokenType, modifiers: readonly TokenModifier[] = []): void => {
    tokens.push(...splitLines(text, node.span.start, node.span.end, type, modifiers));
  };

  for (const node of syntax.identity.nodes) {
    switch (node.kind) {
      case "Comment":
        push(node, "comment");
        break;
      case "String":
        push(node, "string");
        break;
      case "Number":
        push(node, "number");
        break;
      case "Boolean":
        push(node, "keyword");
        break;
      case "Symbol": {
        const name = text.slice(node.span.start, node.span.end);
        const definition = definitions.get(node.id);
        if (definition) {
          push(node, definitionToken(definition.kind), ["declaration", "definition"]);
          break;
        }
        const reference = references.get(node.id);
        const target = reference?.definition ? byKey.get(reference.definition) : undefined;
        if (reference?.resolution === "form" || forms.has(name)) {
          push(node, "keyword");
        } else if (target) {
          push(node, definitionToken(target.kind));
        } else if (name.startsWith(":")) {
          push(node, "property");
        } else if (reference?.resolution === "builtin" || kernelNameKind(name)) {
          const kind = kernelNameKind(name);
          push(
            node,
            kind === "builtin" ? "function" : kind === "macro" ? "macro" : "keyword",
            ["defaultLibrary"],
          );
        } else if (name === "nil") {
          push(node, "keyword");
        } else if (/^[A-Z]/.test(name)) {
          push(node, "type");
        } else if (/^[-=<>!*+/|&]+$/.test(name)) {
          push(node, "operator");
        }
        break;
      }
      default:
        break;
    }
  }
  tokens.sort((left, right) => left.start - right.start);
  return { tokens, data: encode(text, tokens) };
}

function definitionToken(kind: DefinitionKind): TokenType {
  switch (kind) {
    case "function":
    case "method":
      return "function";
    case "macro":
      return "macro";
    case "type":
      return "type";
    case "declaration":
      return "class";
    case "constructor":
      return "enumMember";
    case "parameter":
      return "parameter";
    default:
      return "variable";
  }
}

function splitLines(
  text: string,
  start: number,
  end: number,
  type: TokenType,
  modifiers: readonly TokenModifier[],
): SemanticToken[] {
  const tokens: SemanticToken[] = [];
  let lineStart = start;
  for (let offset = start; offset < end; offset++) {
    if (text[offset] === "\n") {
      if (offset > lineStart) tokens.push({ start: lineStart, end: offset, type, modifiers });
      lineStart = offset + 1;
    }
  }
  if (end > lineStart) tokens.push({ start: lineStart, end, type, modifiers });
  return tokens;
}

function encode(text: string, tokens: readonly SemanticToken[]): number[] {
  const data: number[] = [];
  let line = 0;
  let lineStart = 0;
  let scanned = 0;
  let previousLine = 0;
  let previousCharacter = 0;
  for (const token of tokens) {
    for (; scanned < token.start; scanned++) {
      if (text[scanned] === "\n") {
        line++;
        lineStart = scanned + 1;
      }
    }
    const character = token.start - lineStart;
    const deltaLine = line - previousLine;
    data.push(
      deltaLine,
      deltaLine === 0 ? character - previousCharacter : character,
      token.end - token.start,
      TOKEN_TYPES.indexOf(token.type),
      token.modifiers.reduce((bits, modifier) => bits | (1 << TOKEN_MODIFIERS.indexOf(modifier)), 0),
    );
    previousLine = line;
    previousCharacter = character;
  }
  return data;
}

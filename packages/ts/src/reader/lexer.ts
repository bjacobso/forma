import type { Loc, Trivia } from "./types.js";
import { ParseError } from "./types.js";

/**
 * Token bundled with its leading trivia (whitespace/comments)
 */
export interface TokenWithTrivia {
  readonly token: Token;
  readonly leadingTrivia: readonly Trivia[];
}

/**
 * Token types for the lexer
 */
export type Token =
  | { type: "lparen"; loc: Loc }
  | { type: "rparen"; loc: Loc }
  | { type: "lbracket"; loc: Loc }
  | { type: "rbracket"; loc: Loc }
  | { type: "lbrace"; loc: Loc }
  | { type: "rbrace"; loc: Loc }
  | { type: "string"; value: string; loc: Loc }
  | { type: "number"; value: number; loc: Loc }
  | { type: "bool"; value: boolean; loc: Loc }
  | { type: "symbol"; name: string; loc: Loc }
  | { type: "keyword"; name: string; loc: Loc }
  | { type: "quote"; loc: Loc }
  | { type: "backtick"; loc: Loc }
  | { type: "tilde"; loc: Loc }
  | { type: "tilde-at"; loc: Loc }
  /** Text the lexer could not read. Only `tokenizeWithTrivia` produces it. */
  | { type: "error"; error: ParseError; loc: Loc }
  | { type: "eof"; loc: Loc };

/**
 * Lexer state
 */
interface LexerState {
  input: string;
  pos: number;
  line: number;
  col: number;
}

/**
 * Create initial lexer state
 */
const createState = (input: string): LexerState => ({
  input,
  pos: 0,
  line: 1,
  col: 1,
});

/**
 * Create location from start to current position
 */
const makeLoc = (
  state: LexerState,
  startPos: number,
  startLine: number,
  startCol: number,
): Loc => ({
  start: startPos,
  end: state.pos,
  line: startLine,
  col: startCol,
});

/**
 * Check if at end of input
 */
const isEOF = (state: LexerState): boolean => state.pos >= state.input.length;

/**
 * Peek current character without advancing
 */
const peek = (state: LexerState, offset = 0): string => {
  const pos = state.pos + offset;
  return pos < state.input.length ? state.input[pos]! : "";
};

/**
 * Advance position by one character
 */
const advance = (state: LexerState): void => {
  if (state.pos < state.input.length) {
    if (state.input[state.pos] === "\n") {
      state.line++;
      state.col = 1;
    } else {
      state.col++;
    }
    state.pos++;
  }
};

/**
 * Skip whitespace and comments
 */
const skipWhitespaceAndComments = (state: LexerState): void => {
  while (!isEOF(state)) {
    const ch = peek(state);

    // Skip whitespace
    if (/\s/.test(ch)) {
      advance(state);
      continue;
    }

    // Skip line comments (; ...)
    if (ch === ";") {
      // Skip all content until end of line
      while (!isEOF(state) && peek(state) !== "\n") {
        advance(state);
      }
      continue;
    }

    break;
  }
};

/**
 * Read a multiline string literal (triple-quoted)
 */
const readMultilineString = (state: LexerState): Token => {
  const startPos = state.pos;
  const startLine = state.line;
  const startCol = state.col;

  // Skip opening """
  advance(state); // skip first "
  advance(state); // skip second "
  advance(state); // skip third "

  let value = "";
  while (!isEOF(state)) {
    // Check for closing """
    if (peek(state) === '"' && peek(state, 1) === '"' && peek(state, 2) === '"') {
      advance(state); // skip first "
      advance(state); // skip second "
      advance(state); // skip third "
      return {
        type: "string",
        value,
        loc: makeLoc(state, startPos, startLine, startCol),
      };
    }

    // Accumulate character
    value += peek(state);
    advance(state);
  }

  throw new ParseError({
    message: "Unterminated multiline string",
    loc: makeLoc(state, startPos, startLine, startCol),
  });
};

/**
 * Read a string literal
 */
const readString = (state: LexerState): Token => {
  const startPos = state.pos;
  const startLine = state.line;
  const startCol = state.col;

  advance(state); // skip opening "

  let value = "";
  while (!isEOF(state) && peek(state) !== '"') {
    const ch = peek(state);

    if (ch === "\\") {
      advance(state);
      if (isEOF(state)) {
        throw new ParseError({
          message: "Unterminated string escape",
          loc: makeLoc(state, startPos, startLine, startCol),
        });
      }

      const escaped = peek(state);
      switch (escaped) {
        case "n":
          value += "\n";
          break;
        case "t":
          value += "\t";
          break;
        case "r":
          value += "\r";
          break;
        case "\\":
          value += "\\";
          break;
        case '"':
          value += '"';
          break;
        default:
          value += escaped;
      }
      advance(state);
    } else {
      value += ch;
      advance(state);
    }
  }

  if (isEOF(state)) {
    throw new ParseError({
      message: "Unterminated string",
      loc: makeLoc(state, startPos, startLine, startCol),
    });
  }

  advance(state); // skip closing "

  return {
    type: "string",
    value,
    loc: makeLoc(state, startPos, startLine, startCol),
  };
};

/**
 * Read a number literal
 */
const readNumber = (state: LexerState): Token => {
  const startPos = state.pos;
  const startLine = state.line;
  const startCol = state.col;

  let numStr = "";

  // Handle negative sign
  if (peek(state) === "-") {
    numStr += "-";
    advance(state);
  }

  // Read digits before decimal point
  while (!isEOF(state) && /[0-9]/.test(peek(state))) {
    numStr += peek(state);
    advance(state);
  }

  // Read decimal point and fractional part
  if (peek(state) === ".") {
    numStr += ".";
    advance(state);

    while (!isEOF(state) && /[0-9]/.test(peek(state))) {
      numStr += peek(state);
      advance(state);
    }
  }

  // Read exponent
  if (peek(state) === "e" || peek(state) === "E") {
    numStr += peek(state);
    advance(state);

    if (peek(state) === "+" || peek(state) === "-") {
      numStr += peek(state);
      advance(state);
    }

    while (!isEOF(state) && /[0-9]/.test(peek(state))) {
      numStr += peek(state);
      advance(state);
    }
  }

  const value = Number(numStr);
  if (isNaN(value)) {
    throw new ParseError({
      message: `Invalid number: ${numStr}`,
      loc: makeLoc(state, startPos, startLine, startCol),
    });
  }

  return {
    type: "number",
    value,
    loc: makeLoc(state, startPos, startLine, startCol),
  };
};

/**
 * Read a symbol or boolean
 */
const readSymbol = (state: LexerState): Token => {
  const startPos = state.pos;
  const startLine = state.line;
  const startCol = state.col;

  let name = "";

  // Symbol characters: alphanumeric, -, _, :, ?, !, *, +, /, <, >, =, $, ., &
  while (!isEOF(state)) {
    const ch = peek(state);
    if (/[a-zA-Z0-9\-_:?!*+/<>=$.&]/.test(ch)) {
      name += ch;
      advance(state);
    } else {
      break;
    }
  }

  const loc = makeLoc(state, startPos, startLine, startCol);

  // Check for boolean literals
  if (name === "true") {
    return { type: "bool", value: true, loc };
  }
  if (name === "false") {
    return { type: "bool", value: false, loc };
  }

  return { type: name.startsWith(":") ? "keyword" : "symbol", name, loc };
};

/**
 * Read next token
 */
const nextToken = (state: LexerState): Token => {
  skipWhitespaceAndComments(state);

  if (isEOF(state)) {
    return {
      type: "eof",
      loc: makeLoc(state, state.pos, state.line, state.col),
    };
  }

  const startPos = state.pos;
  const startLine = state.line;
  const startCol = state.col;
  const ch = peek(state);

  // Parens
  if (ch === "(") {
    advance(state);
    return { type: "lparen", loc: makeLoc(state, startPos, startLine, startCol) };
  }

  if (ch === ")") {
    advance(state);
    return { type: "rparen", loc: makeLoc(state, startPos, startLine, startCol) };
  }

  // Brackets (vectors)
  if (ch === "[") {
    advance(state);
    return { type: "lbracket", loc: makeLoc(state, startPos, startLine, startCol) };
  }

  if (ch === "]") {
    advance(state);
    return { type: "rbracket", loc: makeLoc(state, startPos, startLine, startCol) };
  }

  // Braces (maps)
  if (ch === "{") {
    advance(state);
    return { type: "lbrace", loc: makeLoc(state, startPos, startLine, startCol) };
  }

  if (ch === "}") {
    advance(state);
    return { type: "rbrace", loc: makeLoc(state, startPos, startLine, startCol) };
  }

  // Reader macros: quote, backtick, tilde, tilde-at
  if (ch === "'") {
    advance(state);
    return { type: "quote", loc: makeLoc(state, startPos, startLine, startCol) };
  }

  if (ch === "`") {
    advance(state);
    return { type: "backtick", loc: makeLoc(state, startPos, startLine, startCol) };
  }

  if (ch === "~") {
    if (peek(state, 1) === "@") {
      advance(state);
      advance(state);
      return { type: "tilde-at", loc: makeLoc(state, startPos, startLine, startCol) };
    }
    advance(state);
    return { type: "tilde", loc: makeLoc(state, startPos, startLine, startCol) };
  }

  // String (check for triple-quote first)
  if (ch === '"') {
    if (peek(state, 1) === '"' && peek(state, 2) === '"') {
      return readMultilineString(state);
    }
    return readString(state);
  }

  // Number
  if (/[0-9]/.test(ch) || (ch === "-" && /[0-9]/.test(peek(state, 1)))) {
    return readNumber(state);
  }

  // Symbol or boolean (symbols can start with $ for variables like $input.field)
  if (/[a-zA-Z.\-_:?!*+/<>=$&]/.test(ch)) {
    return readSymbol(state);
  }

  throw new ParseError({
    message: `Unexpected character: '${ch}'`,
    loc: { ...makeLoc(state, startPos, startLine, startCol), end: startPos + ch.length },
  });
};

/**
 * Tokenize the entire input
 */
export const tokenize = (input: string): Token[] => {
  const state = createState(input);
  const tokens: Token[] = [];

  while (true) {
    const token = nextToken(state);
    tokens.push(token);
    if (token.type === "eof") break;
  }

  return tokens;
};

/**
 * Collect trivia (whitespace and comments) without discarding
 * Returns array of Trivia objects
 */
const collectTrivia = (state: LexerState): Trivia[] => {
  const trivia: Trivia[] = [];

  while (!isEOF(state)) {
    const startPos = state.pos;
    const startLine = state.line;
    const startCol = state.col;
    const ch = peek(state);

    // Whitespace
    if (/\s/.test(ch)) {
      while (!isEOF(state) && /\s/.test(peek(state))) {
        advance(state);
      }
      trivia.push({
        kind: "whitespace",
        text: state.input.slice(startPos, state.pos),
        loc: makeLoc(state, startPos, startLine, startCol),
      });
      continue;
    }

    // Line comment (; ...)
    if (ch === ";") {
      while (!isEOF(state) && peek(state) !== "\n") {
        advance(state);
      }
      trivia.push({
        kind: "line-comment",
        text: state.input.slice(startPos, state.pos),
        loc: makeLoc(state, startPos, startLine, startCol),
      });
      continue;
    }

    break;
  }

  return trivia;
};

/**
 * Read the next token without skipping whitespace/comments
 * Used internally by tokenizeWithTrivia
 */
const readToken = (state: LexerState): Token => {
  if (isEOF(state)) {
    return {
      type: "eof",
      loc: makeLoc(state, state.pos, state.line, state.col),
    };
  }

  const startPos = state.pos;
  const startLine = state.line;
  const startCol = state.col;
  const ch = peek(state);

  // Parens
  if (ch === "(") {
    advance(state);
    return { type: "lparen", loc: makeLoc(state, startPos, startLine, startCol) };
  }

  if (ch === ")") {
    advance(state);
    return { type: "rparen", loc: makeLoc(state, startPos, startLine, startCol) };
  }

  // Brackets (vectors)
  if (ch === "[") {
    advance(state);
    return { type: "lbracket", loc: makeLoc(state, startPos, startLine, startCol) };
  }

  if (ch === "]") {
    advance(state);
    return { type: "rbracket", loc: makeLoc(state, startPos, startLine, startCol) };
  }

  // Braces (maps)
  if (ch === "{") {
    advance(state);
    return { type: "lbrace", loc: makeLoc(state, startPos, startLine, startCol) };
  }

  if (ch === "}") {
    advance(state);
    return { type: "rbrace", loc: makeLoc(state, startPos, startLine, startCol) };
  }

  // Reader macros: quote, backtick, tilde, tilde-at
  if (ch === "'") {
    advance(state);
    return { type: "quote", loc: makeLoc(state, startPos, startLine, startCol) };
  }

  if (ch === "`") {
    advance(state);
    return { type: "backtick", loc: makeLoc(state, startPos, startLine, startCol) };
  }

  if (ch === "~") {
    if (peek(state, 1) === "@") {
      advance(state);
      advance(state);
      return { type: "tilde-at", loc: makeLoc(state, startPos, startLine, startCol) };
    }
    advance(state);
    return { type: "tilde", loc: makeLoc(state, startPos, startLine, startCol) };
  }

  // String (check for triple-quote first)
  if (ch === '"') {
    if (peek(state, 1) === '"' && peek(state, 2) === '"') {
      return readMultilineString(state);
    }
    return readString(state);
  }

  // Number
  if (/[0-9]/.test(ch) || (ch === "-" && /[0-9]/.test(peek(state, 1)))) {
    return readNumber(state);
  }

  // Symbol or boolean (symbols can start with $ for variables like $input.field)
  if (/[a-zA-Z.\-_:?!*+/<>=$&]/.test(ch)) {
    return readSymbol(state);
  }

  throw new ParseError({
    message: `Unexpected character: '${ch}'`,
    loc: { ...makeLoc(state, startPos, startLine, startCol), end: startPos + ch.length },
  });
};

/**
 * Read the next token, turning a lexical error into an error token so that
 * tokenizing never throws. An unterminated string reads to the end of the
 * input; an unexpected character is skipped.
 */
const readTokenRecovering = (state: LexerState): Token => {
  const startPos = state.pos;
  const startLine = state.line;
  const startCol = state.col;
  try {
    return readToken(state);
  } catch (error) {
    if (!(error instanceof ParseError)) throw error;
    if (state.pos === startPos) advance(state);
    return { type: "error", error, loc: makeLoc(state, startPos, startLine, startCol) };
  }
};

/**
 * Tokenize input preserving trivia (whitespace and comments)
 * Each token is bundled with its leading trivia. Lexical errors become
 * `error` tokens instead of exceptions.
 */
export const tokenizeWithTrivia = (input: string): TokenWithTrivia[] => {
  const state = createState(input);
  const tokens: TokenWithTrivia[] = [];

  while (true) {
    const leadingTrivia = collectTrivia(state);
    const token = readTokenRecovering(state);
    tokens.push({ token, leadingTrivia });
    if (token.type === "eof") break;
  }

  return tokens;
};

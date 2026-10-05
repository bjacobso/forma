/**
 * Lexically safe assembly of source text.
 *
 * Editors build new source from pieces: slices of a document, new text, and
 * separators. Concatenation can change how the pieces read: a line comment
 * runs to the end of its line and swallows code put after it, and two atoms
 * with nothing between them read as one. `SourceBuilder` appends pieces so
 * that each reads exactly as it reads alone:
 *
 *     lex(a ⧺ b) = lex(a) ++ lex(b)        (comments included)
 *
 * It inserts the smallest separator that keeps a seam: a line break after an
 * open line comment, a space between tokens that would otherwise fuse. Text
 * that cannot be made to read on its own (an unterminated string swallows
 * everything after it) is appended as it is; callers that need the law check
 * the result.
 */

import { tokenizeWithTrivia } from "../reader/lexer.js";

/** A token or comment: what `lex` compares. Whitespace is not a lexeme. */
export interface Lexeme {
  readonly kind: string;
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

/**
 * The tokens and comments of a text, in order. A comment's text excludes a
 * carriage return before its line break: `\r\n` ends a line.
 */
export function lexemes(text: string): Lexeme[] {
  const result: Lexeme[] = [];
  for (const { token, leadingTrivia } of tokenizeWithTrivia(text)) {
    for (const trivia of leadingTrivia) {
      if (trivia.kind === "line-comment") {
        const text = trivia.text.endsWith("\r") ? trivia.text.slice(0, -1) : trivia.text;
        result.push({ kind: "comment", text, start: trivia.loc.start, end: trivia.loc.start + text.length });
      }
    }
    if (token.type === "eof") break;
    result.push({
      kind: token.type,
      text: text.slice(token.loc.start, token.loc.end),
      start: token.loc.start,
      end: token.loc.end,
    });
  }
  return result;
}

const sameLexemes = (left: readonly Lexeme[], right: readonly Lexeme[]): boolean =>
  left.length === right.length &&
  left.every((lexeme, index) => lexeme.kind === right[index]!.kind && lexeme.text === right[index]!.text);

export interface AppendOptions {
  /**
   * Column of the line that starts when a line break must be inserted after
   * a comment. Defaults to the column of the code before the comment on its
   * line, or the comment's own column.
   */
  readonly breakColumn?: number | undefined;
}

/** Builds source from pieces that keep their lexical boundaries. */
export class SourceBuilder {
  #text = "";
  /** Start of the last lexeme in `#text`, or -1 when there is none. */
  #tailStart = -1;
  #tailKind: string | undefined;

  get text(): string {
    return this.#text;
  }

  get length(): number {
    return this.#text.length;
  }

  /** Column at the end of the text built so far. */
  get column(): number {
    return this.#text.length - (this.#text.lastIndexOf("\n") + 1);
  }

  /** Whether the text built so far ends inside a line comment. */
  get inComment(): boolean {
    return this.#tailKind === "comment" && !this.#text.slice(this.#tailStart).includes("\n");
  }

  /**
   * Append a piece. Returns the amount to add to an offset in `piece` to get
   * its offset in the result; it is exact for every offset at or after the
   * piece's first token.
   */
  append(piece: string, options: AppendOptions = {}): number {
    if (piece === "") return this.#text.length;
    const own = lexemes(piece);
    let separator = "";
    let stripped = 0;
    if (this.inComment) {
      // Spaces put after an open comment would become part of its text; a
      // carriage return is kept only where it ends the line.
      stripped = /^[ \t\r]*/.exec(piece)![0].length;
      if (piece[stripped] === "\n" && piece[stripped - 1] === "\r") stripped--;
    }
    if (this.#tailStart >= 0 && own.length > 0) {
      const tail = this.#text.slice(this.#tailStart);
      const expected = [...lexemes(tail), own[0]!];
      const reads = (glue: string, from: number) =>
        sameLexemes(lexemes(tail + glue + piece.slice(from, own[0]!.end)), expected);
      if (!reads("", stripped)) {
        const candidate = this.inComment
          ? `\n${" ".repeat(Math.max(0, options.breakColumn ?? this.#commentBreakColumn()))}`
          : " ";
        // Text that cannot read on its own, such as an unterminated string
        // before the seam, is left as it is.
        if (reads(candidate, stripped)) separator = candidate;
      }
    }
    const shift = this.#text.length + separator.length - stripped;
    this.#text += separator + piece.slice(stripped);
    const last = own.at(-1);
    if (last) {
      this.#tailStart = shift + last.start;
      this.#tailKind = last.kind;
    }
    return shift;
  }

  #commentBreakColumn(): number {
    const lineStart = this.#text.lastIndexOf("\n", this.#tailStart - 1) + 1;
    const before = this.#text.slice(lineStart, this.#tailStart);
    const code = /\S/.exec(before);
    if (!code) return this.#tailStart - lineStart;
    // Align with the last code token before the comment on its line.
    const tokens = lexemes(before);
    const lastToken = tokens.at(-1);
    return lastToken ? lastToken.start : code.index;
  }
}

/** Concatenate pieces with `SourceBuilder`. */
export function joinSource(pieces: readonly string[], options: AppendOptions = {}): string {
  const builder = new SourceBuilder();
  for (const piece of pieces) builder.append(piece, options);
  return builder.text;
}

/**
 * Yield-based parser combinator framework
 *
 * Parsers are generators that yield instructions, interpreted by runParser.
 * This design separates grammar definition from execution concerns like
 * error recovery and trivia preservation.
 */

import { Effect, Result } from "effect";
import type { Token } from "./lexer.js";
import type { Loc } from "./types.js";
import { ParseError } from "./types.js";

// Re-export ParseError for convenience
export { ParseError };

/**
 * Parser state tracks position and collected errors
 */
export interface ParseState {
  readonly tokens: readonly Token[];
  readonly pos: number;
  readonly errors: readonly ParseError[];
}

/**
 * Result of parsing includes the value and updated state
 */
export interface ParseResult<A> {
  readonly value: A;
  readonly state: ParseState;
}

/**
 * Create initial parse state from tokens
 */
export const createParseState = (tokens: readonly Token[]): ParseState => ({
  tokens,
  pos: 0,
  errors: [],
});

/**
 * Parser operations - instructions that the interpreter understands
 */
export type ParserOp<A = unknown> =
  | { readonly _tag: "Token"; readonly tokenType: Token["type"]; readonly _A?: A }
  | {
      readonly _tag: "Choice";
      readonly parsers: ReadonlyArray<() => Generator<ParserOp, unknown, unknown>>;
      readonly _A?: A;
    }
  | {
      readonly _tag: "Many";
      readonly parser: () => Generator<ParserOp, unknown, unknown>;
      readonly _A?: A;
    }
  | {
      readonly _tag: "Optional";
      readonly parser: () => Generator<ParserOp, unknown, unknown>;
      readonly _A?: A;
    }
  | { readonly _tag: "Peek"; readonly _A?: A }
  | { readonly _tag: "Fail"; readonly message: string; readonly _A?: A };

/**
 * Parser combinator API
 */
export const P = {
  /**
   * Consume a token of a specific type
   */
  token: <T extends Token["type"]>(tokenType: T): ParserOp<Extract<Token, { type: T }>> => ({
    _tag: "Token",
    tokenType,
  }),

  /**
   * Try multiple parsers in order, return first success
   */
  choice: <A>(...parsers: ReadonlyArray<() => Generator<ParserOp, A, unknown>>): ParserOp<A> => ({
    _tag: "Choice",
    parsers,
  }),

  /**
   * Parse zero or more repetitions
   */
  many: <A>(parser: () => Generator<ParserOp, A, unknown>): ParserOp<readonly A[]> => ({
    _tag: "Many",
    parser,
  }),

  /**
   * Parse zero or one occurrence
   */
  optional: <A>(parser: () => Generator<ParserOp, A, unknown>): ParserOp<A | undefined> => ({
    _tag: "Optional",
    parser,
  }),

  /**
   * Peek at current token without consuming
   */
  peek: (): ParserOp<Token> => ({
    _tag: "Peek",
  }),

  /**
   * Explicitly fail with a message
   */
  fail: (message: string): ParserOp<never> => ({
    _tag: "Fail",
    message,
  }),

  /**
   * Create a named rule (for error messages and future green tree support)
   */
  rule: <A>(
    _name: string,
    fn: () => Generator<ParserOp, A, unknown>,
  ): (() => Generator<ParserOp, A, unknown>) => {
    // For now, just return the function directly
    // In Phase 4, this will emit Rule events for green tree
    return fn;
  },
};

/**
 * Get current token at position
 */
const currentToken = (state: ParseState): Token => {
  if (state.pos < state.tokens.length) {
    return state.tokens[state.pos]!;
  }
  // Return last token (should be EOF) if past end
  const last = state.tokens[state.tokens.length - 1];
  return last ?? { type: "eof", loc: { start: 0, end: 0, line: 1, col: 1 } };
};

/**
 * Create a location for error messages
 */
const errorLoc = (state: ParseState): Loc => {
  const token = currentToken(state);
  return token.loc;
};

/**
 * Run a parser generator, interpreting each instruction
 *
 * This is the core interpreter that processes parser operations.
 * It's designed to be enhanced later with error recovery and trivia handling.
 */
export const runParser = <A>(
  parserFn: () => Generator<ParserOp, A, unknown>,
  state: ParseState,
): Effect.Effect<ParseResult<A>, ParseError> => {
  return Effect.gen(function* () {
    const parser = parserFn();
    let currentState = state;
    let step = parser.next();

    while (!step.done) {
      const op = step.value;

      switch (op._tag) {
        case "Token": {
          const token = currentToken(currentState);
          if (token.type !== op.tokenType) {
            return yield* Effect.fail(
              new ParseError({
                message: `Expected ${op.tokenType}, got ${token.type}`,
                loc: token.loc,
              }),
            );
          }
          currentState = { ...currentState, pos: currentState.pos + 1 };
          step = parser.next(token);
          break;
        }

        case "Choice": {
          let succeeded = false;
          let lastError: ParseError | null = null;

          for (const altFn of op.parsers) {
            const result = yield* runParser(altFn, currentState).pipe(Effect.result);

            if (Result.isSuccess(result)) {
              currentState = result.success.state;
              step = parser.next(result.success.value);
              succeeded = true;
              break;
            }
            lastError = result.failure;
          }

          if (!succeeded) {
            return yield* Effect.fail(
              lastError ??
                new ParseError({ message: "No alternatives matched", loc: errorLoc(currentState) }),
            );
          }
          break;
        }

        case "Many": {
          const items: unknown[] = [];

          while (true) {
            const result = yield* runParser(op.parser, currentState).pipe(Effect.result);

            if (Result.isFailure(result)) {
              break;
            }

            items.push(result.success.value);
            currentState = result.success.state;
          }

          step = parser.next(items);
          break;
        }

        case "Optional": {
          const result = yield* runParser(op.parser, currentState).pipe(Effect.result);

          if (Result.isSuccess(result)) {
            currentState = result.success.state;
            step = parser.next(result.success.value);
          } else {
            step = parser.next(undefined);
          }
          break;
        }

        case "Peek": {
          const token = currentToken(currentState);
          step = parser.next(token);
          break;
        }

        case "Fail": {
          return yield* Effect.fail(
            new ParseError({ message: op.message, loc: errorLoc(currentState) }),
          );
        }

        default: {
          // Exhaustiveness check
          const _exhaustive: never = op;
          return _exhaustive;
        }
      }
    }

    return { value: step.value, state: currentState };
  });
};

/**
 * Helper to check if current token matches a type without consuming
 */
export const isTokenType = (state: ParseState, tokenType: Token["type"]): boolean => {
  const token = currentToken(state);
  return token.type === tokenType;
};

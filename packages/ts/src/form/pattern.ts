/**
 * Pattern Matching Primitives
 *
 * Composable building blocks for defining form patterns.
 * Patterns match against Red Tree nodes and extract captured values.
 *
 * @module
 */

import { Effect } from "effect";
import type { RedNode, RedToken, RedElement, Loc } from "../reader/index.js";
import { isRedNode, isRedToken } from "../reader/index.js";
import { DSLError, type Completion, type CompletionPosition } from "./core.js";

// =============================================================================
// Red Tree Utilities
// =============================================================================

/**
 * Get content children of a node (non-delimiter children)
 */
export function getContentChildren(node: RedNode): readonly RedElement[] {
  return node.children();
}

/**
 * Get the first token in a node (for location info)
 */
function getFirstToken(node: RedNode): RedToken | undefined {
  for (const child of node.children()) {
    if (isRedToken(child)) {
      return child;
    }
    if (isRedNode(child)) {
      const found = getFirstToken(child);
      if (found) return found;
    }
  }
  return undefined;
}

/**
 * Get location from a RedNode by finding its first token
 */
export function getNodeLoc(node: RedNode): Loc {
  const token = getFirstToken(node);
  if (token) {
    return token.loc();
  }
  // Fallback for empty nodes
  return { start: 0, end: 0, line: 1, col: 1 };
}

// =============================================================================
// Pattern Meta (Introspection)
// =============================================================================

/**
 * Structural metadata attached to patterns for introspection.
 * Enables walking the pattern tree to generate grammar documentation
 * without actually parsing lisp.
 */
export type PatternMeta =
  | { readonly type: "keyword"; readonly name: string }
  | { readonly type: "symbol" }
  | { readonly type: "string" }
  | { readonly type: "number" }
  | { readonly type: "boolean" }
  | { readonly type: "any" }
  | {
      readonly type: "list";
      readonly head: string;
      readonly args: Record<string, Pattern<unknown, unknown>>;
      readonly argNames: readonly string[];
    }
  | { readonly type: "oneof"; readonly alternatives: readonly Pattern<unknown, unknown>[] }
  | { readonly type: "optional"; readonly inner: Pattern<unknown, unknown> }
  | { readonly type: "many"; readonly inner: Pattern<unknown, unknown> }
  | {
      readonly type: "clauses";
      readonly specs: Record<
        string,
        { readonly pattern: Pattern<unknown, unknown>; readonly required?: boolean }
      >;
    }
  | { readonly type: "map"; readonly inner: Pattern<unknown, unknown> }
  | { readonly type: "formref"; readonly formNames: readonly string[] };

// =============================================================================
// Pattern Type
// =============================================================================

/**
 * A pattern that matches against a RedNode and extracts a value.
 *
 * Patterns are composable - you can combine them with OneOf, Optional, Many, etc.
 *
 * @typeParam T - The type of value extracted when the pattern matches
 * @typeParam R - Effect requirements (services) needed by this pattern
 */
export interface Pattern<T, R = never> {
  /** Unique identifier for this pattern type */
  readonly kind: string;

  /** Human-readable description for error messages */
  readonly description: string;

  /**
   * Match this pattern against a node.
   * Returns the extracted value or fails with a DSLError.
   */
  match(node: RedNode): Effect.Effect<T, DSLError, R>;

  /**
   * Get completions for this pattern at a position.
   * Default implementation returns empty array.
   */
  complete?: ((partial: string, pos: CompletionPosition) => Completion[]) | undefined;

  /** Structural metadata for introspection and grammar doc generation */
  readonly meta?: PatternMeta;
}

/**
 * Extended pattern interface for Many patterns, exposing the inner pattern
 * for special handling in List context.
 */
export interface ManyPattern<T, R = never> extends Pattern<readonly T[], R> {
  readonly kind: "many";
  readonly _inner: Pattern<T, R>;
}

// =============================================================================
// Primitive Patterns
// =============================================================================

/**
 * Match a symbol with a specific name (keyword)
 */
export function Keyword(name: string): Pattern<void> {
  return {
    kind: "keyword",
    description: `'${name}'`,
    meta: { type: "keyword", name },

    match(node: RedNode): Effect.Effect<void, DSLError> {
      // For a simple symbol node, check if it matches
      if (node.kind() === "Symbol") {
        const text = getNodeText(node);
        if (text === name) {
          return Effect.succeed(undefined);
        }
        return Effect.fail(new DSLError(`Expected '${name}', got '${text}'`, getNodeLoc(node)));
      }
      return Effect.fail(new DSLError(`Expected '${name}'`, getNodeLoc(node)));
    },

    complete(partial: string): Completion[] {
      if (name.toLowerCase().startsWith(partial.toLowerCase())) {
        return [{ label: name, kind: "keyword" }];
      }
      return [];
    },
  };
}

/**
 * Match any symbol, capturing its name
 */
export const Sym: Pattern<string> = {
  kind: "symbol",
  description: "symbol",
  meta: { type: "symbol" },

  match(node: RedNode): Effect.Effect<string, DSLError> {
    if (node.kind() === "Symbol") {
      return Effect.succeed(getNodeText(node));
    }
    return Effect.fail(new DSLError("Expected symbol", getNodeLoc(node)));
  },
};

/**
 * Match a string literal, capturing its value
 */
export const Str: Pattern<string> = {
  kind: "string",
  description: "string",
  meta: { type: "string" },

  match(node: RedNode): Effect.Effect<string, DSLError> {
    if (node.kind() === "String") {
      // Remove quotes from the string value
      const text = getNodeText(node);
      // Handle multiline strings (triple-quoted)
      if (text.startsWith('"""')) {
        return Effect.succeed(text.slice(3, -3));
      }
      return Effect.succeed(text.slice(1, -1));
    }
    return Effect.fail(new DSLError("Expected string", getNodeLoc(node)));
  },
};

/**
 * Match a number literal, capturing its value
 */
export const Num: Pattern<number> = {
  kind: "number",
  description: "number",
  meta: { type: "number" },

  match(node: RedNode): Effect.Effect<number, DSLError> {
    if (node.kind() === "Number") {
      const text = getNodeText(node);
      const value = parseFloat(text);
      if (isNaN(value)) {
        return Effect.fail(new DSLError(`Invalid number: ${text}`, getNodeLoc(node)));
      }
      return Effect.succeed(value);
    }
    return Effect.fail(new DSLError("Expected number", getNodeLoc(node)));
  },
};

/**
 * Match a boolean literal, capturing its value
 */
export const Bool: Pattern<boolean> = {
  kind: "boolean",
  description: "boolean",
  meta: { type: "boolean" },

  match(node: RedNode): Effect.Effect<boolean, DSLError> {
    if (node.kind() === "Boolean") {
      const text = getNodeText(node);
      if (text === "true") return Effect.succeed(true);
      if (text === "false") return Effect.succeed(false);
    }
    return Effect.fail(new DSLError("Expected boolean (true or false)", getNodeLoc(node)));
  },
};

// =============================================================================
// Composite Patterns
// =============================================================================

/**
 * Match a list with a specific head symbol and extract arguments.
 *
 * The requirements (R type) are automatically inferred from all argument patterns,
 * so patterns with Effect service dependencies will propagate their requirements.
 *
 * @example
 * ```typescript
 * // Match (field e name)
 * const FieldPattern = List("field", {
 *   entity: Sym,
 *   fieldName: Sym,
 * });
 * ```
 */
export function List<Args extends Record<string, Pattern<unknown, unknown>>>(
  head: string,
  args: Args,
): Pattern<{ [K in keyof Args]: PatternResult<Args[K]> }, PatternRequirements<Args[keyof Args]>> {
  type Result = { [K in keyof Args]: PatternResult<Args[K]> };
  type Req = PatternRequirements<Args[keyof Args]>;
  const argNames = Object.keys(args);

  const pattern: Pattern<Result, Req> = {
    kind: "list",
    description: `(${head} ...)`,
    meta: { type: "list", head, args: args as Record<string, Pattern<unknown, unknown>>, argNames },

    match(node: RedNode) {
      return Effect.gen(function* () {
        // Must be a list node
        if (node.kind() !== "List") {
          return yield* Effect.fail(new DSLError(`Expected (${head} ...)`, getNodeLoc(node)));
        }

        const children = getContentChildren(node).filter(isRedNode);

        if (children.length === 0) {
          return yield* Effect.fail(
            new DSLError(`Expected (${head} ...), got empty list`, getNodeLoc(node)),
          );
        }

        // Match each argument
        const result: Record<string, unknown> = {};
        let argChildren: readonly RedNode[];

        // If head is empty, this is a generic list pattern - no head to check/skip
        if (head === "") {
          argChildren = children;
        } else {
          // Check the head keyword
          const headNode = children[0]!;
          const headText = getNodeText(headNode);
          if (headText !== head) {
            return yield* Effect.fail(
              new DSLError(`Expected (${head} ...), got (${headText} ...)`, getNodeLoc(node)),
            );
          }
          argChildren = children.slice(1);
        }
        let childIndex = 0;

        for (let i = 0; i < argNames.length; i++) {
          const argName = argNames[i]!;
          const argPattern = args[argName] as Pattern<unknown, Req>;

          // Special handling for Many pattern: consume all remaining children
          if (argPattern.kind === "many") {
            const remainingChildren = argChildren.slice(childIndex);
            const results: unknown[] = [];

            for (const child of remainingChildren) {
              const innerPattern = (argPattern as unknown as ManyPattern<unknown, Req>)._inner;
              const matchResult = yield* Effect.result(innerPattern.match(child));
              if (matchResult._tag === "Success") {
                results.push(matchResult.success);
                childIndex++;
              } else {
                // For Many in List context, propagate the error instead of stopping silently
                return yield* Effect.fail(matchResult.failure);
              }
            }

            result[argName] = results;
            continue;
          }

          if (childIndex >= argChildren.length) {
            // If the pattern is optional, allow missing children
            if (argPattern.kind === "optional") {
              result[argName] = undefined;
              continue;
            }
            return yield* Effect.fail(
              new DSLError(`Missing argument '${argName}' in (${head} ...)`, getNodeLoc(node)),
            );
          }

          const argNode = argChildren[childIndex]!;
          const argResult = yield* argPattern.match(argNode);
          result[argName] = argResult;
          if (argPattern.kind !== "optional" || argResult !== undefined) {
            childIndex++;
          }
        }

        return result as Result;
      });
    },

    complete(partial: string, pos: CompletionPosition): Completion[] {
      // If at head position, suggest the keyword
      if (pos.argIndex === -1) {
        if (head.toLowerCase().startsWith(partial.toLowerCase())) {
          return [{ label: head, kind: "keyword" }];
        }
        return [];
      }

      // If at an argument position, delegate to that argument's pattern
      if (pos.argIndex >= 0 && pos.argIndex < argNames.length) {
        const argName = argNames[pos.argIndex]!;
        const argPattern = args[argName]!;
        if (argPattern.complete) {
          return argPattern.complete(partial, pos);
        }
      }

      return [];
    },
  };

  return pattern;
}

/**
 * Match one of several patterns
 */
export function OneOf<T, R>(...patterns: Pattern<T, R>[]): Pattern<T, R> {
  return {
    kind: "oneof",
    description: patterns.map((p) => p.description).join(" | "),
    meta: { type: "oneof", alternatives: patterns as readonly Pattern<unknown, unknown>[] },

    match(node: RedNode): Effect.Effect<T, DSLError, R> {
      return Effect.gen(function* () {
        const errors: DSLError[] = [];

        for (const pattern of patterns) {
          const result = yield* Effect.result(pattern.match(node));
          if (result._tag === "Success") {
            return result.success;
          }
          errors.push(result.failure);
        }

        // All patterns failed - combine error messages
        const descriptions = patterns.map((p) => p.description).join(", ");
        return yield* Effect.fail(
          new DSLError(`Expected one of: ${descriptions}`, getNodeLoc(node)),
        );
      });
    },

    complete(partial: string, pos: CompletionPosition): Completion[] {
      // Collect completions from all patterns
      const completions: Completion[] = [];
      for (const pattern of patterns) {
        if (pattern.complete) {
          completions.push(...pattern.complete(partial, pos));
        }
      }
      return completions;
    },
  };
}

/**
 * Optional pattern - matches if present, returns undefined if not
 */
export function Optional<T, R>(pattern: Pattern<T, R>): Pattern<T | undefined, R> {
  return {
    kind: "optional",
    description: `[${pattern.description}]`,
    meta: { type: "optional", inner: pattern as Pattern<unknown, unknown> },

    match(node: RedNode): Effect.Effect<T | undefined, DSLError, R> {
      return Effect.catch(pattern.match(node), () => Effect.succeed(undefined));
    },

    complete(partial: string, pos: CompletionPosition): Completion[] {
      if (pattern.complete) {
        return pattern.complete(partial, pos);
      }
      return [];
    },
  };
}

/**
 * Match a sequence of nodes with the same pattern.
 *
 * When used inside a List pattern, consumes all remaining children and
 * fails if any child doesn't match. When used standalone, stops at the
 * first non-matching element.
 */
export function Many<T, R>(pattern: Pattern<T, R>): ManyPattern<T, R> {
  return {
    kind: "many",
    description: `${pattern.description}*`,
    meta: { type: "many", inner: pattern as Pattern<unknown, unknown> },
    _inner: pattern,

    match(node: RedNode): Effect.Effect<readonly T[], DSLError, R> {
      return Effect.gen(function* () {
        // This is designed to match multiple children, so we expect
        // to be called with a container node
        if (node.kind() !== "List") {
          // Try to match as a single element
          const result = yield* pattern.match(node);
          return [result];
        }

        const children = getContentChildren(node).filter(isRedNode);
        const results: T[] = [];

        for (const child of children) {
          const result = yield* Effect.result(pattern.match(child));
          if (result._tag === "Success") {
            results.push(result.success);
          }
          // For Many, we stop at the first non-match
          // This allows mixing Many with other patterns
          else {
            break;
          }
        }

        return results;
      });
    },

    complete(partial: string, pos: CompletionPosition): Completion[] {
      if (pattern.complete) {
        return pattern.complete(partial, pos);
      }
      return [];
    },
  };
}

/**
 * Match any node, returning the raw RedNode
 */
export const Any: Pattern<RedNode> = {
  kind: "any",
  description: "<any>",
  meta: { type: "any" },

  match(node: RedNode): Effect.Effect<RedNode, DSLError> {
    return Effect.succeed(node);
  },
};

/**
 * Transform a pattern's result
 */
export function Map<T, U, R>(pattern: Pattern<T, R>, fn: (value: T) => U): Pattern<U, R> {
  return {
    kind: "map",
    description: pattern.description,
    meta: { type: "map", inner: pattern as Pattern<unknown, unknown> },

    match(node: RedNode): Effect.Effect<U, DSLError, R> {
      return Effect.map(pattern.match(node), fn);
    },

    complete: pattern.complete,
  };
}

/**
 * Add custom completions to a pattern
 */
export function WithCompletions<T, R>(
  pattern: Pattern<T, R>,
  completeFn: (partial: string, pos: CompletionPosition) => Completion[],
): Pattern<T, R> {
  return {
    ...pattern,
    complete: completeFn,
  };
}

// =============================================================================
// Clause Patterns (for query-like forms)
// =============================================================================

/**
 * Match clauses in any order by their head symbol.
 * Returns a record of matched clauses.
 */
export function Clauses<
  Specs extends Record<string, { pattern: Pattern<unknown, unknown>; required?: boolean }>,
>(
  specs: Specs,
): Pattern<
  { [K in keyof Specs]: PatternResult<Specs[K]["pattern"]> | undefined },
  PatternRequirements<Specs[keyof Specs]["pattern"]>
> {
  type Result = { [K in keyof Specs]: PatternResult<Specs[K]["pattern"]> | undefined };
  type Req = PatternRequirements<Specs[keyof Specs]["pattern"]>;

  const pattern: Pattern<Result, Req> = {
    kind: "clauses",
    description: `clauses { ${Object.keys(specs).join(", ")} }`,
    meta: {
      type: "clauses",
      specs: specs as Record<string, { pattern: Pattern<unknown, unknown>; required?: boolean }>,
    },

    match(node: RedNode) {
      return Effect.gen(function* () {
        if (node.kind() !== "List") {
          return yield* Effect.fail(new DSLError("Expected list of clauses", getNodeLoc(node)));
        }

        const children = getContentChildren(node).filter(isRedNode);
        const result: Record<string, unknown> = {};
        const matched = new Set<string>();

        // Initialize all to undefined
        for (const name of Object.keys(specs)) {
          result[name] = undefined;
        }

        // Try to match each child against clause patterns
        for (const child of children) {
          const childHead = getListHead(child);
          if (!childHead) continue;

          for (const [name, spec] of Object.entries(specs)) {
            if (matched.has(name)) continue;

            const clausePattern = spec.pattern as Pattern<unknown, Req>;
            const matchResult = yield* Effect.result(clausePattern.match(child));
            if (matchResult._tag === "Success") {
              result[name] = matchResult.success;
              matched.add(name);
              break;
            }
          }
        }

        // Check required clauses
        for (const [name, spec] of Object.entries(specs)) {
          if (spec.required && result[name] === undefined) {
            return yield* Effect.fail(
              new DSLError(`Missing required clause '${name}'`, getNodeLoc(node)),
            );
          }
        }

        return result as Result;
      });
    },

    complete(partial: string, _pos: CompletionPosition): Completion[] {
      const completions: Completion[] = [];

      for (const [name, spec] of Object.entries(specs)) {
        // Extract the clause head keyword from the pattern metadata
        const clauseHead = getClauseHead(name, spec.pattern);

        if (clauseHead.toLowerCase().startsWith(partial.toLowerCase())) {
          completions.push({
            label: clauseHead,
            kind: "keyword",
            ...(spec.required ? { detail: "required" } : {}),
            insertText: `(${clauseHead} $1)`,
            isSnippet: true,
          });
        }
      }

      return completions;
    },
  };

  return pattern;
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Extract the type of value a pattern produces
 */
export type PatternResult<P> = P extends Pattern<infer T, unknown> ? T : never;

/**
 * Extract the requirements type from a pattern
 */
export type PatternRequirements<P> = P extends Pattern<unknown, infer R> ? R : never;

/**
 * Get the text content of a RedNode
 */
export function getNodeText(node: RedNode): string {
  return node.text();
}

/**
 * Extract the clause head keyword from a pattern's metadata.
 * Falls back to the spec name if no head can be determined.
 */
function getClauseHead(specName: string, pattern: Pattern<unknown, unknown>): string {
  // List patterns have a head in their meta
  if (pattern.meta?.type === "list") {
    return pattern.meta.head || specName;
  }
  // OneOf patterns: try the first alternative
  if (pattern.meta?.type === "oneof") {
    for (const alt of pattern.meta.alternatives) {
      const head = getClauseHead(specName, alt);
      if (head !== specName) return head;
    }
  }
  // Optional/Map/Many: try inner
  if (
    pattern.meta?.type === "optional" ||
    pattern.meta?.type === "map" ||
    pattern.meta?.type === "many"
  ) {
    return getClauseHead(specName, pattern.meta.inner);
  }
  return specName;
}

/**
 * Get the head symbol of a list node
 */
export function getListHead(node: RedNode): string | undefined {
  if (node.kind() !== "List") return undefined;

  const children = getContentChildren(node).filter(isRedNode);
  if (children.length === 0) return undefined;

  return getNodeText(children[0]!);
}

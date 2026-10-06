import { Data } from "effect";

/**
 * Source location for error reporting
 */
export interface Loc {
  readonly sourceId?: string;
  readonly start: number;
  readonly end: number;
  readonly line: number;
  readonly col: number;
}

/**
 * Span represents a range of bytes in source (simpler than Loc, no line/col)
 */
export interface Span {
  readonly start: number;
  readonly end: number;
}

// =============================================================================
// Trivia Types - Whitespace and comments preserved for lossless parsing
// =============================================================================

/**
 * Kind of trivia (non-semantic content)
 */
export type TriviaKind = "whitespace" | "line-comment";

/**
 * Trivia represents whitespace or comments in source
 */
export interface Trivia {
  readonly kind: TriviaKind;
  readonly text: string;
  readonly loc: Loc;
}

/**
 * S-expression AST node types
 */
export type SExpr = List | Vector | SMap | SSet | Sym | Str | Num | Bool | ErrorNode;

export interface List {
  readonly _tag: "List";
  readonly items: readonly SExpr[];
  readonly loc: Loc;
}

export interface Vector {
  readonly _tag: "Vector";
  readonly items: readonly SExpr[];
  readonly loc: Loc;
}

export interface SMap {
  readonly _tag: "Map";
  readonly pairs: readonly (readonly [SExpr, SExpr])[];
  readonly loc: Loc;
}

export interface SSet {
  readonly _tag: "Set";
  readonly items: readonly SExpr[];
  readonly loc: Loc;
}

export interface Sym {
  readonly _tag: "Sym";
  readonly name: string;
  readonly loc: Loc;
}

export interface Str {
  readonly _tag: "Str";
  readonly value: string;
  readonly loc: Loc;
}

export interface Num {
  readonly _tag: "Num";
  readonly value: number;
  readonly loc: Loc;
}

export interface Bool {
  readonly _tag: "Bool";
  readonly value: boolean;
  readonly loc: Loc;
}

/**
 * Error node for parse errors (used in error-recovering parser)
 */
export interface ErrorNode {
  readonly _tag: "Error";
  readonly message: string;
  readonly loc: Loc;
}

/**
 * Constructor helpers
 */
export const List = (items: readonly SExpr[], loc: Loc): List => ({
  _tag: "List",
  items,
  loc,
});

export const Vector = (items: readonly SExpr[], loc: Loc): Vector => ({
  _tag: "Vector",
  items,
  loc,
});

export const SMap = (pairs: readonly (readonly [SExpr, SExpr])[], loc: Loc): SMap => ({
  _tag: "Map",
  pairs,
  loc,
});

export const SSet = (items: readonly SExpr[], loc: Loc): SSet => ({
  _tag: "Set",
  items,
  loc,
});

export const Sym = (name: string, loc: Loc): Sym => ({
  _tag: "Sym",
  name,
  loc,
});

export const Str = (value: string, loc: Loc): Str => ({
  _tag: "Str",
  value,
  loc,
});

export const Num = (value: number, loc: Loc): Num => ({
  _tag: "Num",
  value,
  loc,
});

export const Bool = (value: boolean, loc: Loc): Bool => ({
  _tag: "Bool",
  value,
  loc,
});

export const ErrorNode = (message: string, loc: Loc): ErrorNode => ({
  _tag: "Error",
  message,
  loc,
});

/**
 * Parse error with location information
 */
export class ParseError extends Data.TaggedError("ParseError")<{
  readonly message: string;
  readonly loc?: Loc;
}> {
  override get message(): string {
    return this.loc
      ? `${super.message} at line ${this.loc.line}, column ${this.loc.col}`
      : super.message;
  }
}

// =============================================================================
// Structural combinators
// =============================================================================

/** Get the immediate child expressions of an SExpr node. */
export const children = (expr: SExpr): readonly SExpr[] => {
  switch (expr._tag) {
    case "List":
      return expr.items;
    case "Vector":
      return expr.items;
    case "Map":
      return expr.pairs.flatMap(([k, v]) => [k, v]);
    case "Set":
      return expr.items;
    default:
      return [];
  }
};

/** If expr is a List whose first item is a Sym, return that symbol name. */
export const headSym = (expr: SExpr): string | undefined =>
  expr._tag === "List" && expr.items[0]?._tag === "Sym" ? expr.items[0].name : undefined;

/** Get the tail items of a List (everything after the head). */
export const tail = (expr: SExpr): readonly SExpr[] =>
  expr._tag === "List" ? expr.items.slice(1) : [];

// =============================================================================
// Domain-specific extractors
// =============================================================================

/**
 * Assert expr is a Sym and return its name. Throws with context on failure.
 */
export const asSym = (expr: SExpr, context?: string): string => {
  if (expr._tag === "Sym") return expr.name;
  throw new Error(
    context ? `${context}: expected symbol, got ${expr._tag}` : `expected symbol, got ${expr._tag}`,
  );
};

/**
 * Assert expr is a Vector and return its items. Throws with context on failure.
 */
export const asVector = (expr: SExpr, context?: string): readonly SExpr[] => {
  if (expr._tag === "Vector") return expr.items;
  throw new Error(
    context ? `${context}: expected vector, got ${expr._tag}` : `expected vector, got ${expr._tag}`,
  );
};

/**
 * Assert expr is a Str and return its value. Throws with context on failure.
 */
export const asStr = (expr: SExpr, context?: string): string => {
  if (expr._tag === "Str") return expr.value;
  throw new Error(
    context ? `${context}: expected string, got ${expr._tag}` : `expected string, got ${expr._tag}`,
  );
};

/**
 * Assert expr is a Num and return its value. Throws with context on failure.
 */
export const asNum = (expr: SExpr, context?: string): number => {
  if (expr._tag === "Num") return expr.value;
  throw new Error(
    context ? `${context}: expected number, got ${expr._tag}` : `expected number, got ${expr._tag}`,
  );
};

/**
 * Assert expr is a List and return its items. Throws with context on failure.
 */
export const asList = (expr: SExpr, context?: string): readonly SExpr[] => {
  if (expr._tag === "List") return expr.items;
  throw new Error(
    context ? `${context}: expected list, got ${expr._tag}` : `expected list, got ${expr._tag}`,
  );
};

/**
 * Try to extract a symbol name. Returns undefined instead of throwing.
 */
export const trySym = (expr: SExpr): string | undefined =>
  expr._tag === "Sym" ? expr.name : undefined;

/**
 * Parse a binding vector `[name1 val1 name2 val2 ...]` into pairs.
 * Returns an array of `{ name: SExpr, value: SExpr }` pairs.
 * Throws if the vector has an odd number of items.
 */
export const bindingPairs = (
  vectorExpr: SExpr,
  context?: string,
): readonly { readonly name: SExpr; readonly value: SExpr }[] => {
  const items = asVector(vectorExpr, context);
  if (items.length % 2 !== 0) {
    throw new Error(
      context
        ? `${context}: binding vector must have even number of items, got ${items.length}`
        : `binding vector must have even number of items, got ${items.length}`,
    );
  }
  const pairs: { readonly name: SExpr; readonly value: SExpr }[] = [];
  for (let i = 0; i < items.length; i += 2) {
    pairs.push({ name: items[i]!, value: items[i + 1]! });
  }
  return pairs;
};

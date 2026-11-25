/**
 * Shared data-type assignability relation used by both the HM checker
 * (`packages/ts/src/type/`) and the mechanics checker (`packages/ts/src/mechanics/`).
 *
 * Covers the converged data-type core (RFC 0004 / `docs/proposals/one-checker.md` stage 3):
 * - Primitives (including directional `Int -> Float`, never `Float -> Int`)
 * - Literals (string, keyword, boolean, int, float) and their base primitives
 * - Nominal brands (`Brand<Name, Base>`: nominal to brands, assignable to `Base` and its supertypes)
 * - Covariant `Option<Item>`
 * - Gradual `Unknown` and bottom `Never`
 *
 * Solver-specific constructs (HM type variables, open rows, effect rows,
 * typeclasses; mechanics provenance sets, services, layers, refs, streams)
 * remain in their respective solvers and delegate to this relation for the
 * shared data-type core.
 *
 * @module
 */

export type SharedPrimitiveName =
  | "String"
  | "Int"
  | "Float"
  | "Bool"
  | "Unit"
  | "Keyword"
  | "Null"
  | "Json"
  | "Bytes"
  | "DateTime"
  | "Duration"
  | "Schedule"
  | "Symbol"
  | "Syntax";

export const SHARED_PRIMITIVE_NAMES: ReadonlySet<string> = new Set<SharedPrimitiveName>([
  "String",
  "Int",
  "Float",
  "Bool",
  "Unit",
  "Keyword",
  "Null",
  "Json",
  "Bytes",
  "DateTime",
  "Duration",
  "Schedule",
  "Symbol",
  "Syntax",
]);

export type DataLiteral =
  | { readonly kind: "string"; readonly value: string }
  | { readonly kind: "keyword"; readonly value: string }
  | { readonly kind: "boolean"; readonly value: boolean }
  | { readonly kind: "int"; readonly value: number }
  | { readonly kind: "float"; readonly value: number };

export interface DataRefinement {
  readonly min?: number;
  readonly max?: number;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly pattern?: string;
  readonly finite?: boolean;
}

const attachedRefinements = new WeakMap<object, DataRefinement>();

/** Attaches compile-time literal refinements to a type node object. */
export function attachRefinement<T extends object>(type: T, refine: DataRefinement): T {
  const existing = attachedRefinements.get(type);
  attachedRefinements.set(type, existing ? { ...existing, ...refine } : refine);
  return type;
}

/** Returns any compile-time literal refinements attached to a type node object. */
export function getRefinement(type: object): DataRefinement | undefined {
  return attachedRefinements.get(type);
}

/** Formats a data literal for refinement diagnostics. */
export function formatDataLiteral(literal: DataLiteral): string {
  switch (literal.kind) {
    case "string":
      return JSON.stringify(literal.value);
    case "keyword":
      return literal.value;
    case "boolean":
    case "int":
    case "float":
      return String(literal.value);
  }
}

/** Renders a refined primitive the way it is written in Forma source. */
export function showDataRefinement(primitive: string, refine: DataRefinement): string {
  const parts = [
    ...(refine.min !== undefined ? [`:min ${refine.min}`] : []),
    ...(refine.max !== undefined ? [`:max ${refine.max}`] : []),
    ...(refine.minLength !== undefined ? [`:min-length ${refine.minLength}`] : []),
    ...(refine.maxLength !== undefined ? [`:max-length ${refine.maxLength}`] : []),
    ...(refine.pattern !== undefined ? [`:pattern ${JSON.stringify(refine.pattern)}`] : []),
    ...(refine.finite === true ? [":finite true"] : []),
  ];
  return parts.length > 0 ? `(${primitive} ${parts.join(" ")})` : primitive;
}

/** Why a literal falls outside a primitive's refinements, or undefined when it fits. */
export function checkLiteralRefinement(literal: DataLiteral, refine: DataRefinement): string | undefined {
  if (literal.kind === "int" || literal.kind === "float") {
    if (refine.finite === true && !Number.isFinite(literal.value)) return "must be finite";
    if (refine.min !== undefined && literal.value < refine.min) return `must be at least ${refine.min}`;
    if (refine.max !== undefined && literal.value > refine.max) return `must be at most ${refine.max}`;
  }
  if (literal.kind === "string") {
    if (refine.minLength !== undefined && literal.value.length < refine.minLength) {
      return `must have at least ${refine.minLength} character${refine.minLength === 1 ? "" : "s"}`;
    }
    if (refine.maxLength !== undefined && literal.value.length > refine.maxLength) {
      return `must have at most ${refine.maxLength} character${refine.maxLength === 1 ? "" : "s"}`;
    }
    if (refine.pattern !== undefined) {
      try {
        if (!new RegExp(refine.pattern).test(literal.value)) {
          return `must match the pattern ${refine.pattern}`;
        }
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

export type DataNode<Raw> =
  | { readonly kind: "unknown"; readonly raw: Raw }
  | { readonly kind: "never"; readonly raw: Raw }
  | { readonly kind: "prim"; readonly name: string; readonly refine?: DataRefinement; readonly raw: Raw }
  | { readonly kind: "literal"; readonly literal: DataLiteral; readonly raw: Raw }
  | { readonly kind: "brand"; readonly name: string; readonly base: Raw; readonly raw: Raw }
  | { readonly kind: "option"; readonly item: Raw; readonly raw: Raw }
  | { readonly kind: "other"; readonly raw: Raw };

export type DataRelationDecision<Raw> =
  | { readonly verdict: "accept" }
  | { readonly verdict: "reject" }
  | {
      readonly verdict: "refinement-error";
      readonly literal: DataLiteral;
      readonly primitive: string;
      readonly refine: DataRefinement;
      readonly problem: string;
    }
  | { readonly verdict: "check"; readonly actual: Raw; readonly expected: Raw }
  | { readonly verdict: "defer" };

export function isPrimitiveName(name: string): name is SharedPrimitiveName {
  return SHARED_PRIMITIVE_NAMES.has(name);
}

export function isNumericPrimitive(name: string): name is "Int" | "Float" {
  return name === "Int" || name === "Float";
}

/** Directional primitive assignability: every `Int` is a `Float`; `Float` is never an `Int`. */
export function isPrimitiveAssignable(actual: string, expected: string): boolean {
  return actual === expected || (actual === "Int" && expected === "Float");
}

/** Least upper bound of two numeric primitives, preserving `Int` when both are `Int`. */
export function joinNumericPrimitives(left: string, right: string): "Int" | "Float" | undefined {
  if (!isNumericPrimitive(left) || !isNumericPrimitive(right)) return undefined;
  return left === "Int" && right === "Int" ? "Int" : "Float";
}

/** The primitive type a literal widens to. */
export function literalBasePrimitive(literal: DataLiteral): "String" | "Keyword" | "Bool" | "Int" | "Float" {
  switch (literal.kind) {
    case "string":
      return "String";
    case "keyword":
      return "Keyword";
    case "boolean":
      return "Bool";
    case "int":
      return "Int";
    case "float":
      return "Float";
  }
}

/** Parses an HM literal `TCon` name (`"a"`, `:ok`, `true`, `42`, `1.5`) into a typed `DataLiteral`. */
export function parseLiteralTypeName(name: string): DataLiteral | undefined {
  if (name.startsWith(":")) return { kind: "keyword", value: name };
  try {
    const value: unknown = JSON.parse(name);
    if (typeof value === "string") return { kind: "string", value };
    if (typeof value === "boolean") return { kind: "boolean", value };
    if (typeof value === "number") {
      return /[.eE]/.test(name)
        ? { kind: "float", value }
        : { kind: "int", value };
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/** The primitive a literal type name belongs to, if it is a literal. */
export function literalBaseName(name: string): "String" | "Keyword" | "Bool" | "Int" | "Float" | undefined {
  const literal = parseLiteralTypeName(name);
  return literal ? literalBasePrimitive(literal) : undefined;
}

/** Whether a literal is assignable to a primitive type. */
export function isLiteralAssignableToPrimitive(literal: DataLiteral, primitive: string): boolean {
  switch (literal.kind) {
    case "string":
      return primitive === "String";
    case "keyword":
      return primitive === "Keyword";
    case "boolean":
      return primitive === "Bool";
    case "int":
      return (primitive === "Int" && Number.isSafeInteger(literal.value)) || primitive === "Float";
    case "float":
      return primitive === "Float";
  }
}

/** Whether one literal is assignable to another literal. */
export function isLiteralAssignableToLiteral(actual: DataLiteral, expected: DataLiteral): boolean {
  if (actual.kind === expected.kind) return actual.value === expected.value;
  return actual.kind === "int" && expected.kind === "float" && actual.value === expected.value;
}

/**
 * Decides assignability for the shared data-type fragment:
 * `Unknown`, `Never`, primitives, literals, nominal brands, and `Option`.
 *
 * Callers must resolve solver-specific variables, aliases, and unions before
 * calling this relation.
 */
export function decideDataRelation<Raw>(
  actual: DataNode<Raw>,
  expected: DataNode<Raw>,
): DataRelationDecision<Raw> {
  if (actual.kind === "unknown" || expected.kind === "unknown" || actual.kind === "never") {
    return { verdict: "accept" };
  }
  if (expected.kind === "never") {
    return actual.kind === "other" ? { verdict: "defer" } : { verdict: "reject" };
  }

  // Nominal brands: assignable to the same brand name, or to any supertype of their base type.
  if (expected.kind === "brand") {
    return actual.kind === "brand" && actual.name === expected.name
      ? { verdict: "accept" }
      : { verdict: "reject" };
  }
  if (actual.kind === "brand") {
    return { verdict: "check", actual: actual.base, expected: expected.raw };
  }

  // Covariant Option.
  if (expected.kind === "option") {
    return actual.kind === "option"
      ? { verdict: "check", actual: actual.item, expected: expected.item }
      : { verdict: "reject" };
  }
  if (actual.kind === "option") {
    return { verdict: "reject" };
  }

  // Primitives and literals.
  if (expected.kind === "prim") {
    if (actual.kind === "prim") {
      return isPrimitiveAssignable(actual.name, expected.name)
        ? { verdict: "accept" }
        : { verdict: "reject" };
    }
    if (actual.kind === "literal") {
      if (!isLiteralAssignableToPrimitive(actual.literal, expected.name)) {
        return { verdict: "reject" };
      }
      if (expected.refine) {
        const problem = checkLiteralRefinement(actual.literal, expected.refine);
        if (problem) {
          return {
            verdict: "refinement-error",
            literal: actual.literal,
            primitive: expected.name,
            refine: expected.refine,
            problem,
          };
        }
      }
      return { verdict: "accept" };
    }
    return { verdict: "reject" };
  }
  if (expected.kind === "literal") {
    if (actual.kind === "literal") {
      return isLiteralAssignableToLiteral(actual.literal, expected.literal)
        ? { verdict: "accept" }
        : { verdict: "reject" };
    }
    return { verdict: "reject" };
  }

  if (actual.kind === "prim" || actual.kind === "literal") {
    return { verdict: "reject" };
  }

  return { verdict: "defer" };
}

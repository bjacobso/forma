/**
 * ElaborationHook — the executable contract for compile-time meta functions.
 *
 * This is the Elaboration Layer: typed, phased, capability-constrained
 * functions that transform forms into canonical IR.
 *
 * Today: hooks are TypeScript functions.
 * Future: hooks can be __form-hook Lisp bodies executed by the kernel.
 */

import type { Effect } from "effect";
import type { Type } from "../type/types.js";
import type { Loc, SExpr } from "../reader/types.js";
import type { FormDescriptor } from "./FormDescriptor.js";

// =============================================================================
// Hook kinds
// =============================================================================

export type HookKind = "bindings" | "validate" | "construct" | "result-type";

// =============================================================================
// Hook input — what every hook receives
// =============================================================================

export interface HookInput {
  /** The name of the form being elaborated */
  readonly formName: string;
  /** The descriptor for this form */
  readonly descriptor: FormDescriptor;
  /** Normalized slot values extracted during structural recognition */
  readonly normalizedSlots: NormalizedSlots;
  /** Extracted identifiers */
  readonly identifiers: ReadonlyMap<string, string>;
  /** The semantic environment: declared names, bindings, and consumer-owned facts. */
  readonly semanticEnv: SemanticEnvironment;
  /** Source location */
  readonly loc: Loc;
  /** The raw SExpr (for advanced hooks that need full access) */
  readonly rawExpr: SExpr;
}

export interface NormalizedChildForm {
  readonly formName: string;
  readonly descriptor: FormDescriptor;
  readonly identifiers: ReadonlyMap<string, string>;
  readonly normalizedSlots: NormalizedSlots;
  readonly loc: Loc;
  readonly rawExpr: SExpr;
}

/** Normalized slot values after structural recognition */
export interface NormalizedSlots {
  /** Get a slot's string value */
  getString(name: string): string | undefined;
  /** Get a slot's string list value */
  getStringList(name: string): readonly string[];
  /** Get a slot's symbol value */
  getSymbol(name: string): string | undefined;
  /** Get a slot's expression (for expr-mode slots) */
  getExpr(name: string): SExpr | undefined;
  /** Get a slot's child forms (for form-mode slots) */
  getChildren(name: string): readonly SExpr[];
  /** Get normalized child forms for a slot when available */
  getChildForms(name: string): readonly NormalizedChildForm[];
  /** Check if a slot has a value */
  has(name: string): boolean;
}

export type SemanticFactValue =
  | Type
  | string
  | number
  | boolean
  | null
  | readonly string[]
  | ReadonlyMap<string, unknown>
  | ReadonlySet<string>;

export type ExpressionTypeResult =
  | { readonly _tag: "success"; readonly type: Type }
  | { readonly _tag: "failure"; readonly message: string };

/** Semantic environment accumulated during binding inference */
export interface SemanticEnvironment {
  /** Register a consumer-owned semantic fact. */
  setFact(kind: string, key: string, value: SemanticFactValue): void;
  /** Read a consumer-owned semantic fact. */
  getFact(kind: string, key: string): SemanticFactValue | undefined;
  /** Add a string value to a consumer-owned semantic fact set. */
  addFactSetValue(kind: string, key: string, value: string): void;
  /** Read a consumer-owned semantic fact set. */
  getFactSet(kind: string, key: string): readonly string[];
  /** Get all declared names */
  getDeclaredNames(): ReadonlyMap<string, DeclaredName>;
  /** Resolve a visible lexical binding type */
  getBindingType(name: string): Type | undefined;
  /** Snapshot all visible lexical bindings */
  getVisibleBindings(): ReadonlyMap<string, Type>;
  /** Infer a runtime expression and preserve any type/lowering failure. */
  inferExpression(expr: SExpr): ExpressionTypeResult;
  /** Infer the type of a runtime expression in the current visible scope */
  inferExpressionType(expr: SExpr): Type | undefined;
}

export interface DeclaredName {
  readonly name: string;
  readonly formName: string;
  readonly type?: Type;
}

// =============================================================================
// Hook output — typed per hook kind
// =============================================================================

export interface BindingMap {
  readonly entries: ReadonlyMap<string, Type>;
}

export interface Diagnostic {
  readonly severity: "error" | "warning" | "info";
  readonly code?: string;
  readonly message: string;
  readonly slot?: string;
  readonly loc?: Loc;
}

export type HookOutput =
  | { readonly kind: "bindings"; readonly bindings: BindingMap }
  | { readonly kind: "validate"; readonly diagnostics: readonly Diagnostic[] }
  | { readonly kind: "construct"; readonly ir: unknown }
  | { readonly kind: "result-type"; readonly type: Type };

// =============================================================================
// Hook errors
// =============================================================================

export class ElaborationError extends Error {
  readonly _tag = "ElaborationError" as const;
  readonly hookName: string;
  readonly phase: HookKind;

  constructor(opts: { message: string; hookName: string; phase: HookKind }) {
    super(opts.message);
    this.hookName = opts.hookName;
    this.phase = opts.phase;
  }
}

// =============================================================================
// ElaborationHook — the executable contract
// =============================================================================

export interface ElaborationHook {
  /** Unique name, e.g., "query/bindings", "entity/construct" */
  readonly name: string;
  /** Which phase this hook participates in */
  readonly kind: HookKind;
  /** Documentation */
  readonly doc?: string;

  // Type contract
  readonly inputType: string;
  readonly outputType: string;

  // Capability constraints
  readonly pure: boolean;
  readonly phase: "compile";

  /** Execute the hook */
  execute(input: HookInput): Effect.Effect<HookOutput, ElaborationError>;
}

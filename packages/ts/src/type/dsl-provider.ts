/**
 * DSL Type Provider
 *
 * An interface that the HM inferrer uses to query DSL handler metadata.
 * This bridges the gap between the kernel's type system and DSL handlers
 * like entity-type, action, query, etc.
 *
 * The lowerer uses the provider to know which form names to recognize
 * as DSL forms (producing CDSLForm nodes), and the inferrer uses it
 * to determine result types and type-check sub-expressions.
 */

import type { SExpr } from "../reader/index.js";
import type { Type, Scheme } from "./types.js";
import type { InferDiagnostic } from "./context.js";

// ---------------------------------------------------------------------------
// Slot info (subset of SlotDefinition relevant to type inference)
// ---------------------------------------------------------------------------

/** How a DSL form slot's value is processed. */
export type SlotMode = "immediate" | "deferred" | "quoted" | "pattern";

/**
 * Type-relevant information about a DSL form slot.
 */
export interface DSLSlotInfo {
  /** Slot name */
  readonly name: string;
  /** How the slot should be processed */
  readonly mode: SlotMode;
  /** Expected HM type for this slot (if declared) */
  readonly type?: Type | undefined;
  /** Whether this slot is required */
  readonly required?: boolean | undefined;
  /** Human-readable description */
  readonly description?: string | undefined;
}

// ---------------------------------------------------------------------------
// DSLTypeProvider interface
// ---------------------------------------------------------------------------

/**
 * Provides type information about DSL forms to the HM inferrer.
 *
 * This is the bridge between the DSL handler registry and the type system.
 * The lowerer uses `isKnownForm` to decide whether to produce a CDSLForm node.
 * The inferrer uses the other methods to type-check and infer types.
 */
export interface DSLTypeProvider {
  /** Bidirectional descriptor rule, in the caller's HM context. */
  typeApplication?(env: import("./substitution.js").TypeEnv, expr: import("./core-expr.js").CDSLForm, expected?: Type): import("effect").Effect.Effect<Type | undefined, import("./errors.js").InferenceError, import("./context.js").InferContext>;
  /** Helper definitions evaluated in the meta environment, rather than as program values. */
  isMetaDefinition?(name: string): boolean;
  readonly descriptorPrelude?: import("../descriptor/bootstrap.js").BootstrappedPrelude;

  /**
   * Check if a form name is a known DSL form.
   * Used by the lowerer to decide whether to produce CDSLForm vs CApp.
   */
  isKnownForm(name: string): boolean;

  /**
   * Get the slot definitions for a form.
   * Only slots with mode "immediate" or "deferred" are relevant for type checking.
   */
  getSlots(name: string): readonly DSLSlotInfo[];

  /**
   * Get the result type of a form.
   * Returns undefined if the form has no declared result type.
   */
  getResultType(name: string): Type | undefined;

  /**
   * Extract type bindings that a form introduces into the environment.
   *
   * The inferrer adds these bindings to the type environment so subsequent
   * expressions can reference them.
   *
   * @param name The form name
   * @param rawExpr The raw SExpr of the form (for extracting names, etc.)
   * @returns A map of variable name → type scheme to add to the type env
   */
  getTypeBindings(name: string, rawExpr: SExpr): ReadonlyMap<string, Scheme>;

  /**
   * Extract sub-expressions from a form that should be type-checked.
   *
   * Given a raw SExpr for a DSL form, walks the form's structure and
   * extracts sub-expressions that correspond to "immediate" or "deferred" slots.
   * Returns them as (slotName, SExpr, expectedType?) tuples.
   *
   * This is how the lowerer knows which parts of a DSL form to lower to CoreExpr.
   */
  extractTypedSlots(
    name: string,
    rawExpr: SExpr,
  ): readonly { slotName: string; expr: SExpr; expectedType?: Type }[];

  /**
   * Get the result type of a specific form instance.
   *
   * Unlike `getResultType` which returns a static type per form name, this
   * method can compute a dynamic result type based on the actual expression.
   * For example, `(datalog (find ?name ?age) ...)` can return
   * `List<{name: Str, age: Num}>` based on the find variables and inferred types.
   *
   * Returns undefined to fall back to `getResultType(name)`.
   *
   * @param name The form name
   * @param rawExpr The raw SExpr of the form
   * @returns A computed result type, or undefined to use the static fallback
   */
  getResultTypeForExpr?(name: string, rawExpr: SExpr): Type | undefined;

  /**
   * Validate a form instance and return non-fatal diagnostics.
   *
   * Called after type-checking children. Can inspect the raw SExpr to
   * validate content that the type system cannot check (e.g., CEL expression
   * strings inside string literals).
   *
   * Returns an empty array if no diagnostics.
   *
   * @param name The form name
   * @param rawExpr The raw SExpr of the form
   * @param env The current type environment (variable bindings)
   * @returns Non-fatal diagnostics to surface to the user
   */
  validateForm?(
    name: string,
    rawExpr: SExpr,
    env: ReadonlyMap<string, Scheme>,
  ): readonly InferDiagnostic[];
}

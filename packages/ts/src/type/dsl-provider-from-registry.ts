/**
 * Create a DSLTypeProvider from a DSLRegistry.
 *
 * This is the concrete bridge between the DSL handler framework (DSLRegistry)
 * and the HM type inference system (DSLTypeProvider). It maps handler slot
 * definitions to the type-level information that the inferrer needs.
 *
 * For simple cases (handler has resultType, slots with types), this provides
 * a generic implementation. For form-specific behavior (extracting entity names,
 * walking nested sub-expressions), consumers can extend the provider with
 * custom extractTypedSlots and getTypeBindings implementations.
 */

import type { SExpr } from "../reader/index.js";
import type { Type, Scheme } from "./types.js";
import type { DSLTypeProvider, DSLSlotInfo } from "./dsl-provider.js";
import type { DSLRegistry } from "../elaboration/registry.js";
import type { DSLHandler } from "../elaboration/types.js";

// ---------------------------------------------------------------------------
// Typed slot extraction strategies
// ---------------------------------------------------------------------------

/**
 * Custom extraction function for finding typed sub-expressions in a DSL form.
 * Returns the sub-expressions that should be type-checked by HM inference.
 */
export type TypedSlotExtractor = (
  handler: DSLHandler,
  rawExpr: SExpr,
) => readonly { slotName: string; expr: SExpr; expectedType?: Type }[];

/**
 * Custom function for extracting type bindings from a DSL form.
 * Returns variable names and their type schemes to add to the type environment.
 */
export type TypeBindingsExtractor = (
  handler: DSLHandler,
  rawExpr: SExpr,
) => ReadonlyMap<string, Scheme>;

/**
 * Custom function for computing a dynamic result type from a specific form instance.
 * Returns a type if the form can compute one from the expression, or undefined
 * to fall back to the handler's static `resultType`.
 */
export type ResultTypeForExprExtractor = (handler: DSLHandler, rawExpr: SExpr) => Type | undefined;

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface CreateDSLTypeProviderOptions {
  /**
   * Custom typed slot extractors per form name.
   * If not provided for a form, falls back to generic positional extraction.
   */
  readonly slotExtractors?: ReadonlyMap<string, TypedSlotExtractor>;

  /**
   * Custom type binding extractors per form name.
   * If not provided for a form, falls back to generic extraction (e.g.,
   * extracting the entity name from entity-type forms).
   */
  readonly bindingExtractors?: ReadonlyMap<string, TypeBindingsExtractor>;

  /**
   * Custom result type extractors per form name.
   * These compute dynamic result types based on the specific expression,
   * e.g., `(datalog (find ?name ?age) ...)` → `List<{name: Str, age: Num}>`.
   * If not provided or returns undefined, falls back to handler's static `resultType`.
   */
  readonly resultTypeExtractors?: ReadonlyMap<string, ResultTypeForExprExtractor>;
}

// ---------------------------------------------------------------------------
// Default extractors
// ---------------------------------------------------------------------------

/**
 * Default typed slot extractor: walks the form body looking for immediate/deferred
 * sub-expressions. Uses a simple heuristic: for each clause in the form body,
 * if the clause head matches a slot with mode "immediate" or "deferred" and the
 * slot has a type, extract the clause's value expression.
 */
function defaultExtractTypedSlots(
  handler: DSLHandler,
  rawExpr: SExpr,
): readonly { slotName: string; expr: SExpr; expectedType?: Type }[] {
  const results: { slotName: string; expr: SExpr; expectedType?: Type }[] = [];

  if (rawExpr._tag !== "List" || rawExpr.items.length < 2) {
    return results;
  }

  const typedSlots = handler.slots.filter(
    (slot) => (slot.mode === "immediate" || slot.mode === "deferred") && slot.type,
  );

  if (typedSlots.length === 0) {
    return results;
  }

  // First try clause-based extraction: (form (:slot value) ...)
  const slotMap = new Map<string, (typeof typedSlots)[number]>();
  for (const slot of typedSlots) {
    slotMap.set(slot.name, slot);
    slotMap.set(`:${slot.name}`, slot);
  }

  for (let i = 1; i < rawExpr.items.length; i++) {
    const item = rawExpr.items[i]!;

    if (item._tag === "List" && item.items.length >= 2) {
      const head = item.items[0];
      if (head?._tag === "Sym") {
        const slot = slotMap.get(head.name);
        if (slot && slot.type) {
          results.push({
            slotName: slot.name,
            expr: item.items[1]!,
            expectedType: slot.type,
          });
        }
      }
    }
  }

  if (results.length > 0) {
    return results;
  }

  // Fall back to positional extraction: (form arg1 arg2 ...)
  for (let i = 0; i < typedSlots.length; i++) {
    const expr = rawExpr.items[i + 1];
    const slot = typedSlots[i];
    if (!expr || !slot?.type) {
      continue;
    }
    results.push({
      slotName: slot.name,
      expr,
      expectedType: slot.type,
    });
  }

  return results;
}

/**
 * Default type bindings extractor: returns no bindings.
 *
 * Consumers should provide custom binding extractors for forms that
 * introduce new names into the type environment (e.g., entity-type forms
 * that register new entity type names).
 */
function defaultExtractTypeBindings(
  _handler: DSLHandler,
  _rawExpr: SExpr,
): ReadonlyMap<string, Scheme> {
  return new Map();
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a DSLTypeProvider from a DSLRegistry.
 *
 * This maps handler slot definitions to the type-level information that
 * the HM inferrer needs. Custom extractors can be provided for form-specific
 * behavior.
 *
 * @example
 * ```typescript
 * import { createDSLTypeProviderFromRegistry, DSLRegistry } from "@formalang/ts";
 *
 * const registry = DSLRegistry.from(myHandler1, myHandler2);
 * const provider = createDSLTypeProviderFromRegistry(registry);
 * const lspResult = await Effect.runPromise(analyzeLsp(source, { dslProvider: provider }));
 * ```
 */
export function createDSLTypeProviderFromRegistry(
  registry: DSLRegistry,
  options?: CreateDSLTypeProviderOptions,
): DSLTypeProvider {
  const slotExtractors = options?.slotExtractors ?? new Map();
  const bindingExtractors = options?.bindingExtractors ?? new Map();
  const resultTypeExtractors = options?.resultTypeExtractors ?? new Map();

  return {
    isKnownForm(name: string): boolean {
      return registry.has(name);
    },

    getSlots(name: string): readonly DSLSlotInfo[] {
      const handler = registry.get(name);
      if (!handler) return [];
      return handler.slots.map((slot) => ({
        name: slot.name,
        mode: slot.mode,
        type: slot.type,
        required: slot.required,
        description: slot.description,
      }));
    },

    getResultType(name: string): Type | undefined {
      return registry.get(name)?.resultType;
    },

    getTypeBindings(name: string, rawExpr: SExpr): ReadonlyMap<string, Scheme> {
      const handler = registry.get(name);
      if (!handler) return new Map();

      if (handler.getTypeBindings) {
        return handler.getTypeBindings(rawExpr);
      }

      const customExtractor = bindingExtractors.get(name);
      if (customExtractor) {
        return customExtractor(handler, rawExpr);
      }

      return defaultExtractTypeBindings(handler, rawExpr);
    },

    extractTypedSlots(
      name: string,
      rawExpr: SExpr,
    ): readonly { slotName: string; expr: SExpr; expectedType?: Type }[] {
      const handler = registry.get(name);
      if (!handler) return [];

      if (handler.extractTypedSlots) {
        return handler.extractTypedSlots(rawExpr);
      }

      const customExtractor = slotExtractors.get(name);
      if (customExtractor) {
        return customExtractor(handler, rawExpr);
      }

      return defaultExtractTypedSlots(handler, rawExpr);
    },

    getResultTypeForExpr(name: string, rawExpr: SExpr): Type | undefined {
      const handler = registry.get(name);
      if (!handler) return undefined;

      if (handler.getResultTypeForExpr) {
        return handler.getResultTypeForExpr(rawExpr);
      }

      const customExtractor = resultTypeExtractors.get(name);
      if (customExtractor) {
        return customExtractor(handler, rawExpr);
      }

      // No custom extractor — fall back to undefined (caller uses getResultType)
      return undefined;
    },
  };
}

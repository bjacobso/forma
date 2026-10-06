import type { UnifiedForm } from "../surface/form.js";
/**
 * FormDescriptor — the declarative description of a language construct.
 *
 * This is the Description Layer: pure data, agent-readable, independently
 * queryable. No executable logic lives here. Executable behavior is referenced
 * by name and implemented in the Elaboration Layer.
 *
 * Every strategy field (bindings, validation, elaboration, resultType) has
 * two variants:
 * - "static": declarative rules interpreted by the generic pipeline
 * - "hook": a named reference to an ElaborationHook
 *
 * Simple forms use static strategies. Complex forms reference hooks.
 * Validation may combine static checks with a hook when both are authored.
 */

// =============================================================================
// Core descriptor
// =============================================================================

export interface FormDescriptor {
  readonly surface?: UnifiedForm;
  // --- Identity ---
  readonly name: string;
  readonly phase: "meta" | "domain";

  // --- Documentation (pure data, agent-readable) ---
  readonly doc?: string;
  readonly examples?: readonly string[];
  readonly commonErrors?: readonly string[];

  // --- Syntax (pure data) ---
  readonly identifiers: readonly IdentifierSpec[];
  readonly slots: readonly SlotSpec[];

  // --- Semantics (static rules OR hook references) ---
  readonly bindings: BindingStrategy;
  readonly validation: ValidationStrategy;
  readonly elaboration: ElaborationStrategy;
  readonly resultType: ResultTypeStrategy;
  readonly declarationType?: DeclarationTypeStrategy;
  readonly inferHook?: string;
  readonly checkHook?: string;
  readonly constructedBy?: ParentConstructSpec;
  readonly construct?: ConstructSpec;
  readonly produces?: string; // canonical IR type name

  // --- Editor/tooling (pure data) ---
  readonly completionShape?: string;
  readonly formatStyle?: string;

  // --- Extensible metadata (pure data) ---
  readonly extensions?: DescriptorExtensions;
}

// =============================================================================
// Identifier and slot specs
// =============================================================================

export interface IdentifierSpec {
  readonly name: string;
  readonly kind: "Symbol" | "String" | "Value";
  readonly declaration?: boolean;
  readonly doc?: string;
}

export type SlotMode = "value" | "expr" | "form";

export interface SlotSpec {
  readonly name: string;
  readonly mode: SlotMode;
  readonly required?: boolean;
  readonly many?: boolean;
  readonly type?: string;
  readonly typeFrom?: string;
  readonly aliases?: readonly string[];
  readonly childShape?: ChildFormShape;
  readonly doc?: string;
}

export interface ChildFormShape {
  readonly formName: string;
  readonly identifiers: readonly IdentifierSpec[];
  readonly slots: readonly SlotSpec[];
  readonly positionalSlots?: readonly string[];
}

export type DescriptorExtensionValue =
  | string
  | number
  | boolean
  | null
  | readonly DescriptorExtensionValue[]
  | { readonly [key: string]: DescriptorExtensionValue };

export type DescriptorExtensions = Readonly<Record<string, DescriptorExtensionValue>>;

// =============================================================================
// Strategy types — declarative rules OR hook references
// =============================================================================

// --- Bindings ---

export interface BindingRule {
  readonly kind: "declaration" | "slot-declaration" | "slot-declaration-result";
  readonly identifier?: string;
  readonly slot?: string;
  readonly as?: string;
  readonly type?: string;
}

export type BindingStrategy =
  | { readonly kind: "static"; readonly rules: readonly BindingRule[] }
  | { readonly kind: "hook"; readonly fn: string }
  | { readonly kind: "composite"; readonly rules: readonly BindingRule[]; readonly fn: string }
  | { readonly kind: "none" };

// --- Validation ---

export interface ValidationCheck {
  readonly kind: "one-of" | "membership" | "default-in-list" | "required";
  readonly slot?: string;
  readonly values?: readonly string[];
  readonly collection?: string;
  readonly defaultSlot?: string;
  readonly listSlot?: string;
}

export type ValidationStrategy =
  | { readonly kind: "static"; readonly checks: readonly ValidationCheck[] }
  | { readonly kind: "hook"; readonly fn: string }
  | { readonly kind: "composite"; readonly checks: readonly ValidationCheck[]; readonly fn: string }
  | { readonly kind: "none" };

// --- Elaboration ---

export interface ElaborationOpcode {
  readonly kind:
    | "literal-string"
    | "literal-bool"
    | "literal-string-list"
    | "resolve-value-ref"
    | "resolve-slot-declaration-result"
    | "children"
    | "collect";
  readonly slot?: string;
  readonly form?: string;
  readonly target?: string;
  readonly declarationKind?: string;
  readonly bindingName?: string;
}

export type ElaborationStrategy =
  | { readonly kind: "static"; readonly opcodes: readonly ElaborationOpcode[] }
  | { readonly kind: "hook"; readonly fn: string }
  | {
      readonly kind: "composite";
      readonly opcodes: readonly ElaborationOpcode[];
      readonly fn: string;
    }
  | { readonly kind: "none" };

// --- Result type ---

export type ResultTypeStrategy =
  | { readonly kind: "constant"; readonly type: string }
  | { readonly kind: "slot-type"; readonly slot: string }
  | { readonly kind: "declaration-result"; readonly slot: string }
  | { readonly kind: "declaration-ref-result"; readonly slot: string }
  | { readonly kind: "hook"; readonly fn: string }
  | { readonly kind: "none" };

export type DeclarationTypeStrategy =
  | { readonly kind: "constant"; readonly type: string }
  | { readonly kind: "row" };

export interface ParentConstructSpec {
  readonly elaboration: string;
  readonly child?: string;
}

// =============================================================================
// Construct spec (static IR template)
// =============================================================================

export interface ConstructField {
  readonly name: string;
  readonly expr: string; // e.g., "(slot-string description)", "(or declaration-name ...)"
  readonly optional?: boolean;
}

export interface ConstructSpec {
  readonly fields: readonly ConstructField[];
}

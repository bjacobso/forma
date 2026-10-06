/**
 * FormDescriptorRegistry — queryable registry of form descriptions.
 *
 * This registry holds FormDescriptors and is independently queryable
 * without triggering any compilation or elaboration. Agents, editors,
 * and tooling can consume this to understand the language surface.
 */

import type { FormDescriptor, SlotSpec, IdentifierSpec } from "./FormDescriptor.js";

export class FormDescriptorRegistry {
  private readonly descriptors = new Map<string, FormDescriptor>();
  private readonly aliases = new Map<string, string>();

  fork(): FormDescriptorRegistry {
    const child = new FormDescriptorRegistry();
    for (const [name, descriptor] of this.descriptors) child.descriptors.set(name,descriptor);
    for (const [name, target] of this.aliases) child.aliases.set(name,target);
    return child;
  }

  register(desc: FormDescriptor): void {
    this.descriptors.set(desc.name, desc);
  }

  /** Register an alias name that resolves to an existing form descriptor */
  alias(aliasName: string, targetName: string): void {
    this.aliases.set(aliasName, targetName);
  }

  get(name: string): FormDescriptor | undefined {
    return this.descriptors.get(name) ?? this.descriptors.get(this.aliases.get(name) ?? "");
  }

  has(name: string): boolean {
    return this.descriptors.has(this.aliases.get(name) ?? "") || this.descriptors.has(name);
  }

  list(): readonly FormDescriptor[] {
    return [...this.descriptors.values()];
  }

  names(): readonly string[] {
    return [...this.descriptors.keys()];
  }

  // --- Agent/tooling queries ---

  getDoc(name: string): string | undefined {
    return this.descriptors.get(name)?.doc;
  }

  getSlots(name: string): readonly SlotSpec[] {
    return this.descriptors.get(name)?.slots ?? [];
  }

  getIdentifiers(name: string): readonly IdentifierSpec[] {
    return this.descriptors.get(name)?.identifiers ?? [];
  }

  getExamples(name: string): readonly string[] {
    return this.descriptors.get(name)?.examples ?? [];
  }

  getProducesIR(name: string): string | undefined {
    return this.descriptors.get(name)?.produces;
  }

  getHookNames(name: string): readonly string[] {
    const desc = this.descriptors.get(name);
    if (!desc) return [];
    const hooks: string[] = [];
    if (desc.bindings.kind === "hook" || desc.bindings.kind === "composite") {
      hooks.push(desc.bindings.fn);
    }
    if (desc.validation.kind === "hook" || desc.validation.kind === "composite") {
      hooks.push(desc.validation.fn);
    }
    if (desc.elaboration.kind === "hook" || desc.elaboration.kind === "composite") {
      hooks.push(desc.elaboration.fn);
    }
    if (desc.resultType.kind === "hook") hooks.push(desc.resultType.fn);
    return hooks;
  }

  /** List all forms that declare names (have an identifier with declaration: true) */
  getDeclaringForms(): readonly FormDescriptor[] {
    return this.list().filter((d) => d.identifiers.some((id) => id.declaration));
  }

  /** List all forms in a given phase */
  getFormsByPhase(phase: "meta" | "domain"): readonly FormDescriptor[] {
    return this.list().filter((d) => d.phase === phase);
  }
}

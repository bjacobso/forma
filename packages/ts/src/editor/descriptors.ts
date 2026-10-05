import type { FormDescriptor } from "../descriptor/FormDescriptor.js";
import { FormDescriptorRegistry } from "../descriptor/FormDescriptorRegistry.js";
import { parseFormDescriptorForms } from "../descriptor/parse-descriptor.js";
import { parse, toSExprMany } from "../reader/index.js";

/** Descriptors to use for editor services, from a registry or a list. */
export type DescriptorSource = FormDescriptorRegistry | readonly FormDescriptor[];

/** Finds the descriptor for a form head. */
export interface DescriptorLookup {
  get(name: string): FormDescriptor | undefined;
}

/**
 * Descriptors from every `define-form` and `define-protocol` form found in
 * `sources`, falling back to the given descriptors. Malformed declarations
 * are skipped: editor services must keep working while a prelude is being
 * written.
 */
export function editorDescriptors(
  sources: readonly string[],
  descriptors: DescriptorSource = [],
): DescriptorLookup {
  const found = new FormDescriptorRegistry();
  for (const source of sources) {
    for (const expr of toSExprMany(parse(source).redTree)) {
      try {
        for (const descriptor of parseFormDescriptorForms(expr)) found.register(descriptor);
      } catch {
        // An incomplete declaration contributes nothing.
      }
    }
  }
  const given =
    descriptors instanceof FormDescriptorRegistry
      ? descriptors
      : new Map(descriptors.map((descriptor) => [descriptor.name, descriptor] as const));
  return { get: (name) => found.get(name) ?? given.get(name) };
}

import { typeDefinition } from "../surface/type-alias.js";
import { parseUnifiedForm } from "../surface/form.js";
import type { FormDescriptor } from "../descriptor/FormDescriptor.js";
import { FormDescriptorRegistry } from "../descriptor/FormDescriptorRegistry.js";
import { parseFormDescriptorForms } from "../descriptor/parse-descriptor.js";
import { parse, toSExprMany, type SExpr } from "../reader/index.js";

/** Descriptors to use for editor services, from a registry or a list. */
export type DescriptorSource = FormDescriptorRegistry | readonly FormDescriptor[];

/** Finds the descriptor for a form head. */
export interface DescriptorLookup {
  get(name: string): FormDescriptor | undefined;
}

/**
 * Descriptors derived from `form` declarations and their types found in
 * `sources`, falling back to the given descriptors. Malformed declarations
 * are skipped: editor services must keep working while a prelude is being
 * written.
 */
export function editorDescriptors(
  sources: readonly string[],
  descriptors: DescriptorSource = [],
): DescriptorLookup {
  return descriptorsFromExpressions(
    sources.flatMap((source) => toSExprMany(parse(source).redTree)),
    descriptors,
  );
}

/** `editorDescriptors` over sources that are already read. */
export function descriptorsFromExpressions(
  expressions: readonly SExpr[],
  descriptors: DescriptorSource = [],
): DescriptorLookup {
  const found = new FormDescriptorRegistry();
  const types = new Map(expressions.flatMap(expr => { const definition = typeDefinition(expr); return definition ? [definition] : []; }));
  for (const expr of expressions) {
      try {
        const unified = parseUnifiedForm(expr, types);
        if (unified) found.register(unified);
        else for (const descriptor of parseFormDescriptorForms(expr)) found.register(descriptor);
      } catch {
        // An incomplete declaration contributes nothing.
      }
  }
  const given =
    descriptors instanceof FormDescriptorRegistry
      ? descriptors
      : new Map(descriptors.map((descriptor) => [descriptor.name, descriptor] as const));
  return { get: (name) => found.get(name) ?? given.get(name) };
}

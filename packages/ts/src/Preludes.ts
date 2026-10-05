/**
 * The Lisp preludes that ship with Forma, embedded as source strings.
 *
 * `kernel.lisp` supplies general-purpose macros, `compiler.lisp` defines the
 * descriptor vocabulary, and the remaining files form an example domain stack
 * (ontology, views, and protocol descriptors). Hosts may bootstrap any subset
 * or supply their own preludes instead.
 *
 * @module Preludes
 */

import {
  bootstrapFromSources,
  type BootstrapOptions,
  type BootstrappedPrelude,
} from "./descriptor/bootstrap.js";
import { preludeSources } from "./preludes/sources.generated.js";

export { preludeSources };

/** File name of a prelude bundled with Forma, e.g. `"ontology.lisp"`. */
export type PreludeName = keyof typeof preludeSources;

/** Every bundled prelude name, in lexical order. */
export const preludeNames = Object.keys(preludeSources) as readonly PreludeName[];

/** Read a bundled prelude's source text. */
export const preludeSource = (name: PreludeName): string => preludeSources[name];

/**
 * The descriptor and elaboration preludes for the ontology DSL, in bootstrap
 * order: compiler vocabulary, domain forms, then construct hooks.
 */
export const ontologyPreludeStack = [
  "compiler.lisp",
  "ontology.lisp",
  "ontology-compiler.lisp",
  "viewspec-compiler.lisp",
] as const satisfies readonly PreludeName[];

/**
 * Bootstrap descriptors and elaboration hooks from bundled preludes. The first
 * name supplies the compiler vocabulary and the second the domain forms.
 * Each call returns fresh registries, so callers may extend them freely.
 */
export function bootstrapPreludes(
  names: readonly PreludeName[],
  options: BootstrapOptions = {},
): BootstrappedPrelude {
  const [compiler, domain, ...additional] = names.map(preludeSource);
  if (compiler === undefined || domain === undefined) {
    throw new TypeError("bootstrapPreludes needs a compiler prelude and a domain prelude");
  }
  return bootstrapFromSources(compiler, domain, ...additional, options);
}

/** Bootstrap the bundled ontology DSL (`define-entity`, `define-action`, ...). */
export const bootstrapOntologyPreludes = (options: BootstrapOptions = {}): BootstrappedPrelude =>
  bootstrapPreludes(ontologyPreludeStack, options);

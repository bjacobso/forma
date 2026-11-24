/**
 * Macro expansion with provenance tracking.
 *
 * @module Expander
 */

export { expandMacroOnce, expandProgramSync, getPreludeEnvSync, withExpansionBudget } from "./expander/expand.js";
export type { ExpandOnceResult, ExpansionBudget } from "./expander/expand.js";
export { PreludeEnv, PRELUDE_SOURCE } from "./expander/prelude.js";

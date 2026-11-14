/**
 * Macro expansion with provenance tracking.
 *
 * @module Expander
 */

export { expandMacroOnce, expandProgramSync, getPreludeEnvSync } from "./expander/expand.js";
export type { ExpandOnceResult } from "./expander/expand.js";
export { PreludeEnv, PRELUDE_SOURCE } from "./expander/prelude.js";

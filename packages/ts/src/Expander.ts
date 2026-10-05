/**
 * Macro expansion with provenance tracking.
 *
 * @module Expander
 */

export { expandProgramSync, getPreludeEnvSync } from "./expander/expand.js";
export { PreludeEnv, PRELUDE_SOURCE } from "./expander/prelude.js";
export {
  originOf,
  type MacroOrigin,
  type Origin,
  type OriginRole,
} from "./expander/provenance.js";

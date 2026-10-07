/**
 * Mechanics artifact projection and hosted operation runtime.
 *
 * @module Mechanics
 */

export {
  isMechanicsArtifactForm,
  mechanicsPackageableDeclarations,
  type MechanicsArtifactDiagnostic,
  type MechanicsArtifactResult,
} from "./mechanics/artifact.js";

export {
  checkMechanicsDeclarations,
  type CheckInfo as MechanicsCheckInfo,
  type MechanicsCheckDiagnostic,
  type MechanicsCheckResult,
  type MechanicsSourceSpan,
} from "./mechanics/check.js";

export {
  elaborateEffectProgram,
  generateEffectProgram,
  type EffectProgramDiagnostic,
  type EffectProgramElaboration,
  type EffectProgramOptions,
  type EffectProgramSpan,
  type EffectProgramTypeScript,
} from "./mechanics/elaborate.js";

export {
  generateMechanicsEffectSchemaModule,
  type MechanicsEffectSchemaModule,
} from "./mechanics/effect-schema.js";

export {
  generateMechanicsEffectTypeScriptModule,
  type MechanicsEffectTypeScriptModule,
  type MechanicsEffectTypeScriptOptions,
} from "./mechanics/effect-typescript.js";

export {
  makeMechanicsRuntime,
  MechanicsRuntimeError,
  type MechanicsRuntime,
  type MechanicsRuntimeOptions,
  type MechanicsRuntimeValue,
  type MechanicsServiceImplementation,
  type MechanicsServiceMethod,
} from "./mechanics/runtime.js";

/** Display a mechanics checker type in Forma notation. */
export { showType as showMechanicsType, type MType as MechanicsType } from "./mechanics/types.js";

/**
 * Mechanics artifact projection and hosted operation runtime.
 *
 * @module Mechanics
 */

import type { PackageableDeclaration } from "./artifact/artifact.js";
import { checkMechanicsProgram } from "./mechanics/checked.js";
import {
  generateMechanicsEffectTypeScriptModule as generateMechanicsEffectTypeScriptModuleChecked,
  type MechanicsEffectTypeScriptModule,
  type MechanicsEffectTypeScriptOptions,
} from "./mechanics/effect-typescript.js";

export {
  effectCombinators,
  effectCoreFormNames,
  isMechanicsArtifactForm,
  mechanicsPackageableDeclarations,
  type MechanicsArtifactDiagnostic,
  type MechanicsArtifactResult,
} from "./mechanics/artifact.js";

export {
  createCheckedEffectInfo,
  toCheckedEffectProgram,
  type CheckedEffectDiagnostic,
  type CheckedEffectInfo,
  type CheckedEffectProgram,
  type CheckedEffectSourceSpan,
} from "./mechanics/checked-contract.js";

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
  generateCheckedEffectSchemaModule,
  generateMechanicsEffectSchemaModule,
  type MechanicsEffectSchemaModule,
} from "./mechanics/effect-schema.js";

export { expandEffectDeclarations, expandEffectLibrary, type EffectLibraryExpansion } from "./mechanics/effect-library.js";

export { generateTypeSchemas, type TypeSchemaBuild } from "./mechanics/schema-build.js";

export {
  generateCheckedEffectTypeScriptModule,
  type MechanicsEffectTypeScriptModule,
  type MechanicsEffectTypeScriptOptions,
} from "./mechanics/effect-typescript.js";

export function generateMechanicsEffectTypeScriptModule(
  declarations: readonly PackageableDeclaration[],
  options: MechanicsEffectTypeScriptOptions = {},
): MechanicsEffectTypeScriptModule {
  const check = options.check ?? checkMechanicsProgram(declarations).check;
  return generateMechanicsEffectTypeScriptModuleChecked(declarations, { ...options, check });
}

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

export { checkMechanicsProgram, type CheckedMechanicsDeclarations, type MechanicsTypedSpan } from "./mechanics/checked.js";

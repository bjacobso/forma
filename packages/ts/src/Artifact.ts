/**
 * Validated artifact packaging for engine-owned declaration payloads.
 *
 * @module Artifact
 */

export {
  packageArtifact,
  packageArtifactJson,
  validatePackageableDeclarations,
  type ArtifactPackage,
  type ArtifactResult,
  type ArtifactSourceSummary,
  type DeclarationOrigin,
  type DeclarationSummary,
  type JsonValue,
  type PackageableDeclaration,
  type PackageArtifactOptions,
  type PackagedDeclaration,
  type SourceMapEntry,
} from "./artifact/artifact.js";
export {
  isMechanicsArtifactForm,
  mechanicsPackageableDeclarations,
  type MechanicsArtifactDiagnostic,
  type MechanicsArtifactResult,
} from "./mechanics/artifact.js";
export {
  generateMechanicsEffectSchemaModule,
  type MechanicsEffectSchemaModule,
} from "./mechanics/effect-schema.js";
export {
  generateMechanicsEffectTypeScriptModule,
  type MechanicsEffectTypeScriptModule,
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

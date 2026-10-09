/**
 * Validated artifact packaging for engine-owned declaration payloads.
 *
 * @module Artifact
 */

export {
  packageArtifact,
  validateDeclarations,
  canonicalPayload,
  type ValidatedDeclaration,
  type DeclarationValidationResult,
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

export { ArtifactValidatorRegistry, type ArtifactValidator, type PayloadValidator, type ValidatorInput } from "./artifact/validator-registry.js";
export { makeArtifactValidatorRegistry } from "./artifact/validator-catalog.js";
export { checkArtifactDescriptor, checkArtifactPayloadContracts, descriptorPayloadContract, descriptorValidatorNames, resolvePayloadContract, payloadContractsFromSources, type PayloadContract, type PayloadContracts } from "./artifact/descriptor-contracts.js";
export { domainPayloadSchemas } from "./artifact/domain-payloads.js";
export { canonicalJson, sha256 } from "./artifact/canonical-json.js";

export { emit, emitMany, emitBackends, artifactSummary, canonicalIrProjection, type EmitRequest, type EmitResult, type EmittedArtifact } from "./artifact/emit.js";

export type { ArtifactModule } from "./artifact/modules.js";

export {
  buildDefinitionIndexFromModuleGraph,
  buildDefinitionIndexFromSources,
  buildDefinitionIndexFromWorkspace,
  createDefinitionIndex,
} from "./store/index-builder.js";

export type {
  BuildDefinitionIndexOptions,
  DefinitionIndexSource,
} from "./store/index-builder.js";

export {
  findDependencies,
  findDependents,
  getDefinition,
  queryByCapability,
  queryByError,
  resolveDefinitionHash,
  resolveDefinitionHashes,
} from "./store/queries.js";

export type {
  DefHash,
  DefinitionDetails,
  DefinitionIndex,
  DefinitionRecord,
  EvidenceKind,
  EvidenceLookup,
  EvidenceSummary,
  FindDependenciesOptions,
  FindDependentsOptions,
  GetDefinitionOptions,
  OpaqueBoundaryRef,
  PresentationMeta,
  SccHash,
  SccMembership,
  StoreDefinitionKind,
} from "./store/queries.js";

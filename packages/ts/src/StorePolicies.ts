export * from "./store/tx-types.js";

export {
  capabilityAllowed,
  evaluateBranchPolicies,
  hashBranchPolicy,
  hashBranchPolicy as hashPolicyConfig,
  isRequirementDefinition,
  matchesNamespace,
  namespaceOfQualifiedName,
  type PolicySnapshotView,
} from "./store/policies.js";

export {
  InMemorySnapshotBackend,
  TransactionalStore,
  buildIndexFromSnapshot,
  computeSnapshotHash,
  deserializeSnapshot,
  diffSnapshots,
  isSameInterface,
  makeQualifiedName,
  serializeSnapshot,
  splitQualifiedName,
  type CreateBranchOptions,
  type DefinitionLookup,
  type TransactionalStoreOptions,
} from "./store/transactions.js";

export {
  classifyOperationClass,
  exportSnapshotToSources,
  importSourcesAsTransaction,
  type ExportSnapshotOptions,
  type ImportSourcesOptions,
  type ProjectedModuleSource,
  type ProjectionSnapshot,
} from "./store/projection.js";

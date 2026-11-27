/**
 * Shared types for RFC 0029 Stages 2–3: immutable snapshots, mutable branch
 * pointers, transactional updates, optimistic CAS concurrency, and enforceable
 * branch policies.
 *
 * Browser-safe: contains no Node-only imports.
 */

import type {
  DefHash,
  DefinitionIndex,
  DefinitionRecord,
  EvidenceKind,
  EvidenceRecord,
  EvidenceSummary,
  PresentationMeta,
  StoreDefinitionKind,
} from "./types.js";

export const SNAPSHOT_HASH_VERSION = "snap:v1" as const;
export const POLICY_HASH_VERSION = "policy:v1" as const;

/** Tagged SHA-256 content hash of an immutable snapshot (`snap:v1:<hex>`). */
export type SnapshotHash = string;

/** Tagged SHA-256 content hash of a branch policy configuration (`policy:v1:<hex>`). */
export type PolicySetHash = string;

/** Qualified definition name in a snapshot namespace (e.g. `moduleId::name`). */
export type QualifiedName = string;

/** Separates implementation edits from test/contract/law requirement edits (RFC 0029 §5). */
export type OperationClass = "impl-edit" | "requirement-edit";

// ---------------------------------------------------------------------------
// Branch policies (RFC 0029 §6)
// ---------------------------------------------------------------------------

export interface DependencyBoundaryRule {
  /** Source namespace or module prefix (e.g. `"domain"` or `"app/domain"`). */
  readonly from: string;
  /** Explicitly permitted target namespaces/modules (when set, other cross-namespace edges are forbidden). */
  readonly allow?: readonly string[] | undefined;
  /** Explicitly forbidden target namespaces/modules. */
  readonly deny?: readonly string[] | undefined;
}

export interface CapabilityBudgetRule {
  /** Target namespace or module prefix. */
  readonly namespace: string;
  /** Maximum allowed Effect requirement names/prefixes (empty = pure namespace). */
  readonly maxRequirements: readonly string[];
}

export interface RequirementEditPolicy {
  /** Require `operationClass === "requirement-edit"` for test/contract/law changes. Defaults to `true`. */
  readonly requireExplicitClass?: boolean | undefined;
  /** Require explicit approval (`proposal.approvedRequirementEdit === true`) for `requirement-edit` transactions. */
  readonly requireApproval?: boolean | undefined;
}

export interface EvidenceGatePolicy {
  /** Evidence kinds required before commit (e.g. `["typecheck", "test"]`). */
  readonly requiredKinds: readonly EvidenceKind[];
  /** Reject `verification` evidence whose result is `"inconclusive"`. Defaults to `true`. */
  readonly rejectInconclusiveVerification?: boolean | undefined;
  /** Require deterministic `test` evidence for affected tests. */
  readonly requireDeterministicTests?: boolean | undefined;
}

export interface EvolutionPolicy {
  /** Published namespaces/modules subject to add-only or backward-compatible evolution rules. */
  readonly publishedNamespaces: readonly string[];
  /** Evolution constraint mode on published namespaces. */
  readonly mode: "add-only" | "backward-compatible";
}

/** Enforceable project policy configuration stored in each snapshot. */
export interface BranchPolicy {
  /** Protected branches reject interface-changing updates unless all dependents are updated in the same transaction. */
  readonly protected?: boolean | undefined;
  readonly dependencyBoundaries?: readonly DependencyBoundaryRule[] | undefined;
  readonly capabilityBudgets?: readonly CapabilityBudgetRule[] | undefined;
  readonly requirementEdit?: RequirementEditPolicy | undefined;
  readonly evidenceGates?: EvidenceGatePolicy | undefined;
  readonly evolution?: EvolutionPolicy | undefined;
}

// ---------------------------------------------------------------------------
// Immutable snapshots & mutable branch pointers (RFC 0029 §2)
// ---------------------------------------------------------------------------

/** Immutable content-addressed namespace snapshot. */
export interface Snapshot {
  readonly hash: SnapshotHash;
  readonly parent: SnapshotHash | null;
  readonly bindings: ReadonlyMap<QualifiedName, DefHash>;
  readonly metadata: ReadonlyMap<DefHash, PresentationMeta>;
  readonly policies: PolicySetHash;
  readonly policyConfig: BranchPolicy;
  readonly languageProfile: string;
  readonly createdAt?: string | undefined;
  readonly message?: string | undefined;
}

/** Mutable branch pointer referencing an immutable snapshot head. */
export interface BranchRef {
  readonly name: string;
  readonly head: SnapshotHash;
  readonly updatedAt?: string | undefined;
}

/** JSON-serializable snapshot representation for persistence and Host ABI/MCP. */
export interface SerializedSnapshot {
  readonly hash: SnapshotHash;
  readonly parent: SnapshotHash | null;
  readonly bindings: Readonly<Record<QualifiedName, DefHash>>;
  readonly metadata: Readonly<Record<DefHash, PresentationMeta>>;
  readonly policies: PolicySetHash;
  readonly policyConfig: BranchPolicy;
  readonly languageProfile: string;
  readonly createdAt?: string | undefined;
  readonly message?: string | undefined;
}

// ---------------------------------------------------------------------------
// Transactions & operations (RFC 0029 §4–§5)
// ---------------------------------------------------------------------------

export interface AddOp {
  readonly kind: "add";
  readonly qualifiedName: QualifiedName;
  /** Authored Forma source for the definition (optional if `record` is provided directly). */
  readonly source?: string | undefined;
  /** Pre-built definition record (optional alternative to `source`). */
  readonly record?: DefinitionRecord | undefined;
  /** Optional presentation metadata overrides. */
  readonly meta?: Partial<PresentationMeta> | undefined;
}

export interface UpdateOp {
  readonly kind: "update";
  readonly qualifiedName: QualifiedName;
  /** Authored Forma source for the updated definition (optional if `record` is provided directly). */
  readonly source?: string | undefined;
  /** Pre-built definition record (optional alternative to `source`). */
  readonly record?: DefinitionRecord | undefined;
  /** Optional presentation metadata overrides. */
  readonly meta?: Partial<PresentationMeta> | undefined;
}

export interface RenameOp {
  readonly kind: "rename";
  readonly from: QualifiedName;
  readonly to: QualifiedName;
  /** Optional updated display name (defaults to local name of `to`). */
  readonly displayName?: string | undefined;
}

export interface RemoveOp {
  readonly kind: "remove";
  readonly qualifiedName: QualifiedName;
}

export interface MoveOp {
  readonly kind: "move";
  readonly from: QualifiedName;
  readonly toModuleId: string;
  /** Optional new local name (defaults to existing local name). */
  readonly newName?: string | undefined;
}

export type TransactionOp = AddOp | UpdateOp | RenameOp | RemoveOp | MoveOp;

export type InterfaceChangeMode = "reject" | "staging-branch" | "add-only";

/** Structured write proposal submitted against a `baseSnapshot`. */
export interface TransactionProposal {
  readonly branch: string;
  readonly baseSnapshot: SnapshotHash;
  readonly operationClass: OperationClass;
  readonly operations: readonly TransactionOp[];
  readonly message?: string | undefined;
  readonly author?: string | undefined;
  /**
   * Behavior when an interface-changing update leaves dependents un-updated:
   * - `"reject"` (default): reject with exact affected dependent hashes/names.
   * - `"staging-branch"`: commit to a staging branch instead of mutating the protected branch.
   * - `"add-only"`: preserve the existing binding and add the new version under a coexisting name.
   */
  readonly onInterfaceChange?: InterfaceChangeMode | undefined;
  /** Custom staging branch name when `onInterfaceChange === "staging-branch"`. */
  readonly stagingBranchName?: string | undefined;
  /** Suffix for coexisting binding when `onInterfaceChange === "add-only"` (defaults to `"v2"`). */
  readonly coexistenceSuffix?: string | undefined;
  /** Explicit approval flag for `requirement-edit` transactions when branch policy requires approval. */
  readonly approvedRequirementEdit?: boolean | undefined;
  /** Explicit waiver for evolution/add-only rules on published namespaces. */
  readonly waiveEvolution?: boolean | undefined;
  /** Optional updated branch policy to store in the resulting snapshot. */
  readonly nextPolicy?: BranchPolicy | undefined;
}

// ---------------------------------------------------------------------------
// Impact analysis, conflicts, policies, diffs, and results
// ---------------------------------------------------------------------------

export interface AffectedDependent {
  readonly qualifiedName: QualifiedName;
  readonly hash: DefHash;
}

export interface InterfaceImpact {
  readonly qualifiedName: QualifiedName;
  readonly oldHash: DefHash;
  readonly newHash: DefHash;
  readonly kind: "same-interface" | "interface-changed";
  readonly oldSignature?: string | undefined;
  readonly newSignature?: string | undefined;
  readonly oldRequirements: readonly string[];
  readonly newRequirements: readonly string[];
  readonly oldErrors: readonly string[];
  readonly newErrors: readonly string[];
  /** All direct and transitive dependents of the updated definition. */
  readonly affectedDependents: readonly AffectedDependent[];
  /** Dependents rebound without re-typechecking their bodies (same-interface updates). */
  readonly reboundDependents: readonly AffectedDependent[];
  /** Dependents not updated in this transaction (interface-changed updates). */
  readonly unupdatedDependents: readonly AffectedDependent[];
}

export interface ConflictEntry {
  readonly reason: "name-collision" | "dependency-changed" | "removed-dependency";
  readonly qualifiedName: QualifiedName;
  readonly baseHash?: DefHash | undefined;
  readonly headHash?: DefHash | undefined;
  readonly proposedHash?: DefHash | undefined;
  readonly message: string;
}

export interface ConflictReport {
  readonly branch: string;
  readonly baseSnapshot: SnapshotHash;
  readonly headSnapshot: SnapshotHash;
  readonly conflicts: readonly ConflictEntry[];
}

export type PolicyRuleKind =
  | "dependency-boundary"
  | "capability-budget"
  | "requirement-edit"
  | "evidence-gate"
  | "evolution";

export interface PolicyViolation {
  readonly rule: PolicyRuleKind;
  readonly qualifiedName?: QualifiedName | undefined;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>> | undefined;
}

export interface SnapshotDiffAdded {
  readonly qualifiedName: QualifiedName;
  readonly hash: DefHash;
  readonly kind: StoreDefinitionKind;
  readonly signature?: string | undefined;
}

export interface SnapshotDiffRemoved {
  readonly qualifiedName: QualifiedName;
  readonly hash: DefHash;
  readonly kind: StoreDefinitionKind;
  readonly signature?: string | undefined;
}

export interface SnapshotDiffUpdated {
  readonly qualifiedName: QualifiedName;
  readonly oldHash: DefHash;
  readonly newHash: DefHash;
  readonly kind: StoreDefinitionKind;
  readonly interfaceChanged: boolean;
  readonly oldSignature?: string | undefined;
  readonly newSignature?: string | undefined;
  readonly oldRequirements: readonly string[];
  readonly newRequirements: readonly string[];
  readonly oldErrors: readonly string[];
  readonly newErrors: readonly string[];
}

export interface SnapshotDiffRenamed {
  readonly from: QualifiedName;
  readonly to: QualifiedName;
  readonly hash: DefHash;
}

export interface SnapshotDiff {
  readonly fromSnapshot: SnapshotHash;
  readonly toSnapshot: SnapshotHash;
  readonly added: readonly SnapshotDiffAdded[];
  readonly removed: readonly SnapshotDiffRemoved[];
  readonly updated: readonly SnapshotDiffUpdated[];
  readonly renamed: readonly SnapshotDiffRenamed[];
}

export type PolicyEvidenceSource =
  | ReadonlyMap<DefHash, readonly EvidenceRecord[]>
  | ReadonlyMap<DefHash, EvidenceSummary>
  | ((hash: DefHash) => readonly EvidenceRecord[] | EvidenceSummary | undefined);

export interface PolicyEvaluationContext {
  readonly proposal: TransactionProposal;
  readonly policy: BranchPolicy;
  readonly baseSnapshot: Snapshot;
  readonly baseIndex: DefinitionIndex;
  readonly candidateSnapshot: Snapshot;
  readonly candidateIndex: DefinitionIndex;
  readonly impacts: readonly InterfaceImpact[];
  readonly diff: SnapshotDiff;
  readonly evidence?: PolicyEvidenceSource | undefined;
}

/** Pluggable policy evaluator hook invoked inside every transaction commit. */
export type PolicyEvaluator = (
  context: PolicyEvaluationContext,
) => readonly PolicyViolation[];

export interface TransactionDiagnostic {
  readonly code?: string | undefined;
  readonly message: string;
  readonly qualifiedName?: QualifiedName | undefined;
}

export interface TransactionCommitMetrics {
  /** Number of definitions whose bodies were typechecked during this transaction. */
  readonly typecheckedCount: number;
  /** Number of dependent definitions rebound without re-typechecking their bodies. */
  readonly reboundCount: number;
  /** Whether the transaction was auto-rebased onto a newer branch head during CAS. */
  readonly rebased: boolean;
}

export type TransactionFailureReason =
  | "unknown-branch"
  | "unknown-snapshot"
  | "parse-or-typecheck-error"
  | "interface-change"
  | "cas-conflict"
  | "policy-violation"
  | "invalid-operation";

export type TransactionResult =
  | {
      readonly ok: true;
      readonly branch: string;
      readonly snapshot: Snapshot;
      readonly previousHead: SnapshotHash;
      readonly impacts: readonly InterfaceImpact[];
      readonly diff: SnapshotDiff;
      readonly metrics: TransactionCommitMetrics;
      /** Present when `onInterfaceChange === "staging-branch"` redirected the commit. */
      readonly stagingBranch?: string | undefined;
      /** Present when `onInterfaceChange === "add-only"` added coexisting bindings (`originalName -> coexistingName`). */
      readonly coexistingBindings?: Readonly<Record<QualifiedName, QualifiedName>> | undefined;
    }
  | {
      readonly ok: false;
      readonly reason: TransactionFailureReason;
      readonly message: string;
      readonly diagnostics?: readonly TransactionDiagnostic[] | undefined;
      readonly impacts?: readonly InterfaceImpact[] | undefined;
      readonly conflict?: ConflictReport | undefined;
      readonly policyViolations?: readonly PolicyViolation[] | undefined;
    };

// ---------------------------------------------------------------------------
// Storage backend abstraction (in-memory browser-safe & Node persistent)
// ---------------------------------------------------------------------------

export interface SnapshotBackend {
  getSnapshot(hash: SnapshotHash): Snapshot | undefined;
  putSnapshot(snapshot: Snapshot): void;
  getDefinition(hash: DefHash): DefinitionRecord | undefined;
  putDefinition(record: DefinitionRecord): void;
  getBranch(name: string): BranchRef | undefined;
  listBranches(): readonly BranchRef[];
  /**
   * Atomically update `branch` head from `expectedHead` to `nextHead`
   * (`expectedHead === null` requires the branch not to exist yet).
   * Returns `true` on success, `false` on CAS mismatch.
   */
  compareAndSwapBranch(
    name: string,
    expectedHead: SnapshotHash | null,
    nextHead: SnapshotHash,
  ): boolean;
}

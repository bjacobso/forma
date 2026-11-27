/**
 * Browser-safe transactional snapshot/branch store facade for Host ABI and `forma mcp`
 * (RFC 0029 Stages 2–3).
 *
 * Delegates directly to the canonical `TransactionalStore` + `evaluateBranchPolicies`
 * engine from `@formalang/ts/store-policies`. Zero `node:*` imports.
 */
import type { Diagnostic } from "@formalang/ts/diagnostic";
import {
  TransactionalStore,
  evaluateBranchPolicies,
  namespaceOfQualifiedName,
  serializeSnapshot,
  type BranchPolicy,
  type ConflictEntry,
  type ConflictReport,
  type InterfaceImpact,
  type OperationClass,
  type PolicySetHash,
  type PolicyViolation,
  type QualifiedName,
  type Snapshot,
  type SnapshotDiff,
  type SnapshotHash,
  type TransactionFailureReason,
  type TransactionOp,
  type TransactionProposal,
} from "@formalang/ts/store-policies";
import type { DefHash, DefinitionDetails } from "@formalang/ts/store-queries";
import { recordToDetails, type IndexedSourceDocument } from "./store-queries.js";

export interface BranchRefView {
  readonly name: string;
  readonly head: SnapshotHash;
  readonly updatedAt: string;
}

export interface SnapshotView {
  readonly hash: SnapshotHash;
  readonly parent: SnapshotHash | null;
  readonly bindings: Readonly<Record<string, DefHash>>;
  readonly policies: PolicySetHash;
  readonly policyConfig: BranchPolicy;
  readonly languageProfile: string;
  readonly createdAt: string;
  readonly message?: string | undefined;
}

export type HostTransactionResult =
  | {
      readonly ok: true;
      readonly branch: string;
      readonly snapshot: SnapshotView;
      readonly previousHead: SnapshotHash;
      readonly impacts: readonly InterfaceImpact[];
      readonly diff: SnapshotDiff;
      readonly metrics: {
        readonly typecheckedCount: number;
        readonly reboundCount: number;
        readonly rebased: boolean;
      };
      readonly stagingBranch?: string | undefined;
      readonly coexistingBindings?: Readonly<Record<QualifiedName, QualifiedName>> | undefined;
      readonly diagnostics: readonly Diagnostic[];
    }
  | {
      readonly ok: false;
      readonly reason: TransactionFailureReason;
      readonly message: string;
      readonly diagnostics: readonly Diagnostic[];
      readonly impacts?: readonly InterfaceImpact[] | undefined;
      readonly conflict?: ConflictReport | undefined;
      readonly policyViolations?: readonly PolicyViolation[] | undefined;
    };

function toSnapshotView(snapshot: Snapshot): SnapshotView {
  const serialized = serializeSnapshot(snapshot);
  return {
    hash: serialized.hash,
    parent: serialized.parent,
    bindings: serialized.bindings,
    policies: serialized.policies,
    policyConfig: serialized.policyConfig,
    languageProfile: serialized.languageProfile,
    createdAt: serialized.createdAt ?? new Date().toISOString(),
    ...(serialized.message !== undefined ? { message: serialized.message } : {}),
  };
}

/**
 * In-memory transactional store backing `submitTransaction`, `listBranches`,
 * `getSnapshot`, and `diffSnapshots` on `TsLanguageHost` and `forma mcp`.
 */
export class HostTransactionStore {
  readonly #store: TransactionalStore;

  constructor(initialDocuments: readonly IndexedSourceDocument[] = [], initialPolicy: BranchPolicy = {}) {
    this.#store = new TransactionalStore({
      policyEvaluator: evaluateBranchPolicies,
    });
    this.#store.createBranchFromSources("main", initialDocuments, {
      policy: initialPolicy,
      message: "initial snapshot",
    });
  }

  /** Access the underlying canonical `TransactionalStore`. */
  get engine(): TransactionalStore {
    return this.#store;
  }

  listBranches(): readonly BranchRefView[] {
    return this.#store.listBranches().map((ref) => ({
      name: ref.name,
      head: ref.head,
      updatedAt: ref.updatedAt ?? new Date().toISOString(),
    }));
  }

  getSnapshot(target: { readonly branch?: string | undefined; readonly snapshotHash?: SnapshotHash | undefined }): {
    readonly snapshot?: SnapshotView | undefined;
    readonly definitions: readonly DefinitionDetails[];
    readonly diagnostics: readonly Diagnostic[];
  } {
    let hash = target.snapshotHash;
    if (!hash) {
      const branchName = target.branch ?? "main";
      const ref = this.#store.getBranch(branchName);
      if (!ref) {
        return {
          definitions: [],
          diagnostics: [{ code: "store/unknown-branch", severity: "error", message: `Unknown branch '${branchName}'.` }],
        };
      }
      hash = ref.head;
    }
    const snapshot = this.#store.getSnapshot(hash);
    if (!snapshot) {
      return {
        definitions: [],
        diagnostics: [{ code: "store/unknown-snapshot", severity: "error", message: `Unknown snapshot '${hash}'.` }],
      };
    }
    const index = this.#store.getSnapshotIndex(hash);
    const definitions = index
      ? [...index.definitions.values()]
          .sort((a, b) => a.qualifiedName.localeCompare(b.qualifiedName))
          .map((rec) => recordToDetails(index, rec))
      : [];
    return {
      snapshot: toSnapshotView(snapshot),
      definitions,
      diagnostics: [],
    };
  }

  diffSnapshots(from: SnapshotHash, to: SnapshotHash): {
    readonly diff?: SnapshotDiff | undefined;
    readonly diagnostics: readonly Diagnostic[];
  } {
    if (!this.#store.getSnapshot(from)) {
      return {
        diagnostics: [{ code: "store/unknown-snapshot", severity: "error", message: `Unknown source snapshot '${from}'.` }],
      };
    }
    if (!this.#store.getSnapshot(to)) {
      return {
        diagnostics: [{ code: "store/unknown-snapshot", severity: "error", message: `Unknown target snapshot '${to}'.` }],
      };
    }
    const diff = this.#store.diffSnapshots(from, to);
    return {
      diff,
      diagnostics: [],
    };
  }

  submitTransaction(proposal: TransactionProposal): HostTransactionResult {
    const result = this.#store.submitTransaction(proposal);
    if (result.ok) {
      return {
        ok: true,
        branch: result.branch,
        snapshot: toSnapshotView(result.snapshot),
        previousHead: result.previousHead,
        impacts: result.impacts,
        diff: result.diff,
        metrics: result.metrics,
        ...(result.stagingBranch !== undefined ? { stagingBranch: result.stagingBranch } : {}),
        ...(result.coexistingBindings !== undefined ? { coexistingBindings: result.coexistingBindings } : {}),
        diagnostics: [],
      };
    }

    const diagnostics: Diagnostic[] = [];
    if (result.diagnostics && result.diagnostics.length > 0) {
      for (const d of result.diagnostics) {
        diagnostics.push({
          code: d.code ?? `store/${result.reason}`,
          severity: "error",
          message: d.message,
        });
      }
    } else if (result.policyViolations && result.policyViolations.length > 0) {
      for (const v of result.policyViolations) {
        diagnostics.push({
          code: `store/policy-${v.rule}`,
          severity: "error",
          message: v.message,
        });
      }
    } else if (result.conflict && result.conflict.conflicts.length > 0) {
      for (const c of result.conflict.conflicts) {
        diagnostics.push({
          code: "store/cas-conflict",
          severity: "error",
          message: c.message,
        });
      }
    } else {
      diagnostics.push({
        code: `store/${result.reason}`,
        severity: "error",
        message: result.message,
      });
    }

    return {
      ok: false,
      reason: result.reason,
      message: result.message,
      diagnostics,
      ...(result.impacts !== undefined ? { impacts: result.impacts } : {}),
      ...(result.conflict !== undefined ? { conflict: result.conflict } : {}),
      ...(result.policyViolations !== undefined ? { policyViolations: result.policyViolations } : {}),
    };
  }
}

export type {
  BranchPolicy,
  ConflictEntry,
  ConflictReport,
  OperationClass,
  PolicyViolation,
  QualifiedName,
  SnapshotDiff,
  SnapshotHash,
  TransactionFailureReason,
  TransactionOp,
  TransactionProposal,
};
export { namespaceOfQualifiedName };

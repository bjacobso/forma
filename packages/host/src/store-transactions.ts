/**
 * Browser-safe transactional snapshot/branch store facade for Host ABI and `forma mcp`
 * (RFC 0029 Stage 3).
 *
 * Zero `node:*` imports. Structurally aligned with `@formalang/ts/store-policies`
 * and Stage 2 `tx-types.ts`.
 */
import { Effect } from "effect";
import { canonicalJson, sha256 } from "@formalang/ts/artifact";
import { diagnosticFromUnknown, type Diagnostic } from "@formalang/ts/diagnostic";
import { parseManyToSExpr } from "@formalang/ts/reader";
import {
  SNAPSHOT_HASH_VERSION,
  evaluateBranchPolicies,
  hashBranchPolicy,
  namespaceOfQualifiedName,
  type AffectedDependent,
  type BranchPolicy,
  type InterfaceImpact,
  type OperationClass,
  type PolicySetHash,
  type PolicySnapshotView,
  type PolicyViolation,
  type QualifiedName,
  type SnapshotDiff,
  type SnapshotDiffAdded,
  type SnapshotDiffRemoved,
  type SnapshotDiffRenamed,
  type SnapshotDiffUpdated,
  type SnapshotHash,
  type TransactionOp,
  type TransactionProposal,
} from "@formalang/ts/store-policies";
import {
  buildDefinitionIndexFromSources,
  type DefHash,
  type DefinitionDetails,
  type DefinitionIndex,
  type DefinitionRecord,
  type PresentationMeta,
} from "@formalang/ts/store-queries";
import { recordToDetails, type IndexedSourceDocument } from "./store-queries.js";

const DEFAULT_LANGUAGE_PROFILE = "forma-core-v1";

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

export type TransactionFailureReason =
  | "unknown-branch"
  | "unknown-snapshot"
  | "parse-or-typecheck-error"
  | "interface-change"
  | "cas-conflict"
  | "policy-violation"
  | "invalid-operation";

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

interface StoredSnapshot {
  readonly view: SnapshotView;
  readonly policyView: PolicySnapshotView;
  readonly index: DefinitionIndex;
  /** Per-module authored source snippets keyed by `qualifiedName` -> source text. */
  readonly bindingSources: ReadonlyMap<QualifiedName, string>;
  /** Module-level header lines (exports/imports) preserved per moduleId. */
  readonly moduleHeaders: ReadonlyMap<string, readonly string[]>;
}

function splitQualifiedName(qualifiedName: QualifiedName): { moduleId: string; name: string } {
  const idx = qualifiedName.indexOf("::");
  if (idx < 0) return { moduleId: "main.lisp", name: qualifiedName };
  return { moduleId: qualifiedName.slice(0, idx), name: qualifiedName.slice(idx + 2) };
}

function computeSnapshotHash(
  parent: SnapshotHash | null,
  bindings: ReadonlyMap<QualifiedName, DefHash>,
  policies: PolicySetHash,
  languageProfile: string,
): SnapshotHash {
  const sortedBindings: Record<string, string> = {};
  for (const key of [...bindings.keys()].sort()) {
    sortedBindings[key] = bindings.get(key)!;
  }
  const encoded = canonicalJson({
    version: SNAPSHOT_HASH_VERSION,
    parent,
    bindings: sortedBindings,
    policies,
    languageProfile,
  });
  return `${SNAPSHOT_HASH_VERSION}:${sha256(encoded)}`;
}

function mapToBindingsRecord(bindings: ReadonlyMap<QualifiedName, DefHash>): Record<string, DefHash> {
  const out: Record<string, DefHash> = {};
  for (const key of [...bindings.keys()].sort()) {
    out[key] = bindings.get(key)!;
  }
  return out;
}

function extractModuleHeaders(source: string): readonly string[] {
  const headers: string[] = [];
  for (const line of source.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("(import ") || trimmed.startsWith("(export ")) {
      headers.push(trimmed);
    }
  }
  return headers;
}

function buildModuleDocumentsFromBindings(
  bindingSources: ReadonlyMap<QualifiedName, string>,
  moduleHeaders: ReadonlyMap<string, readonly string[]>,
): readonly IndexedSourceDocument[] {
  const byModule = new Map<string, string[]>();
  for (const qName of [...bindingSources.keys()].sort()) {
    const { moduleId } = splitQualifiedName(qName);
    let list = byModule.get(moduleId);
    if (!list) {
      list = [];
      byModule.set(moduleId, list);
    }
    list.push(bindingSources.get(qName)!);
  }
  const docs: IndexedSourceDocument[] = [];
  for (const moduleId of [...byModule.keys()].sort()) {
    const headers = moduleHeaders.get(moduleId) ?? [];
    const body = byModule.get(moduleId)!;
    const text = [...headers, ...body].join("\n");
    docs.push({ id: moduleId, source: text });
  }
  return docs;
}

function sameInterface(a: DefinitionRecord, b: DefinitionRecord): boolean {
  if (a.canonicalSignature !== b.canonicalSignature) return false;
  if (a.signature !== b.signature) return false;
  if (a.requirements.length !== b.requirements.length) return false;
  for (let i = 0; i < a.requirements.length; i++) {
    if (a.requirements[i] !== b.requirements[i]) return false;
  }
  if (a.errors.length !== b.errors.length) return false;
  for (let i = 0; i < a.errors.length; i++) {
    if (a.errors[i] !== b.errors[i]) return false;
  }
  return true;
}

function computeDiff(fromSnap: StoredSnapshot, toSnap: StoredSnapshot): SnapshotDiff {
  const added: SnapshotDiffAdded[] = [];
  const removed: SnapshotDiffRemoved[] = [];
  const updated: SnapshotDiffUpdated[] = [];
  const renamed: SnapshotDiffRenamed[] = [];

  const fromBindings = fromSnap.policyView.bindings;
  const toBindings = toSnap.policyView.bindings;

  const removedByHash = new Map<DefHash, QualifiedName[]>();
  const addedByHash = new Map<DefHash, QualifiedName[]>();

  for (const [qName, hash] of fromBindings) {
    if (!toBindings.has(qName)) {
      const list = removedByHash.get(hash) ?? [];
      list.push(qName);
      removedByHash.set(hash, list);
    }
  }
  for (const [qName, hash] of toBindings) {
    if (!fromBindings.has(qName)) {
      const list = addedByHash.get(hash) ?? [];
      list.push(qName);
      addedByHash.set(hash, list);
    }
  }

  const matchedRemoved = new Set<QualifiedName>();
  const matchedAdded = new Set<QualifiedName>();
  for (const [hash, fromNames] of removedByHash) {
    const toNames = addedByHash.get(hash);
    if (!toNames) continue;
    const count = Math.min(fromNames.length, toNames.length);
    for (let i = 0; i < count; i++) {
      const from = fromNames[i]!;
      const to = toNames[i]!;
      renamed.push({ from, to, hash });
      matchedRemoved.add(from);
      matchedAdded.add(to);
    }
  }

  for (const qName of [...toBindings.keys()].sort()) {
    const newHash = toBindings.get(qName)!;
    const oldHash = fromBindings.get(qName);
    const newRec = toSnap.index.definitions.get(newHash);
    if (oldHash === undefined) {
      if (matchedAdded.has(qName)) continue;
      added.push({
        qualifiedName: qName,
        hash: newHash,
        kind: newRec?.kind ?? "define",
        ...(newRec?.signature !== undefined ? { signature: newRec.signature } : {}),
      });
    } else if (oldHash !== newHash) {
      const oldRec = fromSnap.index.definitions.get(oldHash);
      const interfaceChanged = oldRec && newRec ? !sameInterface(oldRec, newRec) : true;
      updated.push({
        qualifiedName: qName,
        oldHash,
        newHash,
        kind: newRec?.kind ?? oldRec?.kind ?? "define",
        interfaceChanged,
        ...(oldRec?.signature !== undefined ? { oldSignature: oldRec.signature } : {}),
        ...(newRec?.signature !== undefined ? { newSignature: newRec.signature } : {}),
        oldRequirements: [...(oldRec?.requirements ?? [])],
        newRequirements: [...(newRec?.requirements ?? [])],
        oldErrors: [...(oldRec?.errors ?? [])],
        newErrors: [...(newRec?.errors ?? [])],
      });
    }
  }

  for (const qName of [...fromBindings.keys()].sort()) {
    if (toBindings.has(qName) || matchedRemoved.has(qName)) continue;
    const oldHash = fromBindings.get(qName)!;
    const oldRec = fromSnap.index.definitions.get(oldHash);
    removed.push({
      qualifiedName: qName,
      hash: oldHash,
      kind: oldRec?.kind ?? "define",
      ...(oldRec?.signature !== undefined ? { signature: oldRec.signature } : {}),
    });
  }

  return {
    fromSnapshot: fromSnap.view.hash,
    toSnapshot: toSnap.view.hash,
    added,
    removed,
    updated,
    renamed,
  };
}

function collectTouchedNames(ops: readonly TransactionOp[]): Set<QualifiedName> {
  const touched = new Set<QualifiedName>();
  for (const op of ops) {
    if (op.kind === "add" || op.kind === "update" || op.kind === "remove") {
      touched.add(op.qualifiedName);
    } else if (op.kind === "rename") {
      touched.add(op.from);
      touched.add(op.to);
    } else if (op.kind === "move") {
      const { name } = splitQualifiedName(op.from);
      touched.add(op.from);
      touched.add(`${op.toModuleId}::${op.newName ?? name}`);
    }
  }
  return touched;
}

function buildStoredSnapshot(
  parent: SnapshotHash | null,
  bindingSources: ReadonlyMap<QualifiedName, string>,
  moduleHeaders: ReadonlyMap<string, readonly string[]>,
  policyConfig: BranchPolicy,
  message?: string,
  extraRenames?: ReadonlyMap<QualifiedName, DefHash>,
): { readonly snapshot?: StoredSnapshot; readonly diagnostics: readonly Diagnostic[] } {
  const docs = buildModuleDocumentsFromBindings(bindingSources, moduleHeaders);
  const diagnostics: Diagnostic[] = [];
  for (const doc of docs) {
    const parsed = Effect.runSync(Effect.result(parseManyToSExpr(doc.source, doc.id)));
    if (parsed._tag === "Failure") {
      diagnostics.push(diagnosticFromUnknown(parsed.failure, "parse", doc.id));
    }
  }
  if (diagnostics.length > 0) return { diagnostics };

  const index = buildDefinitionIndexFromSources(docs);
  const bindings = new Map<QualifiedName, DefHash>();
  for (const def of index.definitions.values()) {
    bindings.set(def.qualifiedName, def.hash);
  }
  if (extraRenames) {
    for (const [qName, hash] of extraRenames) {
      if (!bindings.has(qName) && index.definitions.has(hash)) {
        bindings.set(qName, hash);
      }
    }
  }

  const policies = hashBranchPolicy(policyConfig);
  const hash = computeSnapshotHash(parent, bindings, policies, DEFAULT_LANGUAGE_PROFILE);
  const createdAt = new Date().toISOString();
  const metadata = new Map<DefHash, PresentationMeta>(index.metadata);

  const policyView: PolicySnapshotView = {
    hash,
    parent,
    bindings,
    metadata,
    policies,
    policyConfig,
    languageProfile: DEFAULT_LANGUAGE_PROFILE,
    createdAt,
    ...(message !== undefined ? { message } : {}),
  };

  const view: SnapshotView = {
    hash,
    parent,
    bindings: mapToBindingsRecord(bindings),
    policies,
    policyConfig,
    languageProfile: DEFAULT_LANGUAGE_PROFILE,
    createdAt,
    ...(message !== undefined ? { message } : {}),
  };

  return {
    snapshot: {
      view,
      policyView,
      index,
      bindingSources,
      moduleHeaders,
    },
    diagnostics: [],
  };
}

/**
 * In-memory transactional store backing `submitTransaction`, `listBranches`,
 * `getSnapshot`, and `diffSnapshots` on `TsLanguageHost` and `forma mcp`.
 */
export class HostTransactionStore {
  readonly #snapshots = new Map<SnapshotHash, StoredSnapshot>();
  readonly #branches = new Map<string, BranchRefView>();

  constructor(initialDocuments: readonly IndexedSourceDocument[] = [], initialPolicy: BranchPolicy = {}) {
    const bindingSources = new Map<QualifiedName, string>();
    const moduleHeaders = new Map<string, readonly string[]>();

    if (initialDocuments.length > 0) {
      const index = buildDefinitionIndexFromSources(initialDocuments);
      for (const doc of initialDocuments) {
        const headers = extractModuleHeaders(doc.source);
        if (headers.length > 0) moduleHeaders.set(doc.id, headers);
      }
      for (const def of index.definitions.values()) {
        if (def.meta.authoredSource) {
          bindingSources.set(def.qualifiedName, def.meta.authoredSource);
        }
      }
    }

    const built = buildStoredSnapshot(null, bindingSources, moduleHeaders, initialPolicy, "initial snapshot");
    if (!built.snapshot) {
      const empty = buildStoredSnapshot(null, new Map(), new Map(), initialPolicy, "initial snapshot");
      this.#registerInitial(empty.snapshot!);
    } else {
      this.#registerInitial(built.snapshot);
    }
  }

  #registerInitial(snapshot: StoredSnapshot): void {
    this.#snapshots.set(snapshot.view.hash, snapshot);
    this.#branches.set("main", {
      name: "main",
      head: snapshot.view.hash,
      updatedAt: snapshot.view.createdAt,
    });
  }

  listBranches(): readonly BranchRefView[] {
    return [...this.#branches.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  getSnapshot(target: { readonly branch?: string | undefined; readonly snapshotHash?: SnapshotHash | undefined }): {
    readonly snapshot?: SnapshotView | undefined;
    readonly definitions: readonly DefinitionDetails[];
    readonly diagnostics: readonly Diagnostic[];
  } {
    let hash = target.snapshotHash;
    if (!hash) {
      const branchName = target.branch ?? "main";
      const ref = this.#branches.get(branchName);
      if (!ref) {
        return {
          definitions: [],
          diagnostics: [{ code: "store/unknown-branch", severity: "error", message: `Unknown branch '${branchName}'.` }],
        };
      }
      hash = ref.head;
    }
    const stored = this.#snapshots.get(hash);
    if (!stored) {
      return {
        definitions: [],
        diagnostics: [{ code: "store/unknown-snapshot", severity: "error", message: `Unknown snapshot '${hash}'.` }],
      };
    }
    const definitions = [...stored.index.definitions.values()]
      .sort((a, b) => a.qualifiedName.localeCompare(b.qualifiedName))
      .map((rec) => recordToDetails(stored.index, rec));
    return {
      snapshot: stored.view,
      definitions,
      diagnostics: [],
    };
  }

  diffSnapshots(from: SnapshotHash, to: SnapshotHash): {
    readonly diff?: SnapshotDiff | undefined;
    readonly diagnostics: readonly Diagnostic[];
  } {
    const fromSnap = this.#snapshots.get(from);
    if (!fromSnap) {
      return {
        diagnostics: [{ code: "store/unknown-snapshot", severity: "error", message: `Unknown source snapshot '${from}'.` }],
      };
    }
    const toSnap = this.#snapshots.get(to);
    if (!toSnap) {
      return {
        diagnostics: [{ code: "store/unknown-snapshot", severity: "error", message: `Unknown target snapshot '${to}'.` }],
      };
    }
    return {
      diff: computeDiff(fromSnap, toSnap),
      diagnostics: [],
    };
  }

  submitTransaction(proposal: TransactionProposal): HostTransactionResult {
    const branchRef = this.#branches.get(proposal.branch);
    if (!branchRef) {
      return {
        ok: false,
        reason: "unknown-branch",
        message: `Unknown branch '${proposal.branch}'.`,
        diagnostics: [{ code: "store/unknown-branch", severity: "error", message: `Unknown branch '${proposal.branch}'.` }],
      };
    }

    const baseSnap = this.#snapshots.get(proposal.baseSnapshot);
    if (!baseSnap) {
      return {
        ok: false,
        reason: "unknown-snapshot",
        message: `Unknown base snapshot '${proposal.baseSnapshot}'.`,
        diagnostics: [{ code: "store/unknown-snapshot", severity: "error", message: `Unknown base snapshot '${proposal.baseSnapshot}'.` }],
      };
    }

    const headSnap = this.#snapshots.get(branchRef.head)!;
    const isStale = headSnap.view.hash !== baseSnap.view.hash;

    // First validate & build candidate against baseSnapshot so we know its exact effects and dependencies.
    const baseApplied = this.#applyOperations(baseSnap, proposal);
    if (!baseApplied.ok) return baseApplied.failure;

    let effectiveBase = baseSnap;
    let candidate = baseApplied.candidate;
    let rebased = false;

    if (isStale) {
      const conflicts = this.#detectCasConflicts(baseSnap, headSnap, baseApplied.candidate, proposal);
      if (conflicts.length > 0) {
        const report: ConflictReport = {
          branch: proposal.branch,
          baseSnapshot: baseSnap.view.hash,
          headSnapshot: headSnap.view.hash,
          conflicts,
        };
        return {
          ok: false,
          reason: "cas-conflict",
          message: `Transaction rejected due to ${conflicts.length} CAS conflict(s) on branch '${proposal.branch}' (base ${baseSnap.view.hash}, head ${headSnap.view.hash}).`,
          diagnostics: conflicts.map((c) => ({
            code: "store/cas-conflict",
            severity: "error" as const,
            message: c.message,
          })),
          conflict: report,
        };
      }

      // Disjoint auto-rebase onto current head.
      const rebasedApplied = this.#applyOperations(headSnap, proposal);
      if (!rebasedApplied.ok) return rebasedApplied.failure;
      effectiveBase = headSnap;
      candidate = rebasedApplied.candidate;
      rebased = true;
    }

    const diff = computeDiff(effectiveBase, candidate);
    const impacts = this.#computeImpacts(effectiveBase, candidate, diff, proposal);

    // Protected branch interface-change check.
    if (effectiveBase.view.policyConfig.protected) {
      const breaking = impacts.filter(
        (impact) => impact.kind === "interface-changed" && impact.unupdatedDependents.length > 0,
      );
      if (breaking.length > 0 && proposal.onInterfaceChange !== "staging-branch" && proposal.onInterfaceChange !== "add-only") {
        return {
          ok: false,
          reason: "interface-change",
          message: `Interface-changing update on protected branch '${proposal.branch}' leaves unupdated dependents.`,
          diagnostics: breaking.map((b) => ({
            code: "store/interface-change",
            severity: "error" as const,
            message: `Changing '${b.qualifiedName}' breaks ${b.unupdatedDependents.length} dependent(s): ${b.unupdatedDependents.map((d) => d.qualifiedName).join(", ")}.`,
          })),
          impacts,
        };
      }
    }

    // Evaluate current branch policies (Stage 3).
    const violations = evaluateBranchPolicies({
      proposal,
      policy: effectiveBase.view.policyConfig,
      baseSnapshot: effectiveBase.policyView,
      baseIndex: effectiveBase.index,
      candidateSnapshot: candidate.policyView,
      candidateIndex: candidate.index,
      impacts,
      diff,
    });
    if (violations.length > 0) {
      return {
        ok: false,
        reason: "policy-violation",
        message: `Transaction rejected by ${violations.length} branch policy violation(s).`,
        diagnostics: violations.map((v) => ({
          code: `store/policy-${v.rule}`,
          severity: "error" as const,
          message: v.message,
        })),
        policyViolations: violations,
      };
    }

    // Commit immutable snapshot and advance branch head.
    this.#snapshots.set(candidate.view.hash, candidate);
    this.#branches.set(proposal.branch, {
      name: proposal.branch,
      head: candidate.view.hash,
      updatedAt: candidate.view.createdAt,
    });

    const reboundCount = impacts.reduce((sum, i) => sum + i.reboundDependents.length, 0);
    const typecheckedCount = diff.added.length + diff.updated.length;

    return {
      ok: true,
      branch: proposal.branch,
      snapshot: candidate.view,
      previousHead: headSnap.view.hash,
      impacts,
      diff,
      metrics: {
        typecheckedCount,
        reboundCount,
        rebased,
      },
      diagnostics: [],
    };
  }

  #applyOperations(
    baseSnap: StoredSnapshot,
    proposal: TransactionProposal,
  ): { readonly ok: true; readonly candidate: StoredSnapshot } | { readonly ok: false; readonly failure: HostTransactionResult } {
    const bindingSources = new Map(baseSnap.bindingSources);
    const moduleHeaders = new Map(baseSnap.moduleHeaders);

    for (const op of proposal.operations) {
      if (op.kind === "add") {
        if (bindingSources.has(op.qualifiedName)) {
          return {
            ok: false,
            failure: {
              ok: false,
              reason: "invalid-operation",
              message: `Cannot add '${op.qualifiedName}': binding already exists.`,
              diagnostics: [{ code: "store/invalid-op", severity: "error", message: `Cannot add '${op.qualifiedName}': binding already exists.` }],
            },
          };
        }
        const source = op.source ?? op.record?.meta.authoredSource;
        if (!source) {
          return {
            ok: false,
            failure: {
              ok: false,
              reason: "invalid-operation",
              message: `Add operation for '${op.qualifiedName}' requires 'source'.`,
              diagnostics: [{ code: "store/invalid-op", severity: "error", message: `Add operation for '${op.qualifiedName}' requires 'source'.` }],
            },
          };
        }
        const { moduleId } = splitQualifiedName(op.qualifiedName);
        const headers = extractModuleHeaders(source);
        if (headers.length > 0) {
          const existing = moduleHeaders.get(moduleId) ?? [];
          moduleHeaders.set(moduleId, [...new Set([...existing, ...headers])]);
        }
        const bodyLines = source
          .split("\n")
          .filter((l) => {
            const t = l.trim();
            return !t.startsWith("(import ") && !t.startsWith("(export ");
          })
          .join("\n")
          .trim();
        bindingSources.set(op.qualifiedName, bodyLines || source);
      } else if (op.kind === "update") {
        if (!bindingSources.has(op.qualifiedName)) {
          return {
            ok: false,
            failure: {
              ok: false,
              reason: "invalid-operation",
              message: `Cannot update '${op.qualifiedName}': binding does not exist.`,
              diagnostics: [{ code: "store/invalid-op", severity: "error", message: `Cannot update '${op.qualifiedName}': binding does not exist.` }],
            },
          };
        }
        const source = op.source ?? op.record?.meta.authoredSource;
        if (!source) {
          return {
            ok: false,
            failure: {
              ok: false,
              reason: "invalid-operation",
              message: `Update operation for '${op.qualifiedName}' requires 'source'.`,
              diagnostics: [{ code: "store/invalid-op", severity: "error", message: `Update operation for '${op.qualifiedName}' requires 'source'.` }],
            },
          };
        }
        const { moduleId } = splitQualifiedName(op.qualifiedName);
        const headers = extractModuleHeaders(source);
        if (headers.length > 0) {
          const existing = moduleHeaders.get(moduleId) ?? [];
          moduleHeaders.set(moduleId, [...new Set([...existing, ...headers])]);
        }
        const bodyLines = source
          .split("\n")
          .filter((l) => {
            const t = l.trim();
            return !t.startsWith("(import ") && !t.startsWith("(export ");
          })
          .join("\n")
          .trim();
        bindingSources.set(op.qualifiedName, bodyLines || source);
      } else if (op.kind === "remove") {
        if (!bindingSources.has(op.qualifiedName)) {
          return {
            ok: false,
            failure: {
              ok: false,
              reason: "invalid-operation",
              message: `Cannot remove '${op.qualifiedName}': binding does not exist.`,
              diagnostics: [{ code: "store/invalid-op", severity: "error", message: `Cannot remove '${op.qualifiedName}': binding does not exist.` }],
            },
          };
        }
        bindingSources.delete(op.qualifiedName);
      } else if (op.kind === "rename") {
        const src = bindingSources.get(op.from);
        if (src === undefined) {
          return {
            ok: false,
            failure: {
              ok: false,
              reason: "invalid-operation",
              message: `Cannot rename '${op.from}': binding does not exist.`,
              diagnostics: [{ code: "store/invalid-op", severity: "error", message: `Cannot rename '${op.from}': binding does not exist.` }],
            },
          };
        }
        if (bindingSources.has(op.to)) {
          return {
            ok: false,
            failure: {
              ok: false,
              reason: "invalid-operation",
              message: `Cannot rename '${op.from}' to '${op.to}': target already exists.`,
              diagnostics: [{ code: "store/invalid-op", severity: "error", message: `Cannot rename '${op.from}' to '${op.to}': target already exists.` }],
            },
          };
        }
        const oldName = splitQualifiedName(op.from).name;
        const newName = splitQualifiedName(op.to).name;
        bindingSources.delete(op.from);
        bindingSources.set(op.to, src.replace(new RegExp(`\\b${oldName.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}\\b`, "u"), newName));
      } else if (op.kind === "move") {
        const src = bindingSources.get(op.from);
        if (src === undefined) {
          return {
            ok: false,
            failure: {
              ok: false,
              reason: "invalid-operation",
              message: `Cannot move '${op.from}': binding does not exist.`,
              diagnostics: [{ code: "store/invalid-op", severity: "error", message: `Cannot move '${op.from}': binding does not exist.` }],
            },
          };
        }
        const { name } = splitQualifiedName(op.from);
        const targetQName = `${op.toModuleId}::${op.newName ?? name}`;
        if (bindingSources.has(targetQName)) {
          return {
            ok: false,
            failure: {
              ok: false,
              reason: "invalid-operation",
              message: `Cannot move '${op.from}' to '${targetQName}': target already exists.`,
              diagnostics: [{ code: "store/invalid-op", severity: "error", message: `Cannot move '${op.from}' to '${targetQName}': target already exists.` }],
            },
          };
        }
        bindingSources.delete(op.from);
        const nextSrc = op.newName
          ? src.replace(new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}\\b`, "u"), op.newName)
          : src;
        bindingSources.set(targetQName, nextSrc);
      }
    }

    const nextPolicy = proposal.nextPolicy ?? baseSnap.view.policyConfig;
    const built = buildStoredSnapshot(
      baseSnap.view.hash,
      bindingSources,
      moduleHeaders,
      nextPolicy,
      proposal.message,
    );
    if (!built.snapshot) {
      return {
        ok: false,
        failure: {
          ok: false,
          reason: "parse-or-typecheck-error",
          message: built.diagnostics[0]?.message ?? "Parse or typecheck failed.",
          diagnostics: built.diagnostics,
        },
      };
    }

    return { ok: true, candidate: built.snapshot };
  }

  #detectCasConflicts(
    baseSnap: StoredSnapshot,
    headSnap: StoredSnapshot,
    proposedSnap: StoredSnapshot,
    proposal: TransactionProposal,
  ): ConflictEntry[] {
    const conflicts: ConflictEntry[] = [];
    const concurrentDiff = computeDiff(baseSnap, headSnap);
    const headTouched = new Set<QualifiedName>();
    for (const a of concurrentDiff.added) headTouched.add(a.qualifiedName);
    for (const u of concurrentDiff.updated) headTouched.add(u.qualifiedName);
    for (const r of concurrentDiff.removed) headTouched.add(r.qualifiedName);
    for (const rn of concurrentDiff.renamed) {
      headTouched.add(rn.from);
      headTouched.add(rn.to);
    }

    const proposalTouched = collectTouchedNames(proposal.operations);

    // 1. Direct name collisions.
    for (const qName of proposalTouched) {
      if (headTouched.has(qName)) {
        const baseHash = baseSnap.policyView.bindings.get(qName);
        const headHash = headSnap.policyView.bindings.get(qName);
        const proposedHash = proposedSnap.policyView.bindings.get(qName);
        conflicts.push({
          reason: "name-collision",
          qualifiedName: qName,
          ...(baseHash !== undefined ? { baseHash } : {}),
          ...(headHash !== undefined ? { headHash } : {}),
          ...(proposedHash !== undefined ? { proposedHash } : {}),
          message: `CAS conflict: '${qName}' was modified concurrently on branch '${proposal.branch}'.`,
        });
      }
    }

    // 2. Dependencies read by proposed changes were modified/removed concurrently.
    const seenConflictNames = new Set(conflicts.map((c) => c.qualifiedName));
    for (const qName of proposalTouched) {
      const propHash = proposedSnap.policyView.bindings.get(qName);
      if (!propHash) continue;
      const propRec = proposedSnap.index.definitions.get(propHash);
      if (!propRec) continue;
      for (const depHash of [...propRec.dependencies, ...propRec.formDependencies]) {
        const depRec = proposedSnap.index.definitions.get(depHash);
        if (!depRec || depRec.qualifiedName === qName) continue;
        if (seenConflictNames.has(depRec.qualifiedName)) continue;
        const baseDepHash = baseSnap.policyView.bindings.get(depRec.qualifiedName);
        const headDepHash = headSnap.policyView.bindings.get(depRec.qualifiedName);
        if (baseDepHash !== undefined && headDepHash === undefined) {
          seenConflictNames.add(depRec.qualifiedName);
          conflicts.push({
            reason: "removed-dependency",
            qualifiedName: depRec.qualifiedName,
            baseHash: baseDepHash,
            message: `CAS conflict: dependency '${depRec.qualifiedName}' of '${qName}' was removed concurrently.`,
          });
        } else if (baseDepHash !== headDepHash && headDepHash !== undefined) {
          seenConflictNames.add(depRec.qualifiedName);
          conflicts.push({
            reason: "dependency-changed",
            qualifiedName: depRec.qualifiedName,
            ...(baseDepHash !== undefined ? { baseHash: baseDepHash } : {}),
            headHash: headDepHash,
            message: `CAS conflict: dependency '${depRec.qualifiedName}' of '${qName}' changed concurrently.`,
          });
        }
      }
    }

    return conflicts;
  }

  #computeImpacts(
    baseSnap: StoredSnapshot,
    candidateSnap: StoredSnapshot,
    diff: SnapshotDiff,
    proposal: TransactionProposal,
  ): readonly InterfaceImpact[] {
    const touched = collectTouchedNames(proposal.operations);
    const impacts: InterfaceImpact[] = [];

    for (const u of diff.updated) {
      const depHashes = baseSnap.index.dependents.get(u.oldHash) ?? [];
      const affectedDependents: AffectedDependent[] = [];
      for (const depHash of depHashes) {
        const rec = baseSnap.index.definitions.get(depHash);
        if (rec && rec.qualifiedName !== u.qualifiedName) {
          affectedDependents.push({ qualifiedName: rec.qualifiedName, hash: rec.hash });
        }
      }
      const kind = u.interfaceChanged ? "interface-changed" : "same-interface";
      const reboundDependents = kind === "same-interface" ? affectedDependents : [];
      const unupdatedDependents =
        kind === "interface-changed"
          ? affectedDependents.filter((d) => !touched.has(d.qualifiedName))
          : [];

      impacts.push({
        qualifiedName: u.qualifiedName,
        oldHash: u.oldHash,
        newHash: u.newHash,
        kind,
        ...(u.oldSignature !== undefined ? { oldSignature: u.oldSignature } : {}),
        ...(u.newSignature !== undefined ? { newSignature: u.newSignature } : {}),
        oldRequirements: u.oldRequirements,
        newRequirements: u.newRequirements,
        oldErrors: u.oldErrors,
        newErrors: u.newErrors,
        affectedDependents,
        reboundDependents,
        unupdatedDependents,
      });
    }

    return impacts;
  }
}

export type {
  BranchPolicy,
  OperationClass,
  PolicyViolation,
  QualifiedName,
  SnapshotDiff,
  SnapshotHash,
  TransactionOp,
  TransactionProposal,
};
export { namespaceOfQualifiedName };

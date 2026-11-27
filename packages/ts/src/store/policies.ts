/**
 * Enforceable project policies and `impl-edit` vs `requirement-edit` separation
 * (RFC 0029 §5–§6, Stage 3).
 *
 * Browser-safe: contains zero `node:*` imports.
 *
 * Types are structurally aligned with `packages/ts/src/store/tx-types.ts` so
 * `evaluateBranchPolicies` plugs directly into `TransactionalStore` as a
 * `PolicyEvaluator`.
 */

import { canonicalJson, sha256 } from "../artifact/canonical-json.js";
import {
  POLICY_HASH_VERSION,
  SNAPSHOT_HASH_VERSION,
  type AffectedDependent,
  type BranchPolicy,
  type CapabilityBudgetRule,
  type DependencyBoundaryRule,
  type EvidenceGatePolicy,
  type EvolutionPolicy,
  type InterfaceImpact,
  type OperationClass,
  type PolicyEvaluationContext,
  type PolicyEvaluator,
  type PolicyEvidenceSource,
  type PolicyRuleKind,
  type PolicySetHash,
  type PolicyViolation,
  type QualifiedName,
  type RequirementEditPolicy,
  type Snapshot,
  type SnapshotDiff,
  type SnapshotDiffAdded,
  type SnapshotDiffRemoved,
  type SnapshotDiffRenamed,
  type SnapshotDiffUpdated,
  type SnapshotHash,
  type TransactionOp,
  type TransactionProposal,
} from "./tx-types.js";
import type {
  DefHash,
  DefinitionRecord,
  EvidenceRecord,
  TestEvidencePayload,
  TypecheckEvidencePayload,
  VerificationEvidencePayload,
} from "./types.js";

export { POLICY_HASH_VERSION, SNAPSHOT_HASH_VERSION };
export type {
  AffectedDependent,
  BranchPolicy,
  CapabilityBudgetRule,
  DependencyBoundaryRule,
  EvidenceGatePolicy,
  EvolutionPolicy,
  InterfaceImpact,
  OperationClass,
  PolicyEvaluationContext,
  PolicyEvaluator,
  PolicyEvidenceSource,
  PolicyRuleKind,
  PolicySetHash,
  PolicyViolation,
  QualifiedName,
  RequirementEditPolicy,
  Snapshot,
  SnapshotDiff,
  SnapshotDiffAdded,
  SnapshotDiffRemoved,
  SnapshotDiffRenamed,
  SnapshotDiffUpdated,
  SnapshotHash,
  TransactionOp,
  TransactionProposal,
};

/** Alias preserved for callers referencing `PolicySnapshotView`. */
export type PolicySnapshotView = Snapshot;

// ---------------------------------------------------------------------------
// Policy hashing & matching helpers
// ---------------------------------------------------------------------------

/** Compute a deterministic tagged SHA-256 hash of a `BranchPolicy`. */
export function hashBranchPolicy(policy: BranchPolicy): PolicySetHash {
  const normalized = canonicalJson({
    version: POLICY_HASH_VERSION,
    protected: policy.protected ?? false,
    dependencyBoundaries: (policy.dependencyBoundaries ?? []).map((rule) => ({
      from: rule.from,
      ...(rule.allow !== undefined ? { allow: [...rule.allow] } : {}),
      ...(rule.deny !== undefined ? { deny: [...rule.deny] } : {}),
    })),
    capabilityBudgets: (policy.capabilityBudgets ?? []).map((budget) => ({
      namespace: budget.namespace,
      maxRequirements: [...budget.maxRequirements],
    })),
    requirementEdit: policy.requirementEdit
      ? {
          ...(policy.requirementEdit.requireExplicitClass !== undefined
            ? { requireExplicitClass: policy.requirementEdit.requireExplicitClass }
            : {}),
          ...(policy.requirementEdit.requireApproval !== undefined
            ? { requireApproval: policy.requirementEdit.requireApproval }
            : {}),
        }
      : null,
    evidenceGates: policy.evidenceGates
      ? {
          requiredKinds: [...policy.evidenceGates.requiredKinds],
          ...(policy.evidenceGates.rejectInconclusiveVerification !== undefined
            ? { rejectInconclusiveVerification: policy.evidenceGates.rejectInconclusiveVerification }
            : {}),
          ...(policy.evidenceGates.requireDeterministicTests !== undefined
            ? { requireDeterministicTests: policy.evidenceGates.requireDeterministicTests }
            : {}),
        }
      : null,
    evolution: policy.evolution
      ? {
          publishedNamespaces: [...policy.evolution.publishedNamespaces],
          mode: policy.evolution.mode,
        }
      : null,
  });
  return `${POLICY_HASH_VERSION}:${sha256(normalized)}`;
}

/** Extract the namespace (moduleId) from a `QualifiedName` (`moduleId::name`). */
export function namespaceOfQualifiedName(qualifiedName: QualifiedName): string {
  const sep = qualifiedName.indexOf("::");
  return sep >= 0 ? qualifiedName.slice(0, sep) : qualifiedName;
}

/**
 * Match a module/namespace identifier against a policy pattern.
 * Supports:
 * - `"*"` (matches every namespace)
 * - `"prefix/*"` (matches `"prefix"` and `"prefix/..."`)
 * - `"prefix*"` (prefix wildcard)
 * - Exact match `"domain"`, plus `"domain/..."` and `"domain.lisp"`
 */
export function matchesNamespace(moduleId: string, pattern: string): boolean {
  if (pattern === "*") return true;
  if (pattern.endsWith("/*")) {
    const prefix = pattern.slice(0, -2);
    return moduleId === prefix || moduleId.startsWith(`${prefix}/`);
  }
  if (pattern.endsWith("*")) {
    return moduleId.startsWith(pattern.slice(0, -1));
  }
  return (
    moduleId === pattern ||
    moduleId.startsWith(`${pattern}/`) ||
    moduleId === `${pattern}.lisp` ||
    moduleId.startsWith(`${pattern}.`) && moduleId.endsWith(".lisp")
  );
}

/**
 * Check whether a concrete Effect requirement (e.g. `"Users.find"`, `"Db.query"`)
 * is permitted by a capability budget entry (e.g. `"Users"`, `"Users.find"`, `"*"`).
 */
export function capabilityAllowed(requirement: string, allowedPattern: string): boolean {
  if (allowedPattern === "*") return true;
  if (requirement === allowedPattern) return true;
  return requirement.startsWith(`${allowedPattern}.`);
}

// ---------------------------------------------------------------------------
// Requirement / contract / law detection helpers
// ---------------------------------------------------------------------------

const REQUIREMENT_FORM_HEADS = new Set([
  "test",
  "law",
  "invariant",
  "contract",
  "spec",
  "property",
  "verify",
  "deftest",
  "deflaw",
]);

const CONTRACT_CLAUSE_PATTERN =
  /(?:\((?:requires|ensures|invariant|law|assert|contract)\b|:(?:requires|ensures|invariant|law|contract)\b)/gu;

function extractLeadingFormHead(source: string | undefined): string | undefined {
  if (!source) return undefined;
  const trimmed = source.trimStart();
  const match = /^\(\s*([^\s()[\]{}]+)/u.exec(trimmed);
  return match?.[1];
}

function extractContractClauses(text: string | undefined): readonly string[] {
  if (!text) return [];
  const matches = text.match(CONTRACT_CLAUSE_PATTERN);
  return matches ? [...matches] : [];
}

/**
 * Determine whether a `DefinitionRecord` represents a test, law, invariant, or
 * contract declaration that requires `operationClass === "requirement-edit"`.
 */
export function isRequirementDefinition(record: DefinitionRecord | undefined): boolean {
  if (!record) return false;
  if (record.kind === "test") return true;
  const sourceHead = extractLeadingFormHead(record.meta.authoredSource);
  if (sourceHead && REQUIREMENT_FORM_HEADS.has(sourceHead)) return true;
  const canonicalHead = extractLeadingFormHead(record.canonicalForm);
  if (canonicalHead && REQUIREMENT_FORM_HEADS.has(canonicalHead)) return true;
  return false;
}

/**
 * Detect whether an update to a non-test definition weakens or deletes
 * embedded contract/law clauses (e.g. `:requires`, `:ensures`, `:invariant`,
 * `(requires ...)`, `(ensures ...)`, `(invariant ...)`).
 */
function hasWeakenedContractClauses(
  before: DefinitionRecord | undefined,
  after: DefinitionRecord | undefined,
): boolean {
  if (!before || !after) return false;
  const beforeText = before.meta.authoredSource ?? before.canonicalForm;
  const afterText = after.meta.authoredSource ?? after.canonicalForm;
  const beforeClauses = extractContractClauses(beforeText);
  if (beforeClauses.length === 0) return false;
  const afterClauses = extractContractClauses(afterText);
  if (afterClauses.length < beforeClauses.length) return true;
  // Check if any clause keyword/form present before was removed or modified.
  const beforeCounts = new Map<string, number>();
  for (const c of beforeClauses) beforeCounts.set(c, (beforeCounts.get(c) ?? 0) + 1);
  const afterCounts = new Map<string, number>();
  for (const c of afterClauses) afterCounts.set(c, (afterCounts.get(c) ?? 0) + 1);
  for (const [clause, count] of beforeCounts) {
    if ((afterCounts.get(clause) ?? 0) < count) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Evidence lookup helpers
// ---------------------------------------------------------------------------

function resolveEvidenceRecords(
  source: PolicyEvidenceSource | undefined,
  hash: DefHash,
): readonly EvidenceRecord[] {
  if (!source) return [];
  const raw = typeof source === "function" ? source(hash) : source.get(hash);
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "object" && "records" in raw && Array.isArray(raw.records)) {
    return raw.records;
  }
  return [];
}

function isTypecheckPayload(payload: unknown): payload is TypecheckEvidencePayload {
  return (
    typeof payload === "object" &&
    payload !== null &&
    "ok" in payload &&
    typeof (payload as { ok: unknown }).ok === "boolean"
  );
}

function isTestPayload(payload: unknown): payload is TestEvidencePayload {
  return (
    typeof payload === "object" &&
    payload !== null &&
    "passed" in payload &&
    typeof (payload as { passed: unknown }).passed === "boolean" &&
    "requirements" in payload &&
    Array.isArray((payload as { requirements: unknown }).requirements)
  );
}

function isVerificationPayload(payload: unknown): payload is VerificationEvidencePayload {
  return (
    typeof payload === "object" &&
    payload !== null &&
    "result" in payload &&
    ((payload as { result: unknown }).result === "holds-in-model" ||
      (payload as { result: unknown }).result === "counterexample" ||
      (payload as { result: unknown }).result === "inconclusive")
  );
}

// ---------------------------------------------------------------------------
// Individual rule evaluators
// ---------------------------------------------------------------------------

function checkDependencyBoundaries(context: PolicyEvaluationContext): PolicyViolation[] {
  const rules = context.policy.dependencyBoundaries;
  if (!rules || rules.length === 0) return [];

  const violations: PolicyViolation[] = [];
  const defs = [...context.candidateIndex.definitions.values()].sort((a, b) =>
    a.qualifiedName.localeCompare(b.qualifiedName),
  );

  for (const def of defs) {
    const matchingRules = rules.filter((rule) => matchesNamespace(def.moduleId, rule.from));
    if (matchingRules.length === 0) continue;

    const depHashes = new Set<DefHash>([...def.dependencies, ...def.formDependencies]);
    for (const depHash of depHashes) {
      const dep = context.candidateIndex.definitions.get(depHash);
      if (!dep) continue;
      if (dep.moduleId === def.moduleId) continue;

      for (const rule of matchingRules) {
        if (rule.deny && rule.deny.some((pat) => matchesNamespace(dep.moduleId, pat))) {
          violations.push({
            rule: "dependency-boundary",
            qualifiedName: def.qualifiedName,
            message: `Dependency boundary violation: '${def.qualifiedName}' (${def.moduleId}) is forbidden from depending on '${dep.qualifiedName}' (${dep.moduleId}).`,
            details: {
              fromNamespace: def.moduleId,
              toNamespace: dep.moduleId,
              dependency: dep.qualifiedName,
              dependencyHash: dep.hash,
              boundaryFrom: rule.from,
              deny: [...rule.deny],
            },
          });
        } else if (rule.allow && !rule.allow.some((pat) => matchesNamespace(dep.moduleId, pat))) {
          violations.push({
            rule: "dependency-boundary",
            qualifiedName: def.qualifiedName,
            message: `Dependency boundary violation: '${def.qualifiedName}' (${def.moduleId}) may not depend on '${dep.qualifiedName}' (${dep.moduleId}); allowed targets: [${rule.allow.join(", ")}].`,
            details: {
              fromNamespace: def.moduleId,
              toNamespace: dep.moduleId,
              dependency: dep.qualifiedName,
              dependencyHash: dep.hash,
              boundaryFrom: rule.from,
              allow: [...rule.allow],
            },
          });
        }
      }
    }
  }

  return violations;
}

function checkCapabilityBudgets(context: PolicyEvaluationContext): PolicyViolation[] {
  const budgets = context.policy.capabilityBudgets;
  if (!budgets || budgets.length === 0) return [];

  const violations: PolicyViolation[] = [];
  const defs = [...context.candidateIndex.definitions.values()].sort((a, b) =>
    a.qualifiedName.localeCompare(b.qualifiedName),
  );

  for (const def of defs) {
    if (def.requirements.length === 0) continue;
    for (const budget of budgets) {
      if (!matchesNamespace(def.moduleId, budget.namespace)) continue;
      const disallowed = def.requirements.filter(
        (req) => !budget.maxRequirements.some((allowed) => capabilityAllowed(req, allowed)),
      );
      if (disallowed.length > 0) {
        violations.push({
          rule: "capability-budget",
          qualifiedName: def.qualifiedName,
          message: `Capability budget exceeded for '${def.qualifiedName}' in namespace '${def.moduleId}': disallowed requirements [${disallowed.join(", ")}] (max allowed: [${budget.maxRequirements.join(", ")}]).`,
          details: {
            namespace: def.moduleId,
            budgetNamespace: budget.namespace,
            disallowedRequirements: disallowed,
            maxRequirements: [...budget.maxRequirements],
          },
        });
      }
    }
  }

  return violations;
}

function checkRequirementEditSeparation(context: PolicyEvaluationContext): PolicyViolation[] {
  const reqPolicy = context.policy.requirementEdit;
  const requireExplicitClass = reqPolicy?.requireExplicitClass ?? true;
  const requireApproval = reqPolicy?.requireApproval ?? false;

  if (!requireExplicitClass && !requireApproval) return [];

  const requirementChanges: Array<{
    readonly qualifiedName: QualifiedName;
    readonly change: "added" | "updated" | "removed" | "renamed" | "contract-weakened";
    readonly reason: string;
  }> = [];

  for (const added of context.diff.added) {
    const def = context.candidateIndex.definitions.get(added.hash);
    if (added.kind === "test" || isRequirementDefinition(def)) {
      requirementChanges.push({
        qualifiedName: added.qualifiedName,
        change: "added",
        reason: `adding requirement/test '${added.qualifiedName}'`,
      });
    }
  }

  for (const removed of context.diff.removed) {
    const def = context.baseIndex.definitions.get(removed.hash);
    if (removed.kind === "test" || isRequirementDefinition(def)) {
      requirementChanges.push({
        qualifiedName: removed.qualifiedName,
        change: "removed",
        reason: `deleting requirement/test '${removed.qualifiedName}'`,
      });
    }
  }

  // Dependents whose DefHash changed solely due to same-interface upstream
  // rebinding (never directly edited by the proposal) are not requirement edits.
  const reboundOnlyNames = new Set<QualifiedName>();
  for (const impact of context.impacts) {
    for (const dep of impact.reboundDependents) {
      reboundOnlyNames.add(dep.qualifiedName);
    }
  }

  for (const updated of context.diff.updated) {
    if (reboundOnlyNames.has(updated.qualifiedName)) continue;
    const before = context.baseIndex.definitions.get(updated.oldHash);
    const after = context.candidateIndex.definitions.get(updated.newHash);
    if (updated.kind === "test" || isRequirementDefinition(before) || isRequirementDefinition(after)) {
      requirementChanges.push({
        qualifiedName: updated.qualifiedName,
        change: "updated",
        reason: `modifying requirement/test '${updated.qualifiedName}'`,
      });
    } else if (hasWeakenedContractClauses(before, after)) {
      requirementChanges.push({
        qualifiedName: updated.qualifiedName,
        change: "contract-weakened",
        reason: `weakening or deleting contract/law clauses on '${updated.qualifiedName}'`,
      });
    }
  }

  for (const renamed of context.diff.renamed) {
    const def = context.baseIndex.definitions.get(renamed.hash) ?? context.candidateIndex.definitions.get(renamed.hash);
    if (isRequirementDefinition(def)) {
      requirementChanges.push({
        qualifiedName: renamed.from,
        change: "renamed",
        reason: `renaming requirement/test '${renamed.from}' to '${renamed.to}'`,
      });
    }
  }

  if (requirementChanges.length === 0) return [];

  const violations: PolicyViolation[] = [];
  const { operationClass, approvedRequirementEdit } = context.proposal;

  if (requireExplicitClass && operationClass !== "requirement-edit") {
    for (const item of requirementChanges) {
      violations.push({
        rule: "requirement-edit",
        qualifiedName: item.qualifiedName,
        message: `Requirement edit rejected under operationClass '${operationClass}': ${item.reason} requires operationClass 'requirement-edit'.`,
        details: {
          operationClass,
          change: item.change,
          requireExplicitClass,
          requireApproval,
        },
      });
    }
    return violations;
  }

  if (requireApproval && !approvedRequirementEdit) {
    for (const item of requirementChanges) {
      violations.push({
        rule: "requirement-edit",
        qualifiedName: item.qualifiedName,
        message: `Requirement edit requires explicit approval: ${item.reason} cannot commit without approvedRequirementEdit: true.`,
        details: {
          operationClass,
          change: item.change,
          requireApproval,
          approvedRequirementEdit: Boolean(approvedRequirementEdit),
        },
      });
    }
  }

  return violations;
}

function checkEvidenceGates(context: PolicyEvaluationContext): PolicyViolation[] {
  const gates = context.policy.evidenceGates;
  if (!gates) return [];

  const rejectInconclusive = gates.rejectInconclusiveVerification ?? true;
  const requireDeterministicTests =
    gates.requireDeterministicTests ?? gates.requiredKinds.includes("test");

  // Collect all newly introduced or updated definitions plus affected dependents.
  const targets = new Map<DefHash, QualifiedName>();
  for (const added of context.diff.added) {
    targets.set(added.hash, added.qualifiedName);
  }
  for (const updated of context.diff.updated) {
    targets.set(updated.newHash, updated.qualifiedName);
  }
  for (const impact of context.impacts) {
    for (const dep of impact.affectedDependents) {
      if (!targets.has(dep.hash)) {
        targets.set(dep.hash, dep.qualifiedName);
      }
    }
  }

  // Also include any test definitions in candidateIndex that depend on a changed definition.
  const changedHashes = new Set<DefHash>([
    ...context.diff.added.map((a) => a.hash),
    ...context.diff.updated.map((u) => u.newHash),
  ]);
  for (const def of context.candidateIndex.definitions.values()) {
    if (def.kind === "test" && def.dependencies.some((d) => changedHashes.has(d))) {
      targets.set(def.hash, def.qualifiedName);
    }
  }

  const violations: PolicyViolation[] = [];

  for (const [hash, qualifiedName] of targets) {
    const records = resolveEvidenceRecords(context.evidence, hash);

    // Check inconclusive or failing verification evidence whenever present.
    if (rejectInconclusive) {
      for (const rec of records) {
        if (rec.key.kind === "verification" && isVerificationPayload(rec.payload)) {
          if (rec.payload.result === "inconclusive") {
            violations.push({
              rule: "evidence-gate",
              qualifiedName,
              message: `Evidence gate rejected '${qualifiedName}': verification evidence returned 'inconclusive', which cannot silently pass.`,
              details: {
                hash,
                kind: "verification",
                result: rec.payload.result,
              },
            });
          } else if (rec.payload.result === "counterexample") {
            violations.push({
              rule: "evidence-gate",
              qualifiedName,
              message: `Evidence gate rejected '${qualifiedName}': verification found a counterexample.`,
              details: {
                hash,
                kind: "verification",
                result: rec.payload.result,
              },
            });
          }
        }
      }
    }

    // Check every required evidence kind.
    for (const requiredKind of gates.requiredKinds) {
      const matching = records.filter((rec) => rec.key.kind === requiredKind);
      if (matching.length === 0) {
        violations.push({
          rule: "evidence-gate",
          qualifiedName,
          message: `Evidence gate rejected '${qualifiedName}': missing required '${requiredKind}' evidence.`,
          details: {
            hash,
            missingKind: requiredKind,
          },
        });
        continue;
      }

      if (requiredKind === "typecheck") {
        const passed = matching.some((rec) => isTypecheckPayload(rec.payload) && rec.payload.ok);
        if (!passed) {
          violations.push({
            rule: "evidence-gate",
            qualifiedName,
            message: `Evidence gate rejected '${qualifiedName}': 'typecheck' evidence did not pass.`,
            details: { hash, kind: "typecheck" },
          });
        }
      } else if (requiredKind === "test") {
        const validTest = matching.some((rec) => {
          if (!isTestPayload(rec.payload) || !rec.payload.passed) return false;
          if (requireDeterministicTests) {
            return (
              rec.trust.deterministic === true &&
              rec.payload.deterministicRunner === true &&
              rec.payload.requirements.length === 0
            );
          }
          return true;
        });
        if (!validTest) {
          violations.push({
            rule: "evidence-gate",
            qualifiedName,
            message: requireDeterministicTests
              ? `Evidence gate rejected '${qualifiedName}': missing passing deterministic test evidence (requires empty requirements and deterministic runner).`
              : `Evidence gate rejected '${qualifiedName}': test evidence did not pass.`,
            details: {
              hash,
              kind: "test",
              requireDeterministicTests,
            },
          });
        }
      } else if (requiredKind === "verification") {
        const holds = matching.some(
          (rec) => isVerificationPayload(rec.payload) && rec.payload.result === "holds-in-model",
        );
        if (!holds) {
          violations.push({
            rule: "evidence-gate",
            qualifiedName,
            message: `Evidence gate rejected '${qualifiedName}': required 'verification' evidence must report 'holds-in-model'.`,
            details: { hash, kind: "verification" },
          });
        }
      }
    }

    // If requireDeterministicTests is enabled independently of requiredKinds, enforce it on test defs and any provided test records.
    if (requireDeterministicTests && !gates.requiredKinds.includes("test")) {
      const def = context.candidateIndex.definitions.get(hash);
      const testRecords = records.filter((rec) => rec.key.kind === "test");
      if (def?.kind === "test" || testRecords.length > 0) {
        const validDeterministic = testRecords.some(
          (rec) =>
            isTestPayload(rec.payload) &&
            rec.payload.passed &&
            rec.trust.deterministic === true &&
            rec.payload.deterministicRunner === true &&
            rec.payload.requirements.length === 0,
        );
        if (!validDeterministic) {
          violations.push({
            rule: "evidence-gate",
            qualifiedName,
            message: `Evidence gate rejected '${qualifiedName}': deterministic test evidence is required (passed, empty requirements, deterministic runner).`,
            details: {
              hash,
              kind: "test",
              requireDeterministicTests: true,
            },
          });
        }
      }
    }
  }

  return violations;
}

function checkEvolutionPolicy(context: PolicyEvaluationContext): PolicyViolation[] {
  const evolution = context.policy.evolution;
  if (!evolution || evolution.publishedNamespaces.length === 0) return [];
  if (context.proposal.waiveEvolution === true) return [];

  const violations: PolicyViolation[] = [];
  const isPublished = (moduleId: string): boolean =>
    evolution.publishedNamespaces.some((ns) => matchesNamespace(moduleId, ns));

  for (const removed of context.diff.removed) {
    const moduleId =
      context.baseIndex.definitions.get(removed.hash)?.moduleId ??
      namespaceOfQualifiedName(removed.qualifiedName);
    if (isPublished(moduleId)) {
      violations.push({
        rule: "evolution",
        qualifiedName: removed.qualifiedName,
        message: `Evolution policy (${evolution.mode}) forbids removing published definition '${removed.qualifiedName}' in namespace '${moduleId}'.`,
        details: {
          mode: evolution.mode,
          namespace: moduleId,
          change: "removed",
        },
      });
    }
  }

  for (const renamed of context.diff.renamed) {
    const moduleId =
      context.baseIndex.definitions.get(renamed.hash)?.moduleId ??
      namespaceOfQualifiedName(renamed.from);
    if (isPublished(moduleId)) {
      violations.push({
        rule: "evolution",
        qualifiedName: renamed.from,
        message: `Evolution policy (${evolution.mode}) forbids renaming published definition '${renamed.from}' to '${renamed.to}' in namespace '${moduleId}'; add a new version instead or pass waiveEvolution.`,
        details: {
          mode: evolution.mode,
          namespace: moduleId,
          change: "renamed",
          to: renamed.to,
        },
      });
    }
  }

  for (const updated of context.diff.updated) {
    const before = context.baseIndex.definitions.get(updated.oldHash);
    const after = context.candidateIndex.definitions.get(updated.newHash);
    const moduleId =
      before?.moduleId ?? after?.moduleId ?? namespaceOfQualifiedName(updated.qualifiedName);
    if (!isPublished(moduleId)) continue;

    if (evolution.mode === "add-only") {
      if (updated.interfaceChanged) {
        violations.push({
          rule: "evolution",
          qualifiedName: updated.qualifiedName,
          message: `Evolution policy (add-only) forbids breaking interface change to published definition '${updated.qualifiedName}' in namespace '${moduleId}'; publish under a new name/version or pass waiveEvolution.`,
          details: {
            mode: evolution.mode,
            namespace: moduleId,
            oldSignature: updated.oldSignature,
            newSignature: updated.newSignature,
            oldRequirements: [...updated.oldRequirements],
            newRequirements: [...updated.newRequirements],
            oldErrors: [...updated.oldErrors],
            newErrors: [...updated.newErrors],
          },
        });
      }
      continue;
    }

    // backward-compatible mode: signature must match, and errors/requirements must not expand.
    const oldReqSet = new Set(updated.oldRequirements);
    const addedRequirements = updated.newRequirements.filter((r) => !oldReqSet.has(r));
    const oldErrSet = new Set(updated.oldErrors);
    const addedErrors = updated.newErrors.filter((e) => !oldErrSet.has(e));
    const signatureChanged =
      updated.oldSignature !== updated.newSignature ||
      (before?.canonicalSignature !== undefined &&
        after?.canonicalSignature !== undefined &&
        before.canonicalSignature !== after.canonicalSignature);

    if (signatureChanged || addedRequirements.length > 0 || addedErrors.length > 0) {
      violations.push({
        rule: "evolution",
        qualifiedName: updated.qualifiedName,
        message: `Evolution policy (backward-compatible) forbids breaking change to published definition '${updated.qualifiedName}' in namespace '${moduleId}'.`,
        details: {
          mode: evolution.mode,
          namespace: moduleId,
          signatureChanged,
          addedRequirements,
          addedErrors,
          oldSignature: updated.oldSignature,
          newSignature: updated.newSignature,
        },
      });
    }
  }

  return violations;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Evaluate all configured `BranchPolicy` rules against a candidate transaction.
 *
 * Enforces:
 * 1. Dependency boundaries between namespaces/modules.
 * 2. Capability budgets (maximum allowed Effect requirement sets per namespace).
 * 3. `impl-edit` vs `requirement-edit` separation (and optional approval gate).
 * 4. Evidence gates (required evidence kinds, deterministic tests, rejecting `inconclusive` verification).
 * 5. Add-only / backward-compatible evolution rules on published namespaces.
 */
export function evaluateBranchPolicies(
  context: PolicyEvaluationContext,
): readonly PolicyViolation[] {
  return [
    ...checkDependencyBoundaries(context),
    ...checkCapabilityBudgets(context),
    ...checkRequirementEditSeparation(context),
    ...checkEvidenceGates(context),
    ...checkEvolutionPolicy(context),
  ];
}

import { describe, expect, it } from "vitest";
import type { ContractSnapshot } from "../../src/contracts/types.js";
import { EvidenceCache } from "../../src/store/evidence-cache.js";
import { buildDefinitionIndexFromSources } from "../../src/store/index-builder.js";
import {
  capabilityAllowed,
  evaluateBranchPolicies,
  hashBranchPolicy,
  matchesNamespace,
  type BranchPolicy,
  type InterfaceImpact,
  type PolicyContractSnapshotPair,
  type PolicyEvaluationContext,
  type PolicyEvidenceSource,
  type PolicySnapshotView,
  type SnapshotDiff,
  type TransactionProposal,
} from "../../src/store/policies.js";
import { computeInputDigest, computeToolchainDigest } from "../../src/store/toolchain-digest.js";
import {
  DEFAULT_LANGUAGE_PROFILE,
  EVIDENCE_FORMAT_VERSION,
  type DefHash,
  type DefinitionIndex,
  type DefinitionRecord,
  type EvidenceKind,
  type EvidenceRecord,
  type VerificationEvidencePayload,
} from "../../src/store/types.js";
import {
  defaultVerificationTrustAccount,
  toVerificationEvidencePayload,
  verifyWorkflowSource,
} from "../../src/verification/bounded-explorer.js";

function makeSnapshot(index: DefinitionIndex, policy: BranchPolicy, hash: string): PolicySnapshotView {
  return {
    hash,
    parent: null,
    bindings: index.bindings,
    metadata: index.metadata,
    policies: hashBranchPolicy(policy),
    policyConfig: policy,
    languageProfile: DEFAULT_LANGUAGE_PROFILE,
  };
}

function makeDiff(baseIndex: DefinitionIndex, candidateIndex: DefinitionIndex): SnapshotDiff {
  const baseByQName = new Map<string, DefinitionRecord>();
  for (const def of baseIndex.definitions.values()) baseByQName.set(def.qualifiedName, def);
  const candByQName = new Map<string, DefinitionRecord>();
  for (const def of candidateIndex.definitions.values()) candByQName.set(def.qualifiedName, def);

  const added: SnapshotDiff["added"][number][] = [];
  const removed: SnapshotDiff["removed"][number][] = [];
  const updated: SnapshotDiff["updated"][number][] = [];

  for (const [qName, def] of candByQName) {
    const prev = baseByQName.get(qName);
    if (!prev) {
      added.push({
        qualifiedName: qName,
        hash: def.hash,
        kind: def.kind,
        signature: def.signature,
      });
    } else if (prev.hash !== def.hash) {
      const interfaceChanged =
        prev.canonicalSignature !== def.canonicalSignature ||
        prev.signature !== def.signature ||
        prev.requirements.join(",") !== def.requirements.join(",") ||
        prev.errors.join(",") !== def.errors.join(",");
      updated.push({
        qualifiedName: qName,
        oldHash: prev.hash,
        newHash: def.hash,
        kind: def.kind,
        interfaceChanged,
        oldSignature: prev.signature,
        newSignature: def.signature,
        oldRequirements: prev.requirements,
        newRequirements: def.requirements,
        oldErrors: prev.errors,
        newErrors: def.errors,
      });
    }
  }

  for (const [qName, def] of baseByQName) {
    if (!candByQName.has(qName)) {
      removed.push({
        qualifiedName: qName,
        hash: def.hash,
        kind: def.kind,
        signature: def.signature,
      });
    }
  }

  return {
    fromSnapshot: "snap:v1:base",
    toSnapshot: "snap:v1:candidate",
    added,
    removed,
    updated,
    renamed: [],
  };
}

function makeContext(opts: {
  baseSources: readonly { id: string; source: string }[];
  candidateSources: readonly { id: string; source: string }[];
  policy: BranchPolicy;
  proposal?: Partial<TransactionProposal>;
  diff?: SnapshotDiff;
  impacts?: readonly InterfaceImpact[];
  evidence?: PolicyEvidenceSource;
  contractSnapshots?: PolicyContractSnapshotPair | readonly PolicyContractSnapshotPair[];
}): PolicyEvaluationContext {
  const baseIndex = buildDefinitionIndexFromSources(opts.baseSources);
  const candidateIndex = buildDefinitionIndexFromSources(opts.candidateSources);
  const diff = opts.diff ?? makeDiff(baseIndex, candidateIndex);
  const proposal: TransactionProposal = {
    branch: "main",
    baseSnapshot: "snap:v1:base",
    operationClass: "impl-edit",
    operations: [],
    ...opts.proposal,
  };
  return {
    proposal,
    policy: opts.policy,
    baseSnapshot: makeSnapshot(baseIndex, opts.policy, "snap:v1:base"),
    baseIndex,
    candidateSnapshot: makeSnapshot(candidateIndex, opts.policy, "snap:v1:candidate"),
    candidateIndex,
    impacts: opts.impacts ?? [],
    diff,
    evidence: opts.evidence,
    contractSnapshots: opts.contractSnapshots,
  };
}

function makeEvidence<TPayload>(
  defHash: DefHash,
  kind: EvidenceKind,
  payload: TPayload,
  deterministic = true,
): EvidenceRecord<TPayload> {
  return {
    formatVersion: EVIDENCE_FORMAT_VERSION,
    key: {
      defHash,
      kind,
      toolchainDigest: "tc:v1:test",
      inputDigest: "in:v1:test",
    },
    trust: {
      producer: "forma-test",
      version: "0.3.0",
      profile: DEFAULT_LANGUAGE_PROFILE,
      deterministic,
    },
    payload,
  };
}

describe("RFC 0029 Stage 3: evaluateBranchPolicies", () => {
  it("matches namespaces and capability patterns predictably", () => {
    expect(matchesNamespace("domain/billing", "domain")).toBe(true);
    expect(matchesNamespace("domain.lisp", "domain")).toBe(true);
    expect(matchesNamespace("domain/billing", "domain/*")).toBe(true);
    expect(matchesNamespace("domain-extra", "domain")).toBe(false);
    expect(matchesNamespace("infra/db", "*")).toBe(true);

    expect(capabilityAllowed("Users.find", "Users")).toBe(true);
    expect(capabilityAllowed("Users.find", "Users.find")).toBe(true);
    expect(capabilityAllowed("Users.save", "Users.find")).toBe(false);
    expect(capabilityAllowed("Db.query", "*")).toBe(true);
  });

  describe("Rule 1: Dependency boundaries", () => {
    const infraSource = `(export db-fetch)
(define db-fetch [id] id)`;

    const domainViolating = `(import "./infra/db.lisp" [db-fetch])
(define load-order [id] (db-fetch id))`;

    const domainClean = `(define calc-total [a b] (+ a b))`;

    it("rejects forbidden dependency edges via deny list", () => {
      const ctx = makeContext({
        baseSources: [
          { id: "infra/db.lisp", source: infraSource },
          { id: "domain/order.lisp", source: domainClean },
        ],
        candidateSources: [
          { id: "infra/db.lisp", source: infraSource },
          { id: "domain/order.lisp", source: domainViolating },
        ],
        policy: {
          dependencyBoundaries: [{ from: "domain", deny: ["infra"] }],
        },
      });

      const violations = evaluateBranchPolicies(ctx);
      expect(violations).toHaveLength(1);
      expect(violations[0]).toMatchObject({
        rule: "dependency-boundary",
        qualifiedName: "domain/order.lisp::load-order",
        details: {
          fromNamespace: "domain/order.lisp",
          toNamespace: "infra/db.lisp",
        },
      });
    });

    it("enforces allow-only dependency boundaries and permits allowed edges", () => {
      const sharedSource = `(export tax-rate)
(define tax-rate 10)`;
      const domainUsingShared = `(import "./shared/math.lisp" [tax-rate])
(define total-with-tax [x] (+ x tax-rate))`;

      const allowedCtx = makeContext({
        baseSources: [{ id: "shared/math.lisp", source: sharedSource }],
        candidateSources: [
          { id: "shared/math.lisp", source: sharedSource },
          { id: "domain/order.lisp", source: domainUsingShared },
        ],
        policy: {
          dependencyBoundaries: [{ from: "domain", allow: ["shared"] }],
        },
      });
      expect(evaluateBranchPolicies(allowedCtx)).toEqual([]);

      const forbiddenCtx = makeContext({
        baseSources: [{ id: "infra/db.lisp", source: infraSource }],
        candidateSources: [
          { id: "infra/db.lisp", source: infraSource },
          { id: "domain/order.lisp", source: domainViolating },
        ],
        policy: {
          dependencyBoundaries: [{ from: "domain", allow: ["shared"] }],
        },
      });
      const violations = evaluateBranchPolicies(forbiddenCtx);
      expect(violations).toHaveLength(1);
      expect(violations[0]?.rule).toBe("dependency-boundary");
    });
  });

  describe("Rule 2: Capability budgets", () => {
    const servicesSource = `(export Db Clock Http)
(service Db (: query (-> String (Effect String))))
(service Clock (: now (-> Unit (Effect Int))))
(service Http (: get (-> String (Effect String))))`;

    it("rejects network/DB capabilities in pure domain namespaces", () => {
      const pureDomainWithDb = `(import "./services.lisp" [Db Clock])
(: get-record (-> String (Effect String [] [Db.query])))
(define get-record [k] (Db.query k))`;

      const ctx = makeContext({
        baseSources: [{ id: "services.lisp", source: servicesSource }],
        candidateSources: [
          { id: "services.lisp", source: servicesSource },
          { id: "domain/billing.lisp", source: pureDomainWithDb },
        ],
        policy: {
          capabilityBudgets: [{ namespace: "domain", maxRequirements: [] }],
        },
      });

      const violations = evaluateBranchPolicies(ctx);
      expect(violations).toHaveLength(1);
      expect(violations[0]).toMatchObject({
        rule: "capability-budget",
        qualifiedName: "domain/billing.lisp::get-record",
        details: {
          disallowedRequirements: ["Db.query"],
          maxRequirements: [],
        },
      });
    });

    it("allows capabilities within the namespace budget and rejects operations outside it", () => {
      const appWithClockAndHttp = `(import "./services.lisp" [Clock Http])
(: ok-fn (-> Unit (Effect Int [] [Clock.now])))
(define ok-fn [_] (Clock.now))
(: bad-fn (-> String (Effect String [] [Http.get])))
(define bad-fn [u] (Http.get u))`;

      const ctx = makeContext({
        baseSources: [{ id: "services.lisp", source: servicesSource }],
        candidateSources: [
          { id: "services.lisp", source: servicesSource },
          { id: "app/service.lisp", source: appWithClockAndHttp },
        ],
        policy: {
          capabilityBudgets: [{ namespace: "app", maxRequirements: ["Clock"] }],
        },
      });

      const violations = evaluateBranchPolicies(ctx);
      expect(violations).toHaveLength(1);
      expect(violations[0]).toMatchObject({
        rule: "capability-budget",
        qualifiedName: "app/service.lisp::bad-fn",
        details: {
          disallowedRequirements: ["Http.get"],
        },
      });
    });
  });

  describe("Rule 3: impl-edit vs requirement-edit separation", () => {
    const baseWithTest = `(define double [x] (* x 2))
(test double-works (= (double 3) 6))`;

    const modifiedTest = `(define double [x] (* x 2))
(test double-works (= (double 3) 5))`;

    const deletedTest = `(define double [x] (* x 2))`;

    it("rejects modifying or deleting tests under impl-edit", () => {
      const modCtx = makeContext({
        baseSources: [{ id: "math.lisp", source: baseWithTest }],
        candidateSources: [{ id: "math.lisp", source: modifiedTest }],
        policy: { requirementEdit: { requireExplicitClass: true, requireApproval: true } },
        proposal: { operationClass: "impl-edit" },
      });
      expect(evaluateBranchPolicies(modCtx)).toEqual([
        expect.objectContaining({
          rule: "requirement-edit",
          qualifiedName: "math.lisp::double-works",
        }),
      ]);

      const delCtx = makeContext({
        baseSources: [{ id: "math.lisp", source: baseWithTest }],
        candidateSources: [{ id: "math.lisp", source: deletedTest }],
        policy: { requirementEdit: { requireExplicitClass: true } },
        proposal: { operationClass: "impl-edit" },
      });
      expect(evaluateBranchPolicies(delCtx)).toEqual([
        expect.objectContaining({
          rule: "requirement-edit",
          qualifiedName: "math.lisp::double-works",
        }),
      ]);
    });

    it("requires approvedRequirementEdit when requireApproval is true", () => {
      const unapprovedCtx = makeContext({
        baseSources: [{ id: "math.lisp", source: baseWithTest }],
        candidateSources: [{ id: "math.lisp", source: modifiedTest }],
        policy: { requirementEdit: { requireExplicitClass: true, requireApproval: true } },
        proposal: { operationClass: "requirement-edit", approvedRequirementEdit: false },
      });
      expect(evaluateBranchPolicies(unapprovedCtx)).toEqual([
        expect.objectContaining({
          rule: "requirement-edit",
          message: expect.stringContaining("approvedRequirementEdit"),
        }),
      ]);

      const approvedCtx = makeContext({
        baseSources: [{ id: "math.lisp", source: baseWithTest }],
        candidateSources: [{ id: "math.lisp", source: modifiedTest }],
        policy: { requirementEdit: { requireExplicitClass: true, requireApproval: true } },
        proposal: { operationClass: "requirement-edit", approvedRequirementEdit: true },
      });
      expect(evaluateBranchPolicies(approvedCtx)).toEqual([]);
    });

    it("rejects weakening embedded contract clauses under impl-edit", () => {
      const baseIndex = buildDefinitionIndexFromSources([
        { id: "account.lisp", source: `(define withdraw [amt] amt)` },
      ]);
      const candIndex = buildDefinitionIndexFromSources([
        { id: "account.lisp", source: `(define withdraw [amt] (+ amt 0))` },
      ]);
      const baseRec = [...baseIndex.definitions.values()][0]!;
      const candRec = [...candIndex.definitions.values()][0]!;

      // Inject authored contract clauses on baseRec and remove them in candRec.
      const baseWithContract: DefinitionRecord = {
        ...baseRec,
        meta: {
          ...baseRec.meta,
          authoredSource: `(define withdraw [amt] :requires (> amt 0) :ensures (>= result 0) amt)`,
        },
      };
      const candWithoutContract: DefinitionRecord = {
        ...candRec,
        meta: {
          ...candRec.meta,
          authoredSource: `(define withdraw [amt] (+ amt 0))`,
        },
      };

      const patchedBase: DefinitionIndex = {
        ...baseIndex,
        definitions: new Map([[baseWithContract.hash, baseWithContract]]),
      };
      const patchedCand: DefinitionIndex = {
        ...candIndex,
        definitions: new Map([[candWithoutContract.hash, candWithoutContract]]),
      };
      const policy: BranchPolicy = { requirementEdit: { requireExplicitClass: true } };
      const diff = makeDiff(patchedBase, patchedCand);
      const violations = evaluateBranchPolicies({
        proposal: {
          branch: "main",
          baseSnapshot: "snap:v1:base",
          operationClass: "impl-edit",
          operations: [],
        },
        policy,
        baseSnapshot: makeSnapshot(patchedBase, policy, "snap:v1:base"),
        baseIndex: patchedBase,
        candidateSnapshot: makeSnapshot(patchedCand, policy, "snap:v1:cand"),
        candidateIndex: patchedCand,
        impacts: [],
        diff,
      });

      expect(violations).toHaveLength(1);
      expect(violations[0]).toMatchObject({
        rule: "requirement-edit",
        qualifiedName: "account.lisp::withdraw",
      });
    });
  });

  describe("Rule 4: Evidence gates", () => {
    const baseSrc = `(define inc [x] (+ x 1))`;
    const nextSrc = `(define inc [x] (+ 1 x))`;

    it("rejects missing required evidence kinds and passes when all gates are satisfied", () => {
      const ctxMissing = makeContext({
        baseSources: [{ id: "m.lisp", source: baseSrc }],
        candidateSources: [{ id: "m.lisp", source: nextSrc }],
        policy: {
          evidenceGates: {
            requiredKinds: ["typecheck", "test"],
            requireDeterministicTests: true,
          },
        },
      });
      const missingViolations = evaluateBranchPolicies(ctxMissing);
      expect(missingViolations).toHaveLength(2);
      expect(missingViolations.map((v) => v.rule)).toEqual(["evidence-gate", "evidence-gate"]);

      const candHash = [...ctxMissing.candidateIndex.definitions.values()][0]!.hash;
      const evidence = new Map<DefHash, readonly EvidenceRecord[]>([
        [
          candHash,
          [
            makeEvidence(candHash, "typecheck", {
              ok: true,
              requirements: [],
              errors: [],
              diagnostics: [],
            }),
            makeEvidence(candHash, "test", {
              passed: true,
              requirements: [],
              runnerProfile: "pure-local-v1",
              deterministicRunner: true,
            }),
          ],
        ],
      ]);

      const ctxOk = makeContext({
        baseSources: [{ id: "m.lisp", source: baseSrc }],
        candidateSources: [{ id: "m.lisp", source: nextSrc }],
        policy: {
          evidenceGates: {
            requiredKinds: ["typecheck", "test"],
            requireDeterministicTests: true,
          },
        },
        evidence,
      });
      expect(evaluateBranchPolicies(ctxOk)).toEqual([]);
    });

    it("rejects inconclusive verification results and non-deterministic test evidence", () => {
      const baseCtx = makeContext({
        baseSources: [{ id: "m.lisp", source: baseSrc }],
        candidateSources: [{ id: "m.lisp", source: nextSrc }],
        policy: {
          evidenceGates: {
            requiredKinds: ["test"],
            rejectInconclusiveVerification: true,
            requireDeterministicTests: true,
          },
        },
      });
      const candHash = [...baseCtx.candidateIndex.definitions.values()][0]!.hash;
      const badEvidence = new Map<DefHash, readonly EvidenceRecord[]>([
        [
          candHash,
          [
            makeEvidence(
              candHash,
              "test",
              {
                passed: true,
                requirements: ["Clock.now"],
                runnerProfile: "live-io",
                deterministicRunner: false,
              },
              false,
            ),
            makeEvidence(candHash, "verification", {
              result: "inconclusive",
              bounds: { maxSteps: 10 },
              assumptions: [],
            }),
          ],
        ],
      ]);

      const violations = evaluateBranchPolicies({
        ...baseCtx,
        evidence: badEvidence,
      });
      expect(violations).toHaveLength(2);
      expect(violations.some((v) => v.message.includes("inconclusive"))).toBe(true);
      expect(violations.some((v) => v.message.includes("deterministic"))).toBe(true);
    });
  });

  describe("Rule 5: Add-only / evolution rules on published namespaces", () => {
    const pubBase = `(error NotFound {:id String})
(error Timeout {:ms Int})
(: fetch-item (-> String (Effect String [NotFound] [])))
(define fetch-item [id] (succeed id))`;

    const pubBreaking = `(error NotFound {:id String})
(error Timeout {:ms Int})
(: fetch-item (-> String (Effect String [NotFound Timeout] [])))
(define fetch-item [id] (succeed id))`;

    const pubNewVersion = `${pubBase}
(: fetch-item-v2 (-> String (Effect String [NotFound Timeout] [])))
(define fetch-item-v2 [id] (succeed id))`;

    it("rejects breaking interface changes on published namespaces under add-only and backward-compatible modes", () => {
      const addOnlyCtx = makeContext({
        baseSources: [{ id: "public/api.lisp", source: pubBase }],
        candidateSources: [{ id: "public/api.lisp", source: pubBreaking }],
        policy: {
          evolution: { publishedNamespaces: ["public"], mode: "add-only" },
        },
      });
      expect(evaluateBranchPolicies(addOnlyCtx)).toEqual([
        expect.objectContaining({
          rule: "evolution",
          qualifiedName: "public/api.lisp::fetch-item",
        }),
      ]);

      const backCompatCtx = makeContext({
        baseSources: [{ id: "public/api.lisp", source: pubBase }],
        candidateSources: [{ id: "public/api.lisp", source: pubBreaking }],
        policy: {
          evolution: { publishedNamespaces: ["public"], mode: "backward-compatible" },
        },
      });
      expect(evaluateBranchPolicies(backCompatCtx)).toEqual([
        expect.objectContaining({
          rule: "evolution",
          qualifiedName: "public/api.lisp::fetch-item",
          details: expect.objectContaining({
            addedErrors: ["Timeout"],
          }),
        }),
      ]);
    });

    it("allows adding a new versioned name or explicitly waiving evolution", () => {
      const newVersionCtx = makeContext({
        baseSources: [{ id: "public/api.lisp", source: pubBase }],
        candidateSources: [{ id: "public/api.lisp", source: pubNewVersion }],
        policy: {
          evolution: { publishedNamespaces: ["public"], mode: "add-only" },
        },
      });
      expect(evaluateBranchPolicies(newVersionCtx)).toEqual([]);

      const waivedCtx = makeContext({
        baseSources: [{ id: "public/api.lisp", source: pubBase }],
        candidateSources: [{ id: "public/api.lisp", source: pubBreaking }],
        policy: {
          evolution: { publishedNamespaces: ["public"], mode: "add-only" },
        },
        proposal: { waiveEvolution: true },
      });
      expect(evaluateBranchPolicies(waivedCtx)).toEqual([]);
    });

    it("enforces RFC 0027 directional contract diffs (rejects incompatible/unknown, allows metadataOnlyChange and waivers)", () => {
      const jsonCodec = { name: "json", version: "1.0", unknownFieldPolicy: "ignore" as const };
      const oldSnapshot: ContractSnapshot = {
        revision: "rev-1",
        contractId: "order-api:v1",
        codec: jsonCodec,
        rootType: "Order",
        types: {
          Order: {
            kind: "record",
            fields: [
              { name: "id", type: { kind: "primitive", primitive: "string" } },
            ],
          },
        },
      };
      const metadataOnlySnapshot: ContractSnapshot = {
        ...oldSnapshot,
        revision: "rev-2",
        contractId: "order-api:v1-docs",
        metadata: { doc: "Clarified order identifier docs" },
      };
      const incompatibleSnapshot: ContractSnapshot = {
        ...oldSnapshot,
        revision: "rev-3",
        types: {
          Order: {
            kind: "record",
            fields: [
              { name: "id", type: { kind: "primitive", primitive: "string" } },
              { name: "currency", type: { kind: "primitive", primitive: "string" } },
            ],
          },
        },
      };
      const unknownSnapshot: ContractSnapshot = {
        ...oldSnapshot,
        revision: "rev-4",
        codec: { name: "custom-opaque", version: "1.0", opaque: true },
      };

      const evolutionPolicy: BranchPolicy = {
        evolution: { publishedNamespaces: ["public"], mode: "backward-compatible" },
      };

      // Metadata-only change passes without false positives.
      const metaCtx = makeContext({
        baseSources: [{ id: "public/api.lisp", source: pubBase }],
        candidateSources: [{ id: "public/api.lisp", source: pubBase }],
        policy: evolutionPolicy,
        contractSnapshots: {
          qualifiedName: "public/api.lisp::Order",
          oldSnapshot,
          newSnapshot: metadataOnlySnapshot,
        },
      });
      expect(evaluateBranchPolicies(metaCtx)).toEqual([]);

      // Incompatible contract diff fails the evolution gate unless waived.
      const incompatCtx = makeContext({
        baseSources: [{ id: "public/api.lisp", source: pubBase }],
        candidateSources: [{ id: "public/api.lisp", source: pubBase }],
        policy: evolutionPolicy,
        contractSnapshots: {
          qualifiedName: "public/api.lisp::Order",
          oldSnapshot,
          newSnapshot: incompatibleSnapshot,
        },
      });
      expect(evaluateBranchPolicies(incompatCtx)).toEqual([
        expect.objectContaining({
          rule: "evolution",
          qualifiedName: "public/api.lisp::Order",
          details: expect.objectContaining({
            source: "rfc-0027-contract-diff",
            verdict: "incompatible",
          }),
        }),
      ]);

      // Unknown compatibility verdict also fails the evolution gate unless waived.
      const unknownCtx = makeContext({
        baseSources: [{ id: "public/api.lisp", source: pubBase }],
        candidateSources: [{ id: "public/api.lisp", source: pubBase }],
        policy: evolutionPolicy,
        contractSnapshots: {
          qualifiedName: "public/api.lisp::Order",
          oldSnapshot,
          newSnapshot: unknownSnapshot,
        },
      });
      expect(evaluateBranchPolicies(unknownCtx)).toEqual([
        expect.objectContaining({
          rule: "evolution",
          qualifiedName: "public/api.lisp::Order",
          details: expect.objectContaining({
            source: "rfc-0027-contract-diff",
            verdict: "unknown",
          }),
        }),
      ]);

      // Explicit waiveEvolution bypasses the contract diff evolution gate.
      const waivedContractCtx = makeContext({
        baseSources: [{ id: "public/api.lisp", source: pubBase }],
        candidateSources: [{ id: "public/api.lisp", source: pubBase }],
        policy: evolutionPolicy,
        proposal: { waiveEvolution: true },
        contractSnapshots: {
          qualifiedName: "public/api.lisp::Order",
          oldSnapshot,
          newSnapshot: unknownSnapshot,
        },
      });
      expect(evaluateBranchPolicies(waivedContractCtx)).toEqual([]);
    });
  });

  describe("RFC 0028 -> EvidenceCache -> evaluateBranchPolicies integration", () => {
    const safeWorkflow = `(workflow-model ReleaseGate
  (initial {:authorized false :released false})
  (transition authorize
    :guard (not state.authorized)
    :update (assoc state :authorized true))
  (transition release
    :guard state.authorized
    :update (assoc state :released true))
  (law release-requires-auth
    :when state.released
    :holds state.authorized))`;

    const buggyWorkflow = `(workflow-model BuggyReleaseGate
  (initial {:authorized false :released false})
  (transition release-unchecked
    :guard (not state.released)
    :update (assoc state :released true))
  (law release-requires-auth
    :when state.released
    :holds state.authorized))`;

    function cacheVerificationReport(
      defHash: DefHash,
      source: string,
      maxDepth?: number,
    ): EvidenceCache {
      const report = verifyWorkflowSource(source, {
        sourceId: "workflow.lisp",
        ...(maxDepth !== undefined ? { maxDepth } : {}),
      });
      const cache = new EvidenceCache();
      const record: EvidenceRecord<VerificationEvidencePayload> = {
        formatVersion: EVIDENCE_FORMAT_VERSION,
        key: {
          defHash,
          kind: "verification",
          toolchainDigest: computeToolchainDigest({}),
          inputDigest: computeInputDigest({ modelHash: report.modelHash, maxDepth: maxDepth ?? null }),
        },
        trust: defaultVerificationTrustAccount(report),
        payload: toVerificationEvidencePayload(report),
      };
      cache.set(record);
      return cache;
    }

    it("passes holds-in-model and rejects counterexample and inconclusive verification from EvidenceCache", () => {
      const baseSrc = `(define release-step [x] (+ x 1))`;
      const nextSrc = `(define release-step [x] (+ 1 x))`;
      const policy: BranchPolicy = {
        evidenceGates: {
          requiredKinds: ["verification"],
          rejectInconclusiveVerification: true,
        },
      };

      const baseCtx = makeContext({
        baseSources: [{ id: "workflow.lisp", source: baseSrc }],
        candidateSources: [{ id: "workflow.lisp", source: nextSrc }],
        policy,
      });
      const candHash = [...baseCtx.candidateIndex.definitions.values()][0]!.hash;

      // 1. Safe workflow -> holds-in-model passes the verification evidence gate.
      const okCache = cacheVerificationReport(candHash, safeWorkflow);
      expect(
        evaluateBranchPolicies({
          ...baseCtx,
          evidence: (hash) => okCache.summary(hash),
        }),
      ).toEqual([]);

      // 2. Buggy workflow -> counterexample is rejected by the evidence gate.
      const cexCache = cacheVerificationReport(candHash, buggyWorkflow);
      const cexViolations = evaluateBranchPolicies({
        ...baseCtx,
        evidence: (hash) => cexCache.summary(hash),
      });
      expect(cexViolations.some((v) => v.rule === "evidence-gate" && v.message.includes("counterexample"))).toBe(true);

      // 3. Depth-truncated exploration -> inconclusive is rejected by the evidence gate.
      const incCache = cacheVerificationReport(candHash, safeWorkflow, 0);
      const incViolations = evaluateBranchPolicies({
        ...baseCtx,
        evidence: (hash) => incCache.summary(hash),
      });
      expect(incViolations.some((v) => v.rule === "evidence-gate" && v.message.includes("inconclusive"))).toBe(true);
    });
  });
});

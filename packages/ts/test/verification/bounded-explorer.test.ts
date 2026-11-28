import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { checkPrelude, preludeSource } from "../../src/Preludes.js";
import {
  EvidenceCache,
  checkEvidenceCacheability,
} from "../../src/store/evidence-cache.js";
import {
  computeInputDigest,
  computeToolchainDigest,
} from "../../src/store/toolchain-digest.js";
import {
  EVIDENCE_FORMAT_VERSION,
  type EvidenceRecord,
  type VerificationEvidencePayload,
} from "../../src/store/types.js";
import {
  TRANSITION_SEMANTICS_VERSION,
  bootstrapWorkflowLawsPrelude,
  defaultVerificationTrustAccount,
  toVerificationEvidencePayload,
  verifyWorkflowSource,
} from "../../src/verification/bounded-explorer.js";

const workflowLawsPreludePath = resolve(
  import.meta.dirname,
  "../../../../preludes/workflow-laws.lisp",
);
const workflowLawsSource = readFileSync(workflowLawsPreludePath, "utf8");
const workflowLawsPrelude = bootstrapWorkflowLawsPrelude(workflowLawsSource);

interface ControlModelFlags {
  readonly checkFreshness?: boolean;
  readonly checkWorkerMatch?: boolean;
  readonly checkPolicyMatch?: boolean;
  readonly checkIssuerAuth?: boolean;
  readonly allowUntrustedIssuance?: boolean;
  readonly includeVacuousLaw?: boolean;
  readonly includeUnreachableRelease?: boolean;
}

/**
 * Build the RFC 0028 control workflow model in ordinary Forma syntax using
 * `preludes/workflow-laws.lisp`:
 * - 2 workers ("w1", "w2"), 2 policy identities ("p1", "p2"), 2 fact revisions ("v1", "v2")
 * - Transitions: evaluate, invalidate, retry, release
 * - Evidence records: issuer, worker, policy, revision
 * - Central invariant: every successful release has authorized evidence for the
 *   same worker and policy at the current revision.
 */
function buildControlModelSource(flags: ControlModelFlags = {}): string {
  const {
    checkFreshness = true,
    checkWorkerMatch = true,
    checkPolicyMatch = true,
    checkIssuerAuth = true,
    allowUntrustedIssuance = false,
    includeVacuousLaw = false,
    includeUnreachableRelease = false,
  } = flags;

  const evaluateIssuerGuard = allowUntrustedIssuance
    ? "true"
    : '(= issuer "trusted")';

  const releaseGuards: string[] = [
    '(not (nil? (get state.workers worker)))',
    '(= (get (get state.workers worker) :status) "ready")',
    '(not (nil? (get state.evidencePool evidenceWorker)))',
  ];
  if (checkIssuerAuth) {
    releaseGuards.push(
      '(= (get (get state.evidencePool evidenceWorker) :issuer) "trusted")',
    );
  }
  if (checkWorkerMatch) {
    releaseGuards.push(
      '(= (get (get state.evidencePool evidenceWorker) :worker) worker)',
    );
  }
  if (checkPolicyMatch) {
    releaseGuards.push(
      '(= (get (get state.evidencePool evidenceWorker) :policy) policy)',
    );
  }
  if (checkFreshness) {
    releaseGuards.push(
      '(= (get (get state.evidencePool evidenceWorker) :revision) state.revision)',
    );
  }

  const extraItems: string[] = [];
  if (includeUnreachableRelease) {
    extraItems.push(`
  (transition unreachable-release
    :params {:worker Worker :policy Policy}
    :guard false
    :update (assoc state :lastRelease {:worker worker :policy policy :evidence nil :revisionAtRelease state.revision}))`);
  }
  if (includeVacuousLaw) {
    extraItems.push(`
  (law vacuous-future-revision
    :description "Premise only triggers on a revision outside the declared domain."
    :when (= state.revision "v99")
    :holds false)`);
  }

  return `
(workflow-model EvidenceReleaseControl
  :assumptions [
    "Finite domains: 2 workers (w1, w2), 2 policies (p1, p2), 2 fact revisions (v1, v2)."
    "Freshness is modeled as equality of explicit revision identities, not an unbounded clock."
    "Single-step atomic transitions; runtime issuance authenticity and commit atomicity belong to host boundaries (RFCs 0012/0016)."
  ]
  (domain Worker ["w1" "w2"])
  (domain Policy ["p1" "p2"])
  (domain Revision ["v1" "v2"])
  (domain Issuer ["trusted" "untrusted"])

  (initial {
    :revision "v1"
    :workers {
      :w1 {:status "idle"}
      :w2 {:status "idle"}
    }
    :evidencePool {
      :w1 nil
      :w2 nil
    }
    :lastRelease nil
  })

  (transition evaluate
    :params {:worker Worker :policy Policy :issuer Issuer}
    :guard (and
      (= (get (get state.workers worker) :status) "idle")
      ${evaluateIssuerGuard})
    :update (let [ev {:issuer issuer :worker worker :policy policy :revision state.revision}]
      (assoc state
        :workers (assoc state.workers worker {:status "ready"})
        :evidencePool (assoc state.evidencePool worker ev))))

  (transition invalidate
    :guard (= state.revision "v1")
    :update (let [w1Status (get (get state.workers :w1) :status)
                  w2Status (get (get state.workers :w2) :status)
                  nextW1 (if (= w1Status "ready") {:status "needs-retry"} (get state.workers :w1))
                  nextW2 (if (= w2Status "ready") {:status "needs-retry"} (get state.workers :w2))]
      (assoc state
        :revision "v2"
        :workers {:w1 nextW1 :w2 nextW2})))

  (transition retry
    :params {:worker Worker}
    :guard (= (get (get state.workers worker) :status) "needs-retry")
    :update (assoc state
      :workers (assoc state.workers worker {:status "ready"})))

  (transition release
    :params {:worker Worker :policy Policy :evidenceWorker Worker}
    :guard (and ${releaseGuards.join("\n      ")})
    :update (let [ev (get state.evidencePool evidenceWorker)]
      (assoc state
        :workers (assoc state.workers worker {:status "released"})
        :lastRelease {:worker worker :policy policy :evidence ev :revisionAtRelease state.revision})))
${extraItems.join("\n")}

  (law release-has-fresh-authorized-evidence
    :description "Every successful release must have authorized evidence for the same worker and policy at the current revision."
    :when (not (nil? state.lastRelease))
    :holds (let [rel state.lastRelease
                 ev rel.evidence]
      (and
        (not (nil? ev))
        (= ev.issuer "trusted")
        (= ev.worker rel.worker)
        (= ev.policy rel.policy)
        (= ev.revision rel.revisionAtRelease)))))
`;
}

describe("RFC 0028 Stage 1: workflow-laws prelude & bounded fixed-point explorer", () => {
  it("validates preludes/workflow-laws.lisp with checkPrelude (docstrings, IR types, examples)", () => {
    const result = checkPrelude(
      [{ sourceId: "workflow-laws.lisp", source: workflowLawsSource }],
      {
        dependencies: [
          { sourceId: "compiler.lisp", source: preludeSource("compiler.lisp") },
        ],
      },
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.forms).toBe(5);
    expect(result.examples).toBeGreaterThanOrEqual(5);
  });

  it("Control 1: removing freshness guard recovers shortest trace evaluate(v1) -> invalidate(to v2) -> retry -> release(with v1)", () => {
    const source = buildControlModelSource({ checkFreshness: false });
    const report = verifyWorkflowSource(source, {
      prelude: workflowLawsPrelude,
      sourceId: "control-1-freshness.lisp",
    });

    expect(report.verdict).toBe("counterexample");
    expect(report.fixedPointReached).toBe(false);
    expect(report.counterexample).toBeDefined();

    const trace = report.counterexample!;
    expect(trace.violatedLaw).toBe("release-has-fresh-authorized-evidence");
    expect(trace.length).toBe(4);
    expect(trace.steps.map((s) => s.transition)).toEqual([
      "evaluate",
      "invalidate",
      "retry",
      "release",
    ]);

    // Step 1: evaluate at v1
    expect(trace.steps[0]!.params["issuer"]).toBe("trusted");
    expect((trace.steps[0]!.toState as Record<string, unknown>)["revision"]).toBe("v1");
    // Step 2: invalidate to v2
    expect((trace.steps[1]!.toState as Record<string, unknown>)["revision"]).toBe("v2");
    // Step 3: retry
    expect(trace.steps[2]!.transition).toBe("retry");
    // Step 4: release with stale v1 evidence at revision v2
    const lastRelease = (trace.violatingState as Record<string, unknown>)[
      "lastRelease"
    ] as Record<string, unknown>;
    expect(lastRelease["revisionAtRelease"]).toBe("v2");
    expect((lastRelease["evidence"] as Record<string, unknown>)["revision"]).toBe("v1");

    // Every step links back to its authored transition span in the Lisp source.
    for (const step of trace.steps) {
      expect(step.transitionSpan).toBeDefined();
      expect(step.transitionSpan!.sourceId).toBe("control-1-freshness.lisp");
      expect(step.transitionSpan!.endOffset).toBeGreaterThan(
        step.transitionSpan!.startOffset,
      );
      const snippet = source.slice(
        step.transitionSpan!.startOffset,
        step.transitionSpan!.endOffset,
      );
      expect(snippet).toContain(`(transition ${step.transition}`);
    }
  });

  it("Control 2a: removing worker-match guard exposes worker swap mismatch", () => {
    const source = buildControlModelSource({ checkWorkerMatch: false });
    const report = verifyWorkflowSource(source, {
      prelude: workflowLawsPrelude,
      sourceId: "control-2a-worker.lisp",
    });

    expect(report.verdict).toBe("counterexample");
    const trace = report.counterexample!;
    expect(trace.violatedLaw).toBe("release-has-fresh-authorized-evidence");
    const lastRelease = (trace.violatingState as Record<string, unknown>)[
      "lastRelease"
    ] as Record<string, unknown>;
    const ev = lastRelease["evidence"] as Record<string, unknown>;
    expect(ev["worker"]).not.toBe(lastRelease["worker"]);
    // Freshness, policy, and issuer all still match — strictly a worker mismatch.
    expect(ev["policy"]).toBe(lastRelease["policy"]);
    expect(ev["revision"]).toBe(lastRelease["revisionAtRelease"]);
    expect(ev["issuer"]).toBe("trusted");
  });

  it("Control 2b: removing policy-match guard exposes policy swap mismatch", () => {
    const source = buildControlModelSource({ checkPolicyMatch: false });
    const report = verifyWorkflowSource(source, {
      prelude: workflowLawsPrelude,
      sourceId: "control-2b-policy.lisp",
    });

    expect(report.verdict).toBe("counterexample");
    const trace = report.counterexample!;
    expect(trace.violatedLaw).toBe("release-has-fresh-authorized-evidence");
    const lastRelease = (trace.violatingState as Record<string, unknown>)[
      "lastRelease"
    ] as Record<string, unknown>;
    const ev = lastRelease["evidence"] as Record<string, unknown>;
    expect(ev["policy"]).not.toBe(lastRelease["policy"]);
    // Freshness, worker, and issuer all still match — strictly a policy mismatch.
    expect(ev["worker"]).toBe(lastRelease["worker"]);
    expect(ev["revision"]).toBe(lastRelease["revisionAtRelease"]);
    expect(ev["issuer"]).toBe("trusted");
  });

  it("Control 3: unauthorized issuance is caught by the safety invariant", () => {
    const source = buildControlModelSource({
      allowUntrustedIssuance: true,
      checkIssuerAuth: false,
    });
    const report = verifyWorkflowSource(source, {
      prelude: workflowLawsPrelude,
      sourceId: "control-3-untrusted.lisp",
    });

    expect(report.verdict).toBe("counterexample");
    const trace = report.counterexample!;
    expect(trace.violatedLaw).toBe("release-has-fresh-authorized-evidence");
    const lastRelease = (trace.violatingState as Record<string, unknown>)[
      "lastRelease"
    ] as Record<string, unknown>;
    const ev = lastRelease["evidence"] as Record<string, unknown>;
    expect(ev["issuer"]).toBe("untrusted");
    expect(ev["worker"]).toBe(lastRelease["worker"]);
    expect(ev["policy"]).toBe(lastRelease["policy"]);
    expect(ev["revision"]).toBe(lastRelease["revisionAtRelease"]);
  });

  it("Control 4: restoring all guards completes fixed-point exploration as holds-in-model", () => {
    const source = buildControlModelSource();
    const report = verifyWorkflowSource(source, {
      prelude: workflowLawsPrelude,
      sourceId: "control-4-safe.lisp",
      maxStates: 25_000,
      maxEdges: 250_000,
    });

    expect(report.verdict).toBe("holds-in-model");
    expect(report.fixedPointReached).toBe(true);
    expect(report.counterexample).toBeUndefined();
    expect(report.unsupportedOperations).toEqual([]);

    // Explicit provenance, hashes, semantics version, trust account, and counts.
    expect(report.modelName).toBe("EvidenceReleaseControl");
    expect(report.modelHash).toMatch(/^workflow-model:v1:[0-9a-f]{64}$/);
    expect(report.sourceHash).toMatch(/^workflow-source:v1:[0-9a-f]{64}$/);
    expect(report.transitionSemanticsVersion).toBe(TRANSITION_SEMANTICS_VERSION);
    expect(report.trustedComponents.length).toBeGreaterThan(0);
    expect(report.assumptions.length).toBeGreaterThan(0);
    expect(Object.keys(report.domains).sort()).toEqual([
      "Issuer",
      "Policy",
      "Revision",
      "Worker",
    ]);
    expect(report.initialStates).toHaveLength(1);

    // Non-vacuous law and all 4 transitions reachable across worker interleavings.
    expect(report.vacuousLaws).toEqual([]);
    expect(report.unreachableTransitions).toEqual([]);
    expect(report.stats.stateCount).toBeGreaterThan(10);
    expect(report.stats.edgeCount).toBeGreaterThan(report.stats.stateCount);
    expect(report.stats.maxDepthReached).toBeGreaterThanOrEqual(3);
    expect(report.stats.transitionFireCounts["evaluate"]).toBeGreaterThan(0);
    expect(report.stats.transitionFireCounts["invalidate"]).toBeGreaterThan(0);
    expect(report.stats.transitionFireCounts["retry"]).toBeGreaterThan(0);
    expect(report.stats.transitionFireCounts["release"]).toBeGreaterThan(0);
    expect(
      report.stats.lawPremiseCounts["release-has-fresh-authorized-evidence"],
    ).toBeGreaterThan(0);
  });

  it("Control 5a: depth-bounded prefix without fixed point MUST return inconclusive", () => {
    const source = buildControlModelSource();
    const report = verifyWorkflowSource(source, {
      prelude: workflowLawsPrelude,
      sourceId: "control-5-depth.lisp",
      maxDepth: 2,
    });

    expect(report.verdict).toBe("inconclusive");
    expect(report.fixedPointReached).toBe(false);
    expect(report.inconclusiveReason).toBe("depth-budget-exhausted");
    expect(report.bounds.maxDepth).toBe(2);
    expect(report.stats.maxDepthReached).toBe(2);
  });

  it("Control 5b: state-budget exhaustion returns inconclusive", () => {
    const source = buildControlModelSource();
    const report = verifyWorkflowSource(source, {
      prelude: workflowLawsPrelude,
      sourceId: "control-5-states.lisp",
      maxStates: 3,
    });

    expect(report.verdict).toBe("inconclusive");
    expect(report.fixedPointReached).toBe(false);
    expect(report.inconclusiveReason).toBe("state-budget-exhausted");
    expect(report.stats.stateCount).toBe(3);
  });

  it("Control 5c: rejects arbitrary native/hook/effect calls as inconclusive", () => {
    const unsupportedSource = `
(workflow-model NativeHookRejected
  (initial {:ready false})
  (transition call-host
    :guard (http/get "https://example.com/policy")
    :update (assoc state :ready true))
  (law trivial
    :holds true))
`;
    const report = verifyWorkflowSource(unsupportedSource, {
      prelude: workflowLawsPrelude,
      sourceId: "control-5-unsupported.lisp",
    });

    expect(report.verdict).toBe("inconclusive");
    expect(report.fixedPointReached).toBe(false);
    expect(report.inconclusiveReason).toBe("unsupported-operation");
    expect(report.unsupportedOperations.length).toBeGreaterThan(0);
    expect(report.unsupportedOperations[0]!.operation).toBe("http/get");
  });

  it("Control 5d: explicitly reports vacuous laws and unreachable release transitions", () => {
    const source = buildControlModelSource({
      includeVacuousLaw: true,
      includeUnreachableRelease: true,
    });
    const report = verifyWorkflowSource(source, {
      prelude: workflowLawsPrelude,
      sourceId: "control-5-vacuous.lisp",
      maxStates: 25_000,
      maxEdges: 250_000,
    });

    expect(report.verdict).toBe("holds-in-model");
    expect(report.fixedPointReached).toBe(true);
    expect(report.vacuousLaws.map((l) => l.name)).toEqual([
      "vacuous-future-revision",
    ]);
    expect(report.unreachableTransitions.map((t) => t.name)).toEqual([
      "unreachable-release",
    ]);
  });

  it("Control 5e: toVerificationEvidencePayload integrates cleanly with RFC 0029 EvidenceCache", () => {
    const safeReport = verifyWorkflowSource(buildControlModelSource(), {
      prelude: workflowLawsPrelude,
      sourceId: "control-5-cache.lisp",
      maxStates: 25_000,
      maxEdges: 250_000,
    });
    const payload = toVerificationEvidencePayload(safeReport);
    const trust = defaultVerificationTrustAccount(safeReport);

    const record: EvidenceRecord<VerificationEvidencePayload> = {
      formatVersion: EVIDENCE_FORMAT_VERSION,
      key: {
        defHash: `def:v1:${"a".repeat(64)}`,
        kind: "verification",
        toolchainDigest: computeToolchainDigest({
          preludes: [{ id: "workflow-laws.lisp", source: workflowLawsSource }],
        }),
        inputDigest: computeInputDigest({
          modelHash: safeReport.modelHash,
          maxStates: safeReport.bounds.maxStates,
          maxDepth: safeReport.bounds.maxDepth,
        }),
      },
      trust,
      payload,
    };

    expect(checkEvidenceCacheability(record)).toEqual({ cacheable: true });

    const cache = new EvidenceCache();
    cache.set(record);
    const fetched = cache.get<VerificationEvidencePayload>(record.key);
    expect(fetched).toBeDefined();
    expect(fetched!.payload.result).toBe("holds-in-model");
    expect(fetched!.payload.bounds["fixedPointReached"]).toBe(true);
    expect(fetched!.payload.bounds["modelHash"]).toBe(safeReport.modelHash);
    expect(fetched!.payload.assumptions.length).toBeGreaterThan(0);

    // Counterexample reports also convert cleanly and retain the trace.
    const cexReport = verifyWorkflowSource(
      buildControlModelSource({ checkFreshness: false }),
      {
        prelude: workflowLawsPrelude,
        sourceId: "control-5-cache-cex.lisp",
      },
    );
    const cexPayload = toVerificationEvidencePayload(cexReport);
    expect(cexPayload.result).toBe("counterexample");
    expect(cexPayload.counterexample).toBeDefined();
  });
});

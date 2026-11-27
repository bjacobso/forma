import { describe, expect, it } from "vitest";
import {
  TransactionalStore,
  evaluateBranchPolicies,
  exportSnapshotToSources,
  hashBranchPolicy,
  hashPolicyConfig,
  importSourcesAsTransaction,
  type BranchPolicy,
} from "../../src/StorePolicies.js";

describe("RFC 0029 Stages 2–3 end-to-end projection -> transaction -> policy pipeline", () => {
  it("round-trips exportSnapshotToSources -> edit .lisp -> importSourcesAsTransaction -> TransactionalStore.submitTransaction with evaluateBranchPolicies", () => {
    const policy: BranchPolicy = {
      protected: true,
      dependencyBoundaries: [{ from: "domain", deny: ["infra"] }],
      requirementEdit: { requireExplicitClass: true, requireApproval: true },
    };

    // Unified policy hash across transactions and policies
    expect(hashPolicyConfig(policy)).toBe(hashBranchPolicy(policy));

    const store = new TransactionalStore({
      policyEvaluator: evaluateBranchPolicies,
    });

    const initialSources = [
      {
        id: "domain/math.lisp",
        source: [
          ";; Domain math helpers",
          "(define double [x] (* x 2))",
          "",
          "(define quadruple [x] (double (double x)))",
          "",
          "(test double-test (= (double 3) 6))",
        ].join("\n"),
      },
      {
        id: "infra/io.lisp",
        source: "(define fetch-raw [x] x)",
      },
    ];

    const snap0 = store.createBranchFromSources("main", initialSources, {
      policy,
      message: "initial snapshot",
    });
    const index0 = store.getSnapshotIndex(snap0.hash)!;

    // 1. Project snapshot to .lisp sources (preserving comments verbatim)
    const exported = exportSnapshotToSources(snap0, index0, {
      originalSources: initialSources,
    });
    const mathFile = exported.find((m) => m.id === "domain/math.lisp")!;
    expect(mathFile.source).toBe(initialSources[0]!.source);

    // 2. Edit implementation in .lisp (same-interface body optimization)
    const editedImpl = exported.map((m) =>
      m.id === "domain/math.lisp"
        ? { ...m, source: m.source.replace("(* x 2)", "(+ x x)") }
        : m,
    );

    const implProposal = importSourcesAsTransaction(snap0, index0, editedImpl, {
      branch: "main",
      message: "optimize double implementation",
    });
    expect(implProposal.operationClass).toBe("impl-edit");
    expect(implProposal.operations).toHaveLength(1);
    expect(implProposal.operations[0]).toMatchObject({
      kind: "update",
      qualifiedName: "domain/math.lisp::double",
    });

    // 3. Submit through TransactionalStore with evaluateBranchPolicies
    const implRes = store.submitTransaction(implProposal);
    expect(implRes.ok).toBe(true);
    if (!implRes.ok) return;
    expect(implRes.impacts[0]?.kind).toBe("same-interface");
    expect(implRes.metrics.reboundCount).toBeGreaterThanOrEqual(2);
    expect(implRes.metrics.typecheckedCount).toBe(0);

    // 4. Edit test in .lisp -> auto-classified as requirement-edit -> rejected without approval, accepted with approval
    const snap1 = implRes.snapshot;
    const index1 = store.getSnapshotIndex(snap1.hash)!;
    const exported1 = exportSnapshotToSources(snap1, index1, {
      originalSources: editedImpl,
    });
    const editedTest = exported1.map((m) =>
      m.id === "domain/math.lisp"
        ? { ...m, source: m.source.replace("(= (double 3) 6)", "(= (double 4) 8)") }
        : m,
    );

    const unapprovedReq = importSourcesAsTransaction(snap1, index1, editedTest, {
      branch: "main",
    });
    expect(unapprovedReq.operationClass).toBe("requirement-edit");

    const rejectedReq = store.submitTransaction(unapprovedReq);
    expect(rejectedReq.ok).toBe(false);
    if (!rejectedReq.ok) {
      expect(rejectedReq.reason).toBe("policy-violation");
      expect(rejectedReq.policyViolations?.[0]?.rule).toBe("requirement-edit");
    }

    const approvedReq = importSourcesAsTransaction(snap1, index1, editedTest, {
      branch: "main",
      approvedRequirementEdit: true,
    });
    const acceptedReq = store.submitTransaction(approvedReq);
    expect(acceptedReq.ok).toBe(true);

    // 5. Introduce forbidden domain -> infra dependency in .lisp -> rejected by dependency-boundary policy
    const snap2 = acceptedReq.ok ? acceptedReq.snapshot : snap1;
    const index2 = store.getSnapshotIndex(snap2.hash)!;
    const exported2 = exportSnapshotToSources(snap2, index2, {
      originalSources: editedTest,
    });
    const badDepEdit = exported2.map((m) =>
      m.id === "domain/math.lisp"
        ? { ...m, source: `${m.source}\n\n(define leaky [x] (fetch-raw x))` }
        : m,
    );
    const badDepProposal = importSourcesAsTransaction(snap2, index2, badDepEdit, {
      branch: "main",
    });
    const badDepRes = store.submitTransaction(badDepProposal);
    expect(badDepRes.ok).toBe(false);
    if (!badDepRes.ok) {
      expect(badDepRes.reason).toBe("policy-violation");
      expect(badDepRes.policyViolations?.[0]?.rule).toBe("dependency-boundary");
    }
  });
});

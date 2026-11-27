import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  FileSnapshotBackend,
  openNodeTransactionalStore,
} from "../../src/node/snapshot-store.js";
import {
  diffSnapshots,
  InMemorySnapshotBackend,
  SNAPSHOT_HASH_VERSION,
  TransactionalStore,
  type PolicyViolation,
} from "../../src/store/transactions.js";

const tempDirs: string[] = [];

function makeTempStoreDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "forma-tx-store-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("RFC 0029 Stage 2: TransactionalStore, snapshots, CAS, and Node persistence", () => {
  it("creates immutable snapshots and mutable branch pointers", () => {
    const store = new TransactionalStore();
    const s0 = store.createBranchFromSources("main", [
      { id: "math.lisp", source: `(define (inc x) (+ x 1))` },
    ]);

    expect(s0.hash).toMatch(new RegExp(`^${SNAPSHOT_HASH_VERSION}:[0-9a-f]{64}$`));
    expect(s0.parent).toBeNull();
    expect(store.getBranch("main")?.head).toBe(s0.hash);
    expect(store.listBranches().map((b) => b.name)).toEqual(["main"]);

    const feature = store.createBranch("feature", s0.hash);
    expect(feature.head).toBe(s0.hash);
    expect(store.listBranches().map((b) => b.name)).toEqual(["feature", "main"]);

    // Commit on feature does not mutate s0 or main
    const res = store.submitTransaction({
      branch: "feature",
      baseSnapshot: s0.hash,
      operationClass: "impl-edit",
      operations: [
        {
          kind: "add",
          qualifiedName: "math.lisp::dec",
          source: `(define (dec x) (- x 1))`,
        },
      ],
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.snapshot.parent).toBe(s0.hash);
    expect(store.getBranch("feature")?.head).toBe(res.snapshot.hash);
    expect(store.getBranch("main")?.head).toBe(s0.hash);
    expect(store.getSnapshot(s0.hash)?.bindings.has("math.lisp::dec")).toBe(false);
    expect(store.getSnapshot(res.snapshot.hash)?.bindings.has("math.lisp::dec")).toBe(true);
  });

  it("performs O(1) rename and move without rehashing or re-typechecking dependents", () => {
    const typechecked: string[] = [];
    const store = new TransactionalStore({
      onTypecheck: (qName) => typechecked.push(qName),
    });

    const s0 = store.createBranchFromSources("main", [
      { id: "math.lisp", source: `(define (inc x) (+ x 1))` },
      { id: "app.lisp", source: `(define (double-inc x) (inc (inc x)))` },
    ]);

    const incHashBefore = s0.bindings.get("math.lisp::inc")!;
    const callerHashBefore = s0.bindings.get("app.lisp::double-inc")!;
    expect(incHashBefore).toBeDefined();
    expect(callerHashBefore).toBeDefined();

    // O(1) rename math.lisp::inc -> math.lisp::add-one
    const renameRes = store.submitTransaction({
      branch: "main",
      baseSnapshot: s0.hash,
      operationClass: "impl-edit",
      operations: [
        {
          kind: "rename",
          from: "math.lisp::inc",
          to: "math.lisp::add-one",
        },
      ],
    });

    expect(renameRes.ok).toBe(true);
    if (!renameRes.ok) return;
    expect(typechecked).toEqual([]);
    expect(renameRes.metrics.typecheckedCount).toBe(0);
    expect(renameRes.metrics.reboundCount).toBe(0);
    expect(renameRes.snapshot.bindings.has("math.lisp::inc")).toBe(false);
    expect(renameRes.snapshot.bindings.get("math.lisp::add-one")).toBe(incHashBefore);
    // Dependent hash is completely untouched!
    expect(renameRes.snapshot.bindings.get("app.lisp::double-inc")).toBe(callerHashBefore);
    expect(renameRes.diff.renamed).toEqual([
      { from: "math.lisp::inc", to: "math.lisp::add-one", hash: incHashBefore },
    ]);
    expect(renameRes.diff.added).toEqual([]);
    expect(renameRes.diff.removed).toEqual([]);

    // O(1) move math.lisp::add-one -> core.lisp::add-one
    const moveRes = store.submitTransaction({
      branch: "main",
      baseSnapshot: renameRes.snapshot.hash,
      operationClass: "impl-edit",
      operations: [
        {
          kind: "move",
          from: "math.lisp::add-one",
          toModuleId: "core.lisp",
        },
      ],
    });
    expect(moveRes.ok).toBe(true);
    if (!moveRes.ok) return;
    expect(typechecked).toEqual([]);
    expect(moveRes.snapshot.bindings.get("core.lisp::add-one")).toBe(incHashBefore);
    expect(moveRes.snapshot.bindings.get("app.lisp::double-inc")).toBe(callerHashBefore);
  });

  it("rebinds transitive dependents on same-interface updates with zero dependent re-typechecks", () => {
    const typechecked: string[] = [];
    const store = new TransactionalStore({
      onTypecheck: (qName) => typechecked.push(qName),
    });

    const s0 = store.createBranchFromSources("main", [
      { id: "math.lisp", source: `(define (inc x) (+ x 1))` },
      { id: "app.lisp", source: `(define (double-inc x) (inc (inc x)))` },
      { id: "top.lisp", source: `(define (quad-inc x) (double-inc (double-inc x)))` },
    ]);

    const oldIncHash = s0.bindings.get("math.lisp::inc")!;
    const oldDoubleHash = s0.bindings.get("app.lisp::double-inc")!;
    const oldQuadHash = s0.bindings.get("top.lisp::quad-inc")!;

    // Same-interface body change: (+ x 1) -> (+ 1 x) (still Int -> Int, empty effects/errors)
    const res = store.submitTransaction({
      branch: "main",
      baseSnapshot: s0.hash,
      operationClass: "impl-edit",
      operations: [
        {
          kind: "update",
          qualifiedName: "math.lisp::inc",
          source: `(define (inc x) (+ 1 x))`,
        },
      ],
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;

    // Only `math.lisp::inc` was typechecked; neither dependent was re-typechecked!
    expect(typechecked).toEqual(["math.lisp::inc"]);
    expect(res.metrics.typecheckedCount).toBe(1);
    expect(res.metrics.reboundCount).toBe(2);

    const newIncHash = res.snapshot.bindings.get("math.lisp::inc")!;
    const newDoubleHash = res.snapshot.bindings.get("app.lisp::double-inc")!;
    const newQuadHash = res.snapshot.bindings.get("top.lisp::quad-inc")!;

    expect(newIncHash).not.toBe(oldIncHash);
    expect(newDoubleHash).not.toBe(oldDoubleHash);
    expect(newQuadHash).not.toBe(oldQuadHash);

    // Rebound dependents point at the new upstream hashes
    expect(store.getDefinition(newDoubleHash)?.dependencies).toContain(newIncHash);
    expect(store.getDefinition(newQuadHash)?.dependencies).toContain(newDoubleHash);

    expect(res.impacts).toHaveLength(1);
    expect(res.impacts[0]!.kind).toBe("same-interface");
    expect(res.impacts[0]!.reboundDependents.map((d) => d.qualifiedName).sort()).toEqual([
      "app.lisp::double-inc",
      "top.lisp::quad-inc",
    ]);
  });

  it("rejects interface-changing updates with exact affected dependent lists unless dependents are updated together", () => {
    const store = new TransactionalStore();
    const s0 = store.createBranchFromSources("main", [
      { id: "math.lisp", source: `(define (inc x) (+ x 1))` },
      { id: "app.lisp", source: `(define (double-inc x) (inc (inc x)))` },
      { id: "top.lisp", source: `(define (quad-inc x) (double-inc (double-inc x)))` },
    ]);

    const oldDoubleHash = s0.bindings.get("app.lisp::double-inc")!;
    const oldQuadHash = s0.bindings.get("top.lisp::quad-inc")!;

    // Change signature from Int -> Int to String -> String without updating dependents
    const rejected = store.submitTransaction({
      branch: "main",
      baseSnapshot: s0.hash,
      operationClass: "impl-edit",
      operations: [
        {
          kind: "update",
          qualifiedName: "math.lisp::inc",
          source: `(: inc (-> String String))\n(define (inc s) s)`,
        },
      ],
    });

    expect(rejected.ok).toBe(false);
    if (rejected.ok) return;
    expect(rejected.reason).toBe("interface-change");
    expect(store.getBranch("main")?.head).toBe(s0.hash);
    expect(rejected.impacts).toHaveLength(1);
    expect(rejected.impacts![0]!.kind).toBe("interface-changed");
    expect(rejected.impacts![0]!.unupdatedDependents).toEqual([
      { qualifiedName: "app.lisp::double-inc", hash: oldDoubleHash },
      { qualifiedName: "top.lisp::quad-inc", hash: oldQuadHash },
    ]);

    // Updating the definition AND all its dependents in the same transaction succeeds
    const accepted = store.submitTransaction({
      branch: "main",
      baseSnapshot: s0.hash,
      operationClass: "impl-edit",
      operations: [
        {
          kind: "update",
          qualifiedName: "math.lisp::inc",
          source: `(: inc (-> String String))\n(define (inc s) s)`,
        },
        {
          kind: "update",
          qualifiedName: "app.lisp::double-inc",
          source: `(: double-inc (-> String String))\n(define (double-inc s) (inc (inc s)))`,
        },
        {
          kind: "update",
          qualifiedName: "top.lisp::quad-inc",
          source: `(: quad-inc (-> String String))\n(define (quad-inc s) (double-inc (double-inc s)))`,
        },
      ],
    });

    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    expect(store.getBranch("main")?.head).toBe(accepted.snapshot.hash);
  });

  it("supports staging-branch and add-only coexistence modes for interface-changing updates", () => {
    const store = new TransactionalStore();
    const s0 = store.createBranchFromSources("main", [
      { id: "math.lisp", source: `(define (inc x) (+ x 1))` },
      { id: "app.lisp", source: `(define (double-inc x) (inc (inc x)))` },
    ]);

    const oldIncHash = s0.bindings.get("math.lisp::inc")!;

    // Mode 1: staging-branch leaves main untouched and commits to staging branch
    const staged = store.submitTransaction({
      branch: "main",
      baseSnapshot: s0.hash,
      operationClass: "impl-edit",
      onInterfaceChange: "staging-branch",
      stagingBranchName: "staging/inc-string",
      operations: [
        {
          kind: "update",
          qualifiedName: "math.lisp::inc",
          source: `(: inc (-> String String))\n(define (inc s) s)`,
        },
      ],
    });

    expect(staged.ok).toBe(true);
    if (!staged.ok) return;
    expect(staged.stagingBranch).toBe("staging/inc-string");
    expect(store.getBranch("main")?.head).toBe(s0.hash);
    expect(store.getBranch("staging/inc-string")?.head).toBe(staged.snapshot.hash);

    // Mode 2: add-only coexistence keeps original binding intact and adds coexisting version
    const coexisted = store.submitTransaction({
      branch: "main",
      baseSnapshot: s0.hash,
      operationClass: "impl-edit",
      onInterfaceChange: "add-only",
      coexistenceSuffix: "v2",
      operations: [
        {
          kind: "update",
          qualifiedName: "math.lisp::inc",
          source: `(: inc (-> String String))\n(define (inc s) s)`,
        },
      ],
    });

    expect(coexisted.ok).toBe(true);
    if (!coexisted.ok) return;
    expect(coexisted.coexistingBindings).toEqual({
      "math.lisp::inc": "math.lisp::inc@v2",
    });
    // Original binding & dependent remain intact on main
    expect(coexisted.snapshot.bindings.get("math.lisp::inc")).toBe(oldIncHash);
    expect(coexisted.snapshot.bindings.has("math.lisp::inc@v2")).toBe(true);
    expect(coexisted.snapshot.bindings.get("math.lisp::inc@v2")).not.toBe(oldIncHash);
  });

  it("auto-rebases disjoint concurrent CAS transactions and returns structured conflict reports on overlaps", () => {
    const store = new TransactionalStore();
    const s0 = store.createBranchFromSources("main", [
      { id: "math.lisp", source: `(define (inc x) (+ x 1))` },
      { id: "util.lisp", source: `(define (id x) x)` },
    ]);

    // Agent A adds math.lisp::dec against s0
    const txA = store.submitTransaction({
      branch: "main",
      baseSnapshot: s0.hash,
      operationClass: "impl-edit",
      operations: [
        {
          kind: "add",
          qualifiedName: "math.lisp::dec",
          source: `(define (dec x) (- x 1))`,
        },
      ],
    });
    expect(txA.ok).toBe(true);
    if (!txA.ok) return;
    expect(txA.metrics.rebased).toBe(false);

    // Agent B concurrently adds util.lisp::const-one against stale s0 (disjoint!)
    const txB = store.submitTransaction({
      branch: "main",
      baseSnapshot: s0.hash,
      operationClass: "impl-edit",
      operations: [
        {
          kind: "add",
          qualifiedName: "util.lisp::const-one",
          source: `(define (const-one x) 1)`,
        },
      ],
    });
    expect(txB.ok).toBe(true);
    if (!txB.ok) return;
    expect(txB.metrics.rebased).toBe(true);
    expect(txB.snapshot.parent).toBe(txA.snapshot.hash);
    expect(txB.snapshot.bindings.has("math.lisp::dec")).toBe(true);
    expect(txB.snapshot.bindings.has("util.lisp::const-one")).toBe(true);

    // Overlapping name collision: Agent C updates math.lisp::inc against s0, while Agent D also updates math.lisp::inc
    const s1 = txB.snapshot;
    const txC = store.submitTransaction({
      branch: "main",
      baseSnapshot: s1.hash,
      operationClass: "impl-edit",
      operations: [
        {
          kind: "update",
          qualifiedName: "math.lisp::inc",
          source: `(define (inc x) (+ 1 x))`,
        },
      ],
    });
    expect(txC.ok).toBe(true);
    if (!txC.ok) return;

    const txD = store.submitTransaction({
      branch: "main",
      baseSnapshot: s1.hash,
      operationClass: "impl-edit",
      operations: [
        {
          kind: "update",
          qualifiedName: "math.lisp::inc",
          source: `(define (inc x) (+ x (+ 0 1)))`,
        },
      ],
    });
    expect(txD.ok).toBe(false);
    if (txD.ok) return;
    expect(txD.reason).toBe("cas-conflict");
    expect(txD.conflict?.baseSnapshot).toBe(s1.hash);
    expect(txD.conflict?.headSnapshot).toBe(txC.snapshot.hash);
    expect(txD.conflict?.conflicts.some((c) => c.reason === "name-collision" && c.qualifiedName === "math.lisp::inc")).toBe(true);

    // Overlapping dependency change: Agent E (based on stale s1) adds a caller of math.lisp::inc after txC changed math.lisp::inc
    const txE = store.submitTransaction({
      branch: "main",
      baseSnapshot: s1.hash,
      operationClass: "impl-edit",
      operations: [
        {
          kind: "add",
          qualifiedName: "app.lisp::uses-inc",
          source: `(define (uses-inc x) (inc x))`,
        },
      ],
    });
    expect(txE.ok).toBe(false);
    if (txE.ok) return;
    expect(txE.reason).toBe("cas-conflict");
    expect(
      txE.conflict?.conflicts.some(
        (c) => c.reason === "dependency-changed" && c.qualifiedName === "math.lisp::inc",
      ),
    ).toBe(true);
  });

  it("invokes the pluggable PolicyEvaluator hook and rejects violating transactions", () => {
    const store = new TransactionalStore({
      policyEvaluator: (ctx): readonly PolicyViolation[] => {
        if (ctx.proposal.operationClass !== "requirement-edit" && ctx.diff.added.some((a) => a.qualifiedName.includes("forbidden"))) {
          return [
            {
              rule: "dependency-boundary",
              qualifiedName: "domain.lisp::forbidden",
              message: "Forbidden symbol in domain namespace",
            },
          ];
        }
        return [];
      },
    });

    const s0 = store.createBranchFromSources("main", [
      { id: "domain.lisp", source: `(define (ok x) (+ x 1))` },
    ]);

    const denied = store.submitTransaction({
      branch: "main",
      baseSnapshot: s0.hash,
      operationClass: "impl-edit",
      operations: [
        {
          kind: "add",
          qualifiedName: "domain.lisp::forbidden",
          source: `(define (forbidden x) x)`,
        },
      ],
    });

    expect(denied.ok).toBe(false);
    if (denied.ok) return;
    expect(denied.reason).toBe("policy-violation");
    expect(denied.policyViolations).toHaveLength(1);
    expect(denied.policyViolations![0]!.rule).toBe("dependency-boundary");
    expect(store.getBranch("main")?.head).toBe(s0.hash);
  });

  it("computes accurate diffSnapshots across add, update, rename, and remove", () => {
    const backend = new InMemorySnapshotBackend();
    const store = new TransactionalStore({ backend });
    const s0 = store.createBranchFromSources("main", [
      {
        id: "m.lisp",
        source: `
          (define (keep x) (+ x 1))
          (define (rename-me x) (* x 2))
          (define (drop-me x) (- x 1))
        `,
      },
    ]);

    const tx = store.submitTransaction({
      branch: "main",
      baseSnapshot: s0.hash,
      operationClass: "impl-edit",
      operations: [
        { kind: "update", qualifiedName: "m.lisp::keep", source: `(define (keep x) (+ 1 x))` },
        { kind: "rename", from: "m.lisp::rename-me", to: "m.lisp::renamed" },
        { kind: "remove", qualifiedName: "m.lisp::drop-me" },
        { kind: "add", qualifiedName: "m.lisp::fresh", source: `(define (fresh x) (+ x 10))` },
      ],
    });
    expect(tx.ok).toBe(true);
    if (!tx.ok) return;

    const diff = diffSnapshots(s0, tx.snapshot, (h) => store.getDefinition(h));
    expect(diff.added.map((a) => a.qualifiedName)).toEqual(["m.lisp::fresh"]);
    expect(diff.removed.map((r) => r.qualifiedName)).toEqual(["m.lisp::drop-me"]);
    expect(diff.renamed).toEqual([
      {
        from: "m.lisp::rename-me",
        to: "m.lisp::renamed",
        hash: s0.bindings.get("m.lisp::rename-me")!,
      },
    ]);
    expect(diff.updated).toHaveLength(1);
    expect(diff.updated[0]!.qualifiedName).toBe("m.lisp::keep");
    expect(diff.updated[0]!.interfaceChanged).toBe(false);
  });

  it("persists snapshots, definitions, and branches across fresh Node store instances and detects corruption", () => {
    const storeDir = makeTempStoreDir();
    const { store: store1 } = openNodeTransactionalStore({ storeDir });

    const s0 = store1.createBranchFromSources("main", [
      { id: "math.lisp", source: `(define (inc x) (+ x 1))` },
    ]);

    const tx1 = store1.submitTransaction({
      branch: "main",
      baseSnapshot: s0.hash,
      operationClass: "impl-edit",
      operations: [
        {
          kind: "add",
          qualifiedName: "app.lisp::double-inc",
          source: `(define (double-inc x) (inc (inc x)))`,
        },
      ],
    });
    expect(tx1.ok).toBe(true);
    if (!tx1.ok) return;

    // Reopen from disk in a brand-new TransactionalStore instance
    const { store: store2, backend: backend2 } = openNodeTransactionalStore({ storeDir });
    expect(store2.listBranches().map((b) => b.name)).toEqual(["main"]);
    expect(store2.getBranch("main")?.head).toBe(tx1.snapshot.hash);

    const reloadedSnap = store2.getSnapshot(tx1.snapshot.hash);
    expect(reloadedSnap).toBeDefined();
    expect(reloadedSnap?.parent).toBe(s0.hash);
    expect(reloadedSnap?.bindings.get("math.lisp::inc")).toBe(s0.bindings.get("math.lisp::inc"));
    expect(reloadedSnap?.bindings.get("app.lisp::double-inc")).toBe(
      tx1.snapshot.bindings.get("app.lisp::double-inc"),
    );

    const diff = store2.diffSnapshots(s0.hash, tx1.snapshot.hash);
    expect(diff?.added.map((a) => a.qualifiedName)).toEqual(["app.lisp::double-inc"]);

    // Submit another transaction in the reopened store (verifies lazy upstream scheme recovery)
    const tx2 = store2.submitTransaction({
      branch: "main",
      baseSnapshot: tx1.snapshot.hash,
      operationClass: "impl-edit",
      operations: [
        {
          kind: "add",
          qualifiedName: "top.lisp::quad-inc",
          source: `(define (quad-inc x) (double-inc (double-inc x)))`,
        },
      ],
    });
    expect(tx2.ok).toBe(true);

    // Tamper with a persisted snapshot file and verify SHA-256 checksum rejects it
    const snapshotsRoot = join(storeDir, "snapshots", "v1");
    const buckets = readdirSync(snapshotsRoot);
    expect(buckets.length).toBeGreaterThan(0);
    const firstBucket = join(snapshotsRoot, buckets[0]!);
    const files = readdirSync(firstBucket).filter((f) => f.endsWith(".json"));
    expect(files.length).toBeGreaterThan(0);
    const targetFile = join(firstBucket, files[0]!);
    const envelope = JSON.parse(readFileSync(targetFile, "utf8")) as {
      snapshotHash: string;
      snapshot: { message?: string };
    };
    envelope.snapshot.message = "tampered";
    writeFileSync(targetFile, JSON.stringify(envelope), "utf8");

    const freshBackend = new FileSnapshotBackend(storeDir);
    expect(freshBackend.getSnapshot(envelope.snapshotHash)).toBeUndefined();
    expect(backend2.storeDir).toBe(storeDir);
  });
});

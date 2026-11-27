import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JsonAbi } from "../src/json-abi.js";

const cli = resolve(import.meta.dirname, "../dist/cli.mjs");

describe("host ABI transactional store & branch policies (RFC 0029 Stage 3)", () => {
  it("handles multi-agent concurrent transactions: disjoint auto-rebase and stale CAS rejection + retry", async () => {
    const abi = new JsonAbi();
    const send = (payload: unknown) => abi.handleJson(JSON.stringify(payload));

    const branches = await send({ op: "listBranches" });
    expect(branches.ok).toBe(true);
    const initialHead = (branches.value as { branches: { name: string; head: string }[] })
      .branches[0]!.head;

    // Seed an initial shared definition on main.
    const seed = await send({
      op: "submitTransaction",
      branch: "main",
      baseSnapshot: initialHead,
      operationClass: "impl-edit",
      operations: [
        {
          kind: "add",
          qualifiedName: "math.lisp::base-val",
          source: "(define base-val 10)",
        },
      ],
    });
    expect(seed.ok).toBe(true);
    const baseSnapshot = (seed.value as { snapshot: { hash: string } }).snapshot.hash;

    // Agent A and Agent B both read `baseSnapshot`.
    // Agent A adds `alpha`, Agent B adds `beta` (disjoint names).
    const agentA = await send({
      op: "submitTransaction",
      branch: "main",
      baseSnapshot,
      operationClass: "impl-edit",
      author: "agent-a",
      operations: [
        {
          kind: "add",
          qualifiedName: "math.lisp::alpha",
          source: "(define alpha [x] (+ x 1))",
        },
      ],
    });
    expect(agentA.ok).toBe(true);
    const afterA = (agentA.value as { snapshot: { hash: string }; metrics: { rebased: boolean } });
    expect(afterA.metrics.rebased).toBe(false);

    // Agent B submits against stale `baseSnapshot` with a disjoint name -> auto-rebases cleanly.
    const agentB = await send({
      op: "submitTransaction",
      branch: "main",
      baseSnapshot,
      operationClass: "impl-edit",
      author: "agent-b",
      operations: [
        {
          kind: "add",
          qualifiedName: "math.lisp::beta",
          source: "(define beta [x] (* x 2))",
        },
      ],
    });
    expect(agentB.ok).toBe(true);
    const afterB = agentB.value as {
      snapshot: { hash: string; bindings: Record<string, string> };
      metrics: { rebased: boolean };
    };
    expect(afterB.metrics.rebased).toBe(true);
    expect(Object.keys(afterB.snapshot.bindings)).toEqual(
      expect.arrayContaining(["math.lisp::base-val", "math.lisp::alpha", "math.lisp::beta"]),
    );

    // Now Agent C and Agent D both update `math.lisp::base-val` from `afterB.snapshot.hash`.
    const agentC = await send({
      op: "submitTransaction",
      branch: "main",
      baseSnapshot: afterB.snapshot.hash,
      operationClass: "impl-edit",
      author: "agent-c",
      operations: [
        {
          kind: "update",
          qualifiedName: "math.lisp::base-val",
          source: "(define base-val 20)",
        },
      ],
    });
    expect(agentC.ok).toBe(true);
    const headAfterC = (agentC.value as { snapshot: { hash: string } }).snapshot.hash;

    // Agent D submits against stale `afterB.snapshot.hash` modifying the same name -> CAS conflict!
    const agentDStale = await send({
      op: "submitTransaction",
      branch: "main",
      baseSnapshot: afterB.snapshot.hash,
      operationClass: "impl-edit",
      author: "agent-d",
      operations: [
        {
          kind: "update",
          qualifiedName: "math.lisp::base-val",
          source: "(define base-val 30)",
        },
      ],
    });
    expect(agentDStale.ok).toBe(false);
    expect(agentDStale.value).toMatchObject({
      ok: false,
      reason: "cas-conflict",
      conflict: {
        branch: "main",
        baseSnapshot: afterB.snapshot.hash,
        headSnapshot: headAfterC,
        conflicts: [
          expect.objectContaining({
            reason: "name-collision",
            qualifiedName: "math.lisp::base-val",
          }),
        ],
      },
    });

    // Agent D retries against `headAfterC` -> succeeds!
    const agentDRetry = await send({
      op: "submitTransaction",
      branch: "main",
      baseSnapshot: headAfterC,
      operationClass: "impl-edit",
      author: "agent-d",
      operations: [
        {
          kind: "update",
          qualifiedName: "math.lisp::base-val",
          source: "(define base-val 30)",
        },
      ],
    });
    expect(agentDRetry.ok).toBe(true);
    const finalHead = (agentDRetry.value as { snapshot: { hash: string } }).snapshot.hash;

    // Verify diffSnapshots between `baseSnapshot` and `finalHead`.
    const diffResp = await send({
      op: "diffSnapshots",
      from: baseSnapshot,
      to: finalHead,
    });
    expect(diffResp.ok).toBe(true);
    const diff = (diffResp.value as { diff: { added: { qualifiedName: string }[]; updated: { qualifiedName: string }[] } }).diff;
    expect(diff.added.map((a) => a.qualifiedName)).toEqual(["math.lisp::alpha", "math.lisp::beta"]);
    expect(diff.updated.map((u) => u.qualifiedName)).toEqual(["math.lisp::base-val"]);
  });

  it("enforces requirement-edit separation, capability budgets, and dependency boundaries", async () => {
    const abi = new JsonAbi();
    const send = (payload: unknown) => abi.handleJson(JSON.stringify(payload));
    const head0 = ((await send({ op: "getSnapshot", branch: "main" })).value as { snapshot: { hash: string } })
      .snapshot.hash;

    // Configure branch policies + seed services, infra, and a test.
    const setup = await send({
      op: "submitTransaction",
      branch: "main",
      baseSnapshot: head0,
      operationClass: "requirement-edit",
      approvedRequirementEdit: true,
      nextPolicy: {
        dependencyBoundaries: [{ from: "domain", deny: ["infra"] }],
        capabilityBudgets: [{ namespace: "domain", maxRequirements: [] }],
        requirementEdit: { requireExplicitClass: true, requireApproval: true },
      },
      operations: [
        {
          kind: "add",
          qualifiedName: "services.lisp::Db",
          source: "(export Db)\n(service Db (: query (-> String (Effect String))))",
        },
        {
          kind: "add",
          qualifiedName: "infra/db.lisp::fetch-raw",
          source: "(export fetch-raw)\n(define fetch-raw [id] id)",
        },
        {
          kind: "add",
          qualifiedName: "domain/math.lisp::double",
          source: "(define double [x] (* x 2))",
        },
        {
          kind: "add",
          qualifiedName: "domain/math.lisp::double-test",
          source: "(test double-test (= (double 3) 6))",
        },
      ],
    });
    expect(setup.ok).toBe(true);
    const head1 = (setup.value as { snapshot: { hash: string } }).snapshot.hash;

    // 1. Reject modifying a test under `impl-edit`.
    const badReqEdit = await send({
      op: "submitTransaction",
      branch: "main",
      baseSnapshot: head1,
      operationClass: "impl-edit",
      operations: [
        {
          kind: "update",
          qualifiedName: "domain/math.lisp::double-test",
          source: "(test double-test (= (double 3) 999))",
        },
      ],
    });
    expect(badReqEdit.ok).toBe(false);
    expect(badReqEdit.value).toMatchObject({
      ok: false,
      reason: "policy-violation",
      policyViolations: [expect.objectContaining({ rule: "requirement-edit" })],
    });

    // 2. Reject capability budget violation (Db.query in pure domain namespace).
    const badCap = await send({
      op: "submitTransaction",
      branch: "main",
      baseSnapshot: head1,
      operationClass: "impl-edit",
      operations: [
        {
          kind: "add",
          qualifiedName: "domain/orders.lisp::load-order",
          source: `(import "./services.lisp" [Db])
(: load-order (-> String (Effect String [] [Db.query])))
(define load-order [id] (Db.query id))`,
        },
      ],
    });
    expect(badCap.ok).toBe(false);
    expect(badCap.value).toMatchObject({
      ok: false,
      reason: "policy-violation",
      policyViolations: [expect.objectContaining({ rule: "capability-budget" })],
    });

    // 3. Reject dependency boundary violation (domain -> infra).
    const badDep = await send({
      op: "submitTransaction",
      branch: "main",
      baseSnapshot: head1,
      operationClass: "impl-edit",
      operations: [
        {
          kind: "add",
          qualifiedName: "domain/orders.lisp::bad-dep",
          source: `(import "./infra/db.lisp" [fetch-raw])
(define bad-dep [id] (fetch-raw id))`,
        },
      ],
    });
    expect(badDep.ok).toBe(false);
    expect(badDep.value).toMatchObject({
      ok: false,
      reason: "policy-violation",
      policyViolations: [expect.objectContaining({ rule: "dependency-boundary" })],
    });

    // 4. Approved requirement-edit succeeds.
    const approvedReqEdit = await send({
      op: "submitTransaction",
      branch: "main",
      baseSnapshot: head1,
      operationClass: "requirement-edit",
      approvedRequirementEdit: true,
      operations: [
        {
          kind: "update",
          qualifiedName: "domain/math.lisp::double-test",
          source: "(test double-test (= (double 4) 8))",
        },
      ],
    });
    expect(approvedReqEdit.ok).toBe(true);
  });
});

describe("forma mcp transactional store tools", () => {
  const dir = realpathSync(mkdtempSync(resolve(tmpdir(), "forma-mcp-tx-")));
  const client = new Client({ name: "forma-tx-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [cli, "mcp"],
    cwd: dir,
    stderr: "pipe",
  });

  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: args });
    expect(result.content).toEqual([
      expect.objectContaining({ type: "text", text: expect.any(String) }),
    ]);
    return result.structuredContent as Record<string, any>;
  };

  beforeAll(async () => {
    await client.connect(transport);
  }, 30_000);

  afterAll(async () => {
    await client.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("advertises list_branches, get_snapshot, diff_snapshots, and submit_transaction", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(
      expect.arrayContaining([
        "list_branches",
        "get_snapshot",
        "diff_snapshots",
        "submit_transaction",
        "get_definition",
        "check",
      ]),
    );
  });

  it("executes branch inspection, transactions, policy rejection, and snapshot diff over stdio MCP", async () => {
    const branches = await call("list_branches", {});
    expect(branches.ok).toBe(true);
    const head0 = branches.branches[0].head as string;

    const snap0 = await call("get_snapshot", { branch: "main" });
    expect(snap0.ok).toBe(true);
    expect(snap0.snapshot.hash).toBe(head0);

    const tx1 = await call("submit_transaction", {
      branch: "main",
      baseSnapshot: head0,
      operationClass: "impl-edit",
      nextPolicy: {
        requirementEdit: { requireExplicitClass: true },
      },
      operations: [
        {
          kind: "add",
          qualifiedName: "app.lisp::greet",
          source: `(define greet [name] name)`,
        },
      ],
    });
    expect(tx1.ok).toBe(true);
    const head1 = tx1.snapshot.hash as string;

    // Attempting to add a test under `impl-edit` is rejected by policy over MCP.
    const rejected = await call("submit_transaction", {
      branch: "main",
      baseSnapshot: head1,
      operationClass: "impl-edit",
      operations: [
        {
          kind: "add",
          qualifiedName: "app.lisp::greet-test",
          source: `(test greet-test (= (greet "hi") "hi"))`,
        },
      ],
    });
    expect(rejected.ok).toBe(false);
    expect(rejected.reason).toBe("policy-violation");

    const diff = await call("diff_snapshots", { from: head0, to: head1 });
    expect(diff.ok).toBe(true);
    expect(diff.diff.added.map((a: { qualifiedName: string }) => a.qualifiedName)).toEqual([
      "app.lisp::greet",
    ]);
  });
});

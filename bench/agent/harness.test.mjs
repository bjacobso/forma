import assert from "node:assert/strict";
import test from "node:test";
import { metrics, parseOptions } from "./harness.mjs";

test("repair rounds count only failures for the final entry before its first success", () => {
  const call = (mode, entry, exitCode) => ({ argv: ["file", mode, entry], exitCode });
  assert.deepEqual(metrics([
    call("typecheck", "scratch.lisp", 1),
    call("typecheck", "main.lisp", 1),
    call("evaluate", "./main.lisp", 1),
    call("interface", "main.lisp", 1),
    call("declarations", "main.lisp", 0),
    call("evaluate", "main.lisp", 1),
  ], "/tmp/task", "main.lisp"), { repairRounds: 2, cliCallCount: 6, firstPassingCall: 5 });
});
test("no passing call remains observable", () => {
  assert.deepEqual(metrics([{ argv: ["file", "evaluate", "main.lisp"], exitCode: 1 }], "/tmp/task", "main.lisp"),
    { repairRounds: 1, cliCallCount: 1, firstPassingCall: null });
});
test("options reject unknown flags, missing values and duplicate task IDs", () => {
  assert.throws(() => parseOptions(["--wat", "x"]));
  assert.throws(() => parseOptions(["--agent-cmd"]));
  assert.throws(() => parseOptions(["--agent-cmd", "true", "--tasks", "a,a"]));
  assert.equal(parseOptions(["--agent-cmd", "true"]).out, "results.json");
});

test("sandbox paths match the physical cwd logged by Node", async () => {
  const { realpath, rm } = await import("node:fs/promises");
  const { prepare } = await import("./harness.mjs");
  const { dir } = await prepare("tiered-price");
  try { assert.equal(dir, await realpath(dir)); }
  finally { await rm(dir, { recursive: true, force: true }); }
});

test("tier filters accept core and hard and reject misspellings", () => {
  assert.equal(parseOptions(["--agent-cmd", "true", "--tier", "hard"]).tier, "hard");
  assert.throws(() => parseOptions(["--agent-cmd", "true", "--tier", "other"]));
});

test("human entry commands share repair rounds, including flags and physical cwd", () => {
  assert.deepEqual(metrics([
    { argv: ["check", "--json", "main.lisp"], exitCode: 1 },
    { argv: ["run", "scratch.lisp"], exitCode: 1 },
    { argv: ["test", "./main.lisp", "--json"], exitCode: 1 },
    { argv: ["run", "main.lisp", "--json"], exitCode: 0 },
    { argv: ["check", "main.lisp"], exitCode: 1 },
  ], "/tmp/task", "main.lisp"), { repairRounds: 2, cliCallCount: 5, firstPassingCall: 4 });
});

test("tier and explicit task filters intersect and report empty tier totals", async () => {
  const { execFileSync } = await import("node:child_process");
  const { mkdtemp, readFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { root } = await import("./harness.mjs");
  const dir = await mkdtemp(join(tmpdir(), "forma-tier-test-"));
  let report;
  try {
    const output = join(dir, "results.json");
    execFileSync(process.execPath, [join(root, "bench/agent/run.mjs"), "--agent-cmd", "true",
      "--tasks", "tiered-price,tagged-ledger", "--tier", "hard", "--out", output], {stdio: "pipe"});
    report = JSON.parse(await readFile(output, "utf8"));
    assert.deepEqual(report.results.map(r => [r.id, r.tier]), [["tagged-ledger", "hard"]]);
    assert.equal(report.tiers.hard.tasks, 1);
    assert.deepEqual(report.tiers.core, {tasks: 0, passed: 0, passRate: null, medianRepairRounds: null});
    assert.throws(() => execFileSync(process.execPath, [join(root, "bench/agent/run.mjs"),
      "--agent-cmd", "true", "--tasks", "tiered-price", "--tier", "hard", "--out", output], {stdio: "pipe"}));
  } finally {
    for (const result of report?.results ?? []) await rm(result.taskDir, {recursive: true, force: true});
    await rm(dir, {recursive: true, force: true});
  }
});

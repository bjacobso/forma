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
    assert.deepEqual(report.results[0].failingCalls, []);
    assert.deepEqual(report.diagnostics, {});
    assert.deepEqual(report.tiers.core, {tasks: 0, passed: 0, passRate: null, medianRepairRounds: null});
    assert.throws(() => execFileSync(process.execPath, [join(root, "bench/agent/run.mjs"),
      "--agent-cmd", "true", "--tasks", "tiered-price", "--tier", "hard", "--out", output], {stdio: "pipe"}));
  } finally {
    for (const result of report?.results ?? []) await rm(result.taskDir, {recursive: true, force: true});
    await rm(dir, {recursive: true, force: true});
  }
});

test("diagnostics parse JSON or anchored human stderr and truncate message lines", async () => {
  const { parseDiagnostics } = await import("./harness.mjs");
  assert.deepEqual(parseDiagnostics("not JSON", `error[name]: Unknown name\n  details\nwarning[unused]: ${"x".repeat(220)}\nerror[name]: Again\n noise error[ignored]: no\n`), {
    diagnosticCodes: ["name", "unused"], messages: ["Unknown name", "x".repeat(200), "Again"],
  });
  assert.deepEqual(parseDiagnostics(JSON.stringify({ diagnostics: [
    { code: "type", message: "First line\nMore" }, { code: "type", message: "Again" },
  ] }), "error[ignored]: no"), { diagnosticCodes: ["type"], messages: ["First line", "Again"] });
  assert.deepEqual(parseDiagnostics("{}", "error[ignored]: no"), { diagnosticCodes: [], messages: [] });
});

test("summary counts failed calls and tasks and attributes only measured repair rounds", async () => {
  const { failingCalls, summarizeDiagnostics } = await import("./harness.mjs");
  const call = (target, exitCode, diagnosticCodes) => ({ argv: ["check", target], exitCode, diagnosticCodes, messages: ["message"] });
  const calls = [call("scratch.lisp", 1, ["name", "name"]), call("main.lisp", 1, ["type", "name"]),
    call("main.lisp", 0, ["unused"]), call("main.lisp", 1, ["type"]), call("main.lisp", 1, [])];
  assert.deepEqual(failingCalls(calls)[0], { argv: ["check", "scratch.lisp"], codes: ["name"], messages: ["message"] });
  assert.equal(failingCalls(calls).length, 4);
  const summary = summarizeDiagnostics([
    { calls, dir: "/tmp/task", entry: "main.lisp" },
    { calls: [call("main.lisp", 1, ["name"])], dir: "/tmp/other", entry: "main.lisp" },
  ]);
  assert.deepEqual(Object.keys(summary), ["name", "type"]);
  assert.deepEqual(summary, {
    name: { calls: 3, tasks: 2, repairRoundsAttributed: 2 },
    type: { calls: 2, tasks: 1, repairRoundsAttributed: 1 },
  });
});

test("simulated agent records a human check diagnostic on a broken file", async () => {
  const { writeFile, readFile, rm } = await import("node:fs/promises");
  const { prepare, runAgent } = await import("./harness.mjs");
  const { dir } = await prepare("tiered-price");
  try {
    await writeFile(`${dir}/main.lisp`, "unknownBenchmarkName\n");
    const result = await runAgent("forma check main.lisp", dir);
    assert.equal(result.exitCode, 1);
    const call = JSON.parse((await readFile(`${dir}/.forma-calls.jsonl`, "utf8")).trim());
    const log = await readFile(`${dir}/agent.log`, "utf8");
    assert.deepEqual(call.diagnosticCodes, [...new Set([...log.matchAll(/^error\[([^\]]+)\]:/gm)].map(match => match[1]))]);
    assert(call.diagnosticCodes.length > 0);
    assert(call.messages.length > 0);
    assert(call.messages.every(message => message.length <= 200 && !message.includes("\n")));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("report compares two generated result files side by side", async () => {
  const { execFileSync } = await import("node:child_process");
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { root } = await import("./harness.mjs");
  const dir = await mkdtemp(join(tmpdir(), "forma-report-test-"));
  try {
    const files = [join(dir, "model-a.json"), join(dir, "model-b.json")];
    for (const [i, file] of files.entries()) await writeFile(file, JSON.stringify({
      results: [{ id: "sample", tier: "core", pass: i === 0, repairRounds: i + 1,
        failingCalls: [{ argv: ["check", "main.lisp"], codes: ["name"], messages: ["Unknown"] },
          { argv: ["run", "main.lisp"], codes: [], messages: [] }] }],
      diagnostics: { name: { calls: i + 1, tasks: 1, repairRoundsAttributed: i + 1 } },
    }));
    const output = execFileSync(process.execPath, [join(root, "bench/agent/report.mjs"), ...files], { encoding: "utf8" });
    assert.match(output, /model-a.json.*model-b.json/);
    assert.match(output, /core pass rate\s+100% \(1\/1\)\s+0% \(0\/1\)/);
    assert.match(output, /core median repair rounds\s+1\s+2/);
    assert.match(output, /hard pass rate\s+n\/a \(0\/0\)\s+n\/a \(0\/0\)/);
    assert.match(output, /name\s+1 calls, 1 tasks, 1 rounds\s+2 calls, 1 tasks, 2 rounds/);
    assert.match(output, /sample\s+name -> \(no code\)\s+name -> \(no code\)/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

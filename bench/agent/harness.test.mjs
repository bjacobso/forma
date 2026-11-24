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

test("--mcp option parsing defaults to false and enables MCP mode", () => {
  assert.equal(parseOptions(["--agent-cmd", "true"]).mcp, false);
  assert.equal(parseOptions(["--agent-cmd", "true", "--mcp"]).mcp, true);
  assert.equal(parseOptions(["--mcp", "--agent-cmd", "true", "--tier", "hard"]).mcp, true);
});

test("MCP tool calls participate in repair rounds, diagnostics, and separate transport counts", async () => {
  const { failingCalls, mcpMetrics, summarizeDiagnostics } = await import("./harness.mjs");
  const calls = [
    { transport: "mcp", tool: "describe", args: { path: "lib.lisp" }, argv: ["mcp", "describe", "lib.lisp"], exitCode: 0, ok: true, diagnosticCodes: [], messages: [] },
    { transport: "mcp", tool: "check", args: { path: "main.lisp" }, argv: ["mcp", "check", "main.lisp"], exitCode: 1, ok: false, diagnosticCodes: ["typecheck/hole"], messages: ["Hole ?todo needs Int"] },
    { transport: "mcp", tool: "explain", args: { code: "typecheck/hole" }, argv: ["mcp", "explain", "typecheck/hole"], exitCode: 0, ok: true, diagnosticCodes: [], messages: [] },
    { argv: ["check", "main.lisp"], exitCode: 1, diagnosticCodes: ["typecheck/unbound-symbol"], messages: ["Unknown name"] },
    { transport: "mcp", tool: "run", args: { path: "main.lisp" }, argv: ["mcp", "run", "main.lisp"], exitCode: 0, ok: true, diagnosticCodes: [], messages: [] },
  ];
  assert.deepEqual(metrics(calls, "/tmp/task", "main.lisp"), { repairRounds: 2, cliCallCount: 1, firstPassingCall: 5 });
  assert.deepEqual(mcpMetrics(calls), { mcpCallCount: 4, mcpTools: { check: 1, describe: 1, explain: 1, run: 1 } });
  assert.deepEqual(failingCalls(calls), [
    { argv: ["mcp", "check", "main.lisp"], codes: ["typecheck/hole"], messages: ["Hole ?todo needs Int"], transport: "mcp", tool: "check" },
    { argv: ["check", "main.lisp"], codes: ["typecheck/unbound-symbol"], messages: ["Unknown name"] },
  ]);
  assert.deepEqual(summarizeDiagnostics([{ calls, dir: "/tmp/task", entry: "main.lisp" }]), {
    "typecheck/hole": { calls: 1, tasks: 1, repairRoundsAttributed: 1 },
    "typecheck/unbound-symbol": { calls: 1, tasks: 1, repairRoundsAttributed: 1 },
  });
});

test("--mcp mode exposes .mcp.json and records live MCP tool calls alongside CLI calls", async () => {
  const { execFileSync } = await import("node:child_process");
  const { mkdtemp, readFile, rm, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { root } = await import("./harness.mjs");
  const scratch = await mkdtemp(join(tmpdir(), "forma-mcp-run-test-"));
  let report;
  try {
    const clientScript = join(scratch, "mcp-agent.mjs");
    await writeFile(clientScript, `
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.env.FORMA_TASK_DIR;
const config = JSON.parse(readFileSync(process.env.FORMA_MCP_CONFIG, 'utf8'));
assert.equal(config.mcpServers.forma.command, process.env.FORMA_MCP_SERVER);
writeFileSync(join(dir, 'main.lisp'), '(: answer Int)\\n(define answer ?todo)\\n');

const server = spawn(config.mcpServers.forma.command, config.mcpServers.forma.args, { cwd: dir, stdio: ['pipe', 'pipe', 'pipe'] });
let buf = '';
const waiters = new Map();
server.stdout.on('data', chunk => {
  buf += chunk.toString('utf8');
  let nl;
  while ((nl = buf.indexOf('\\n')) !== -1) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    const msg = JSON.parse(line);
    if (msg.id !== undefined && waiters.has(msg.id)) {
      waiters.get(msg.id)(msg);
      waiters.delete(msg.id);
    }
  }
});
let nextId = 1;
const rpc = (method, params) => new Promise(resolve => {
  const id = nextId++;
  waiters.set(id, resolve);
  server.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\\n');
});
await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1.0.0' } });
server.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\\n');
const described = await rpc('tools/call', { name: 'describe', arguments: { path: 'bench/agent/fixtures/described-domain/quota-lib.lisp' } });
assert.equal(described.result.structuredContent.ok, true);
const holeCheck = await rpc('tools/call', { name: 'check', arguments: { path: 'main.lisp' } });
assert.equal(holeCheck.result.structuredContent.ok, false);
writeFileSync(join(dir, 'main.lisp'), '(: answer Int)\\n(define answer 42)\\n');
const passed = await rpc('tools/call', { name: 'check', arguments: { path: 'main.lisp' } });
assert.equal(passed.result.structuredContent.ok, true);
server.stdin.end();
await new Promise(resolve => server.on('close', resolve));
const cliRes = spawnSync('forma', ['check', 'main.lisp'], { cwd: dir, encoding: 'utf8' });
assert.equal(cliRes.status, 0);
`);
    const output = join(scratch, "mcp-results.json");
    const cmd = `'${process.execPath.replaceAll("'", "'\\''")}' '${clientScript.replaceAll("'", "'\\''")}'`;
    execFileSync(process.execPath, [join(root, "bench/agent/run.mjs"), "--mcp", "--tasks", "described-domain", "--agent-cmd", cmd, "--out", output], { stdio: "pipe", timeout: 60_000 });
    report = JSON.parse(await readFile(output, "utf8"));
    assert.equal(report.mode, "mcp");
    assert.equal(report.mcp.calls, 3);
    assert.deepEqual(report.mcp.tools, { check: 2, describe: 1 });
    const [task] = report.results;
    assert.equal(task.agent.exitCode, 0);
    assert.equal(task.cliCallCount, 1);
    assert.equal(task.mcpCallCount, 3);
    assert.deepEqual(task.mcpTools, { check: 2, describe: 1 });
    assert.equal(task.repairRounds, 1);
    assert.equal(task.firstPassingCall, 3);
    assert.deepEqual(task.failingCalls.map(c => c.codes), [["typecheck/hole"]]);
    assert.equal(report.diagnostics["typecheck/hole"].repairRoundsAttributed, 1);
  } finally {
    for (const result of report?.results ?? []) await rm(result.taskDir, { recursive: true, force: true });
    await rm(scratch, { recursive: true, force: true });
  }
});

test("report compares CLI and MCP runs side by side", async () => {
  const { execFileSync } = await import("node:child_process");
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { root } = await import("./harness.mjs");
  const dir = await mkdtemp(join(tmpdir(), "forma-report-mcp-test-"));
  try {
    const cliFile = join(dir, "cli.json");
    const mcpFile = join(dir, "mcp.json");
    await writeFile(cliFile, JSON.stringify({
      mode: "cli",
      results: [{ id: "typed-hole-repair", tier: "hard", pass: true, repairRounds: 3, cliCallCount: 6,
        failingCalls: [{ argv: ["check", "main.lisp"], codes: ["typecheck/hole"], messages: ["Hole ?net needs Int"] }] }],
      diagnostics: { "typecheck/hole": { calls: 2, tasks: 1, repairRoundsAttributed: 2 } },
    }));
    await writeFile(mcpFile, JSON.stringify({
      mode: "mcp",
      mcp: { calls: 4, tools: { check: 2, describe: 1, run: 1 } },
      results: [{ id: "typed-hole-repair", tier: "hard", pass: true, repairRounds: 1, cliCallCount: 0, mcpCallCount: 4,
        mcpTools: { check: 2, describe: 1, run: 1 },
        failingCalls: [{ argv: ["mcp", "check", "main.lisp"], codes: ["typecheck/hole"], messages: ["Hole ?net needs Int"], transport: "mcp", tool: "check" }] }],
      diagnostics: { "typecheck/hole": { calls: 1, tasks: 1, repairRoundsAttributed: 1 } },
    }));
    const output = execFileSync(process.execPath, [join(root, "bench/agent/report.mjs"), cliFile, mcpFile], { encoding: "utf8" });
    assert.match(output, /mode\s+cli\s+mcp/);
    assert.match(output, /hard pass rate\s+100% \(1\/1\)\s+100% \(1\/1\)/);
    assert.match(output, /hard median repair rounds\s+3\s+1/);
    assert.match(output, /CLI calls \(total\)\s+6\s+0/);
    assert.match(output, /MCP calls \(total\)\s+0\s+4/);
    assert.match(output, /mcp:check\s+—\s+2/);
    assert.match(output, /mcp:describe\s+—\s+1/);
    assert.match(output, /mcp:run\s+—\s+1/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

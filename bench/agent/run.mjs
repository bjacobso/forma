import { execFileSync } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { failingCalls, summarizeDiagnostics, median, metrics, parseOptions, prepare, root, runAgent, taskIds, tasksRoot } from "./harness.mjs";

const options = parseOptions(process.argv.slice(2));
const known = await taskIds();
let selected = options.tasks ?? known;
for (const id of selected) if (!known.includes(id)) throw new Error(`Unknown task: ${id}`);
if (options.tier) {
  const matching = [];
  for (const id of selected) {
    const context = JSON.parse(await readFile(join(tasksRoot, id, "context.json"), "utf8"));
    if (context.tier === options.tier) matching.push(id);
  }
  selected = matching;
}
if (!selected.length) throw new Error("No tasks match the requested filters");
const results = [];
const taskCalls = [];
for (const id of selected) {
  const { dir, context } = await prepare(id);
  const start = performance.now();
  const agent = await runAgent(options["agent-cmd"], dir);
  const wallTimeMs = performance.now() - start;
  let calls = [];
  try { calls = (await readFile(join(dir, ".forma-calls.jsonl"), "utf8")).trim().split("\n").filter(Boolean).map(JSON.parse); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  let acceptance;
  try {
    const { accept } = await import(pathToFileURL(join(tasksRoot, id, "accept.mjs")));
    acceptance = await accept(dir);
  } catch (error) { acceptance = { pass: false, reasons: [String(error)] }; }
  taskCalls.push({ calls, dir, entry: context.entry });
  results.push({ failingCalls: failingCalls(calls), id, kind: context.kind, tier: context.tier, ...acceptance, ...metrics(calls, dir, context.entry), wallTimeMs, agent, taskDir: dir });
  console.error(`${id}: ${acceptance.pass ? "PASS" : "FAIL"}${acceptance.reasons.length ? ` (${acceptance.reasons.join("; ")})` : ""}`);
}
const totals = rows => ({ tasks: rows.length, passed: rows.filter(r => r.pass).length,
  passRate: rows.length ? rows.filter(r => r.pass).length / rows.length : null,
  medianRepairRounds: median(rows.map(r => r.repairRounds)) });
const report = {
  schemaVersion: 1, timestamp: new Date().toISOString(), node: process.version,
  revision: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
  dirty: !!execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim(),
  agentCommand: options["agent-cmd"],
  totals: totals(results),
  tiers: Object.fromEntries(["core", "hard"].map(tier => [tier, totals(results.filter(r => r.tier === tier))])),
  diagnostics: summarizeDiagnostics(taskCalls),
  results,
};
await mkdir(dirname(resolve(options.out)), { recursive: true });
await writeFile(options.out, `${JSON.stringify(report, null, 2)}\n`);
console.table(results.map(({ id, tier, pass, repairRounds, cliCallCount, wallTimeMs }) => ({ id, tier, pass, repairRounds, cliCallCount, seconds: +(wallTimeMs / 1000).toFixed(2) })));
console.table(Object.entries(report.tiers).map(([tier, totals]) => ({ tier, ...totals })));
console.table(Object.entries(report.diagnostics).slice(0, 10).map(([code, counts]) => ({ code, ...counts })));
console.log(JSON.stringify(report.totals));

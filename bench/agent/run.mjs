import { execFileSync } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { median, metrics, parseOptions, prepare, root, runAgent, taskIds, tasksRoot } from "./harness.mjs";

const options = parseOptions(process.argv.slice(2));
const known = await taskIds();
const selected = options.tasks ?? known;
for (const id of selected) if (!known.includes(id)) throw new Error(`Unknown task: ${id}`);
const results = [];
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
  results.push({ id, kind: context.kind, ...acceptance, ...metrics(calls, dir, context.entry), wallTimeMs, agent, taskDir: dir });
  console.error(`${id}: ${acceptance.pass ? "PASS" : "FAIL"}${acceptance.reasons.length ? ` (${acceptance.reasons.join("; ")})` : ""}`);
}
const report = {
  schemaVersion: 1, timestamp: new Date().toISOString(), node: process.version,
  revision: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
  dirty: !!execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim(),
  agentCommand: options["agent-cmd"],
  totals: { tasks: results.length, passed: results.filter(r => r.pass).length,
    passRate: results.filter(r => r.pass).length / results.length,
    medianRepairRounds: median(results.map(r => r.repairRounds)) },
  results,
};
await mkdir(dirname(resolve(options.out)), { recursive: true });
await writeFile(options.out, `${JSON.stringify(report, null, 2)}\n`);
console.table(results.map(({ id, pass, repairRounds, cliCallCount, wallTimeMs }) => ({ id, pass, repairRounds, cliCallCount, seconds: +(wallTimeMs / 1000).toFixed(2) })));
console.log(JSON.stringify(report.totals));

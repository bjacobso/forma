import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { prepare, root, taskIds, tasksRoot } from "./harness.mjs";

const started = performance.now();
async function reference(id) {
  const { dir } = await prepare(id);
  try {
    const { accept } = await import(pathToFileURL(join(tasksRoot, id, "accept.mjs")));
    assert.equal((await accept(dir)).pass, false, `${id} must reject an empty submission`);
    if (id === "repair-dispatch") {
      await cp(join(root, "bench/agent/fixtures/repair-dispatch"), dir, {recursive: true});
      assert.equal((await accept(dir)).pass, false, "repair-dispatch must reject the seeded project");
    }
    await cp(join(tasksRoot, id, "reference"), dir, { recursive: true });
    const result = await accept(dir);
    assert.equal(result.pass, true, `${id}: ${result.reasons.join("; ")}`);
    console.log(`PASS reference ${id}`);
  } finally { await rm(dir, { recursive: true, force: true }); }
}
if (process.argv[2] === "--reference") {
  await reference(process.argv[3]);
  process.exit(0);
}
const ids = await taskIds();
assert.equal(ids.length, 20);
const kinds = {};
const tiers = {};
for (const id of ids) {
  const context = JSON.parse(await readFile(join(tasksRoot, id, "context.json"), "utf8"));
  assert(["core", "hard"].includes(context.tier), id);
  tiers[context.tier] = (tiers[context.tier] ?? 0) + 1;
  kinds[context.kind] = (kinds[context.kind] ?? 0) + 1;
}
assert.deepEqual(kinds, { form: 6, prelude: 6, kernel: 8 });
assert.deepEqual(tiers, { hard: 8, core: 12 });
// Bound process concurrency: acceptance uses synchronous CLI calls internally,
// so Promise.all around accept() alone would not parallelize those calls.
const queue = [...ids];
await Promise.all(Array.from({length: 2}, async () => {
  while (queue.length) {
    const id = queue.shift();
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [join(root, "bench/agent/validate.mjs"), "--reference", id], {stdio: "inherit"});
      child.on("error", reject);
      child.on("close", code => code === 0 ? resolve() : reject(new Error(`${id}: reference worker exited ${code}`)));
    });
  }
}));
const scratch = await mkdtemp(join(tmpdir(), "forma-agent-validation-"));
try {
  // The helper knows references only for this harness self-test. Real agents
  // receive no reference or acceptance files in their task directory.
  const helper = join(scratch, "copy-reference.mjs");
  await writeFile(helper, `import {cp,readFile} from 'node:fs/promises';\nimport {basename, join} from 'node:path';\nimport {spawnSync} from 'node:child_process';\nconst dir=process.env.FORMA_TASK_DIR;\nconst id=basename(dir).replace(/^forma-agent-/, '').replace(/-[^-]+$/, '');\nconst context=JSON.parse(await readFile(join(${JSON.stringify(tasksRoot)},id,'context.json'),'utf8'));\nspawnSync('forma',context.tier==='hard'?['check','--json','main.lisp']:['file','typecheck','main.lisp']);\nawait cp(join(${JSON.stringify(tasksRoot)},id,'reference'),dir,{recursive:true});\nconst r=spawnSync('forma',['file','typecheck','main.lisp']);\nprocess.exit(r.status ?? 1);\n`);
  const output = join(scratch, "results.json");
  const command = `'${process.execPath.replaceAll("'", "'\\''")}' '${helper.replaceAll("'", "'\\''")}'`;
  const result = spawnSync(process.execPath, [join(root, "bench/agent/run.mjs"), "--agent-cmd", command, "--out", output], { encoding: "utf8", timeout: 180_000 });
  process.stdout.write(result.stdout ?? "");
  process.stderr.write(result.stderr ?? "");
  assert.equal(result.status, 0, result.error?.message);
  const report = JSON.parse(await readFile(output, "utf8"));
  try {
    assert.equal(report.totals.passed, 20);
    assert.equal(report.tiers.core.tasks, 12);
    assert.equal(report.tiers.hard.tasks, 8);
    assert.equal(report.tiers.core.passed, 12);
    assert.equal(report.tiers.hard.passed, 8);
    for (const result of report.results) {
      assert.equal(result.agent.exitCode, 0, result.id);
      assert.equal(result.repairRounds, 1, result.id);
      assert.equal(result.cliCallCount, 2, result.id);
      const calls = (await readFile(join(result.taskDir, ".forma-calls.jsonl"), "utf8")).trim().split("\n").map(JSON.parse);
      assert(calls.every(c => c.durationMs > 0 && Array.isArray(c.diagnosticCodes)));
      assert(calls[0].diagnosticCodes.length > 0);
    }
  } finally {
    for (const result of report.results) await rm(result.taskDir, { recursive: true, force: true });
  }
} finally { await rm(scratch, { recursive: true, force: true }); }
console.log(`Agent benchmark validation: 20/20 references and 20/20 simulated agents passed in ${((performance.now() - started) / 1000).toFixed(1)}s.`);

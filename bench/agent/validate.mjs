import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { prepare, root, taskIds, tasksRoot } from "./harness.mjs";

const ids = await taskIds();
assert.equal(ids.length, 12);
const kinds = {};
for (const id of ids) {
  const { dir, context } = await prepare(id);
  kinds[context.kind] = (kinds[context.kind] ?? 0) + 1;
  try {
    const { accept } = await import(pathToFileURL(join(tasksRoot, id, "accept.mjs")));
    assert.equal((await accept(dir)).pass, false, `${id} must reject an empty submission`);
    await cp(join(tasksRoot, id, "reference"), dir, { recursive: true });
    const result = await accept(dir);
    assert.equal(result.pass, true, `${id}: ${result.reasons.join("; ")}`);
    console.log(`PASS reference ${id}`);
  } finally { await rm(dir, { recursive: true, force: true }); }
}
assert.deepEqual(kinds, { form: 4, prelude: 4, kernel: 4 });
const scratch = await mkdtemp(join(tmpdir(), "forma-agent-validation-"));
try {
  // The helper knows references only for this harness self-test. Real agents
  // receive no reference or acceptance files in their task directory.
  const helper = join(scratch, "copy-reference.mjs");
  await writeFile(helper, `import {cp} from 'node:fs/promises';\nimport {basename, join} from 'node:path';\nimport {spawnSync} from 'node:child_process';\nconst dir=process.env.FORMA_TASK_DIR;\nconst id=basename(dir).replace(/^forma-agent-/, '').replace(/-[^-]+$/, '');\nspawnSync('forma',['file','typecheck','main.lisp']);\nawait cp(join(${JSON.stringify(tasksRoot)},id,'reference'),dir,{recursive:true});\nconst r=spawnSync('forma',['file','typecheck','main.lisp']);\nprocess.exit(r.status ?? 1);\n`);
  const output = join(scratch, "results.json");
  const command = `'${process.execPath.replaceAll("'", "'\\''")}' '${helper.replaceAll("'", "'\\''")}'`;
  const result = spawnSync(process.execPath, [join(root, "bench/agent/run.mjs"), "--agent-cmd", command, "--out", output], { encoding: "utf8", timeout: 180_000 });
  process.stdout.write(result.stdout ?? "");
  process.stderr.write(result.stderr ?? "");
  assert.equal(result.status, 0, result.error?.message);
  const report = JSON.parse(await readFile(output, "utf8"));
  try {
    assert.equal(report.totals.passed, 12);
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
console.log("Agent benchmark validation: 12/12 references and 12/12 simulated agents passed.");

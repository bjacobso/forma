import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve, relative, delimiter } from "node:path";
import { fileURLToPath } from "node:url";

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const tasksRoot = join(root, "bench/agent/tasks");
export const cli = join(root, "packages/host/dist/cli.mjs");
export const median = values => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const i = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[i] : (sorted[i - 1] + sorted[i]) / 2;
};
export function parseOptions(args) {
  const options = { out: "results.json" };
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (!["--agent-cmd", "--tasks", "--tier", "--out"].includes(key) || !args[i + 1] || args[i + 1].startsWith("--")) {
      throw new Error("Usage: node bench/agent/run.mjs --agent-cmd COMMAND [--tasks a,b] [--tier core|hard] [--out results.json]");
    }
    options[key.slice(2)] = args[++i];
  }
  if (!options["agent-cmd"]) throw new Error("--agent-cmd is required");
  if (options.tasks) {
    options.tasks = options.tasks.split(",");
    if (options.tasks.some(id => !id) || new Set(options.tasks).size !== options.tasks.length) throw new Error("Task IDs must be nonempty and unique");
  }
  if (options.tier && !["core", "hard"].includes(options.tier)) throw new Error("Tier must be core or hard");
  return options;
}
export async function taskIds() {
  return (await readdir(tasksRoot, { withFileTypes: true })).filter(d => d.isDirectory()).map(d => d.name).sort();
}
// Self-contained so the generated wrapper can embed it without importing harness code.
export function parseDiagnostics(stdout, stderr) {
  let diagnostics;
  try { diagnostics = JSON.parse(stdout)?.diagnostics ?? []; }
  catch {
    diagnostics = [...(stderr ?? "").matchAll(/^(?:error|warning)\[([^\]]+)\]:[^\S\r\n]*(.*)$/gm)]
      .map(([, code, message]) => ({ code, message }));
  }
  if (!Array.isArray(diagnostics)) diagnostics = [];
  return {
    diagnosticCodes: [...new Set(diagnostics.map(d => d.code).filter(code => typeof code === "string"))],
    messages: diagnostics.map(d => String(d.message ?? "").split(/\r?\n/)[0].slice(0, 200)),
  };
}
export function failingCalls(calls) {
  return calls.filter(call => call.exitCode !== 0).map(call => ({
    argv: call.argv, codes: [...new Set(call.diagnosticCodes ?? [])], messages: call.messages ?? [],
  }));
}
export function summarizeDiagnostics(taskCalls) {
  const summary = new Map();
  for (const { calls, dir, entry } of taskCalls) {
    const repairs = new Set(repairCallIndices(calls, dir, entry).failures);
    const seen = new Set();
    for (const [i, call] of calls.entries()) {
      if (call.exitCode === 0) continue;
      for (const code of new Set(call.diagnosticCodes ?? [])) {
        if (!summary.has(code)) summary.set(code, { calls: 0, tasks: 0, repairRoundsAttributed: 0 });
        const counts = summary.get(code);
        counts.calls++;
        if (!seen.has(code)) counts.tasks++;
        if (repairs.has(i)) counts.repairRoundsAttributed++;
        seen.add(code);
      }
    }
  }
  return Object.fromEntries([...summary].sort(([a, x], [b, y]) => y.calls - x.calls || a.localeCompare(b)));
}
export async function prepare(id) {
  const task = join(tasksRoot, id);
  const context = JSON.parse(await readFile(join(task, "context.json"), "utf8"));
  const dir = await realpath(await mkdtemp(join(tmpdir(), `forma-agent-${id}-`)));
  await cp(join(task, "brief.md"), join(dir, "brief.md"));
  for (const path of context.files) {
    if (relative(root, resolve(root, path)).startsWith("..") || path === ".") throw new Error(`Invalid context path: ${path}`);
    await mkdir(dirname(join(dir, path)), { recursive: true });
    await cp(join(root, path), join(dir, path), { recursive: true });
  }
  await mkdir(join(dir, "bin"));
  // Embed absolute paths; logging is local to this sandbox and cannot be redirected by cwd.
  const wrapper = `#!${process.execPath}\nimport { spawnSync } from 'node:child_process';\nimport { appendFileSync } from 'node:fs';\nconst argv = process.argv.slice(2);\nconst start = performance.now();\nconst r = spawnSync(${JSON.stringify(process.execPath)}, [${JSON.stringify(cli)}, ...argv], {encoding:'utf8'});\nconst parseDiagnostics = ${parseDiagnostics.toString()};\nconst { diagnosticCodes, messages } = parseDiagnostics(r.stdout, r.stderr);\nappendFileSync(${JSON.stringify(join(dir, ".forma-calls.jsonl"))}, JSON.stringify({argv, cwd:process.cwd(), exitCode:r.status ?? 1, durationMs:performance.now()-start, diagnosticCodes, messages})+'\\n');\nprocess.stdout.write(r.stdout ?? '');\nprocess.stderr.write(r.stderr ?? r.error?.message ?? '');\nprocess.exit(r.status ?? 1);\n`;
  await writeFile(join(dir, "bin/forma"), wrapper, { mode: 0o755 });
  return { dir, context };
}
function repairCallIndices(calls, dir, entry) {
  const failures = [];
  let firstPassingCall = null;
  for (const [i, call] of calls.entries()) {
    const [command, mode, ...args] = call.argv;
    const target = (command === "file" ? args : call.argv.slice(1)).filter(a => !a.startsWith("--")).at(-1);
    if (!(command === "file" && ["typecheck", "evaluate", "declarations"].includes(mode)) &&
        !["check", "run", "test"].includes(command)) continue;
    if (!target ||
        resolve(call.cwd ?? dir, target) !== resolve(dir, entry) || firstPassingCall !== null) continue;
    if (call.exitCode === 0) firstPassingCall = i + 1;
    else failures.push(i);
  }
  return { failures, firstPassingCall };
}
export function metrics(calls, dir, entry) {
  const { failures, firstPassingCall } = repairCallIndices(calls, dir, entry);
  return { repairRounds: failures.length, cliCallCount: calls.length, firstPassingCall };
}
export function runAgent(command, dir) {
  return new Promise((done, reject) => {
    const child = spawn(command, { shell: true, cwd: dir, env: {
      ...process.env, FORMA_TASK_DIR: dir, PATH: `${join(dir, "bin")}${delimiter}${process.env.PATH}`,
    }, stdio: ["ignore", "pipe", "pipe"] });
    const logs = [];
    child.stdout.on("data", b => logs.push(b));
    child.stderr.on("data", b => logs.push(b));
    child.on("error", reject);
    child.on("close", async (exitCode, signal) => {
      try {
        await writeFile(join(dir, "agent.log"), Buffer.concat(logs));
        done({ exitCode, signal });
      } catch (error) { reject(error); }
    });
  });
}

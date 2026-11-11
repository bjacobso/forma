import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { cpus, platform, arch, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";

const started = performance.now();
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const baselinePath = join(root, "scripts/benchmarks/latency-baseline.json");
const options = { out: join(root, "scripts/benchmarks/latency-results.json"), update: false };
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === "--update-baseline") options.update = true;
  else if (process.argv[i] === "--out" && process.argv[i + 1]) options.out = resolve(process.argv[++i]);
  else throw new Error("Usage: node scripts/bench-latency.mjs [--update-baseline] [--out PATH]");
}
const samples = 9;
const warmup = 3;
const source = Array.from({ length: 500 }, (_, i) => `(define value-${i} (+ ${i} 1))`).join("\n") + "\nvalue-499\n";
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
function measure(run) {
  for (let i = 0; i < warmup; i++) run();
  const times = [];
  for (let i = 0; i < samples; i++) times.push(run());
  return { medianMs: median(times), samplesMs: times };
}
function timed(operation, verify) {
  const start = performance.now();
  const result = operation();
  const elapsed = performance.now() - start;
  verify(result);
  return elapsed;
}
const cli = join(root, "packages/host/dist/cli.mjs");
function processTime(args) {
  return timed(() => spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", timeout: 20_000 }), result => {
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    assert.equal(JSON.parse(result.stdout).ok, true);
  });
}
const temporary = await mkdtemp(join(tmpdir(), "forma-latency-"));
let results;
try {
  const file = join(temporary, "definitions.lisp");
  await writeFile(file, source);
  const engine = await import(pathToFileURL(join(root, "packages/ts/dist/Engine.mjs")));
  const { AnalysisWorkspace } = await import(pathToFileURL(join(root, "packages/ts/dist/Analysis.mjs")));
  const workspace = new AnalysisWorkspace();
  workspace.setDocument(file, source);
  assert.deepEqual(workspace.analysis(file).diagnostics, []);
  let edit = 0;
  results = {
    versionProcess: measure(() => processTime(["version"])),
    coldFileTypecheck500: measure(() => processTime(["file", "typecheck", file])),
    warmEngineTypecheck500: measure(() => timed(() => engine.typecheck({ source, sourceId: file }), result => {
      assert.equal(result.display, "Int");
      assert.deepEqual(result.diagnostics, []);
    })),
    // Each sample changes one definition and invalidates the workspace document.
    // This is the editor analysis path, not a memoized request on unchanged text.
    warmWorkspaceEdit500: measure(() => {
      const changed = source.replace("(define value-250 (+ 250 1))", `(define value-250 (+ 250 ${++edit + 1}))`);
      return timed(() => {
        workspace.setDocument(file, changed);
        return workspace.analysis(file);
      }, result => {
        assert.equal(result.resultType, "Int");
        assert.deepEqual(result.diagnostics, []);
      });
    }),
  };
} finally { await rm(temporary, { recursive: true, force: true }); }
async function distFiles(dir) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await distFiles(path));
    else if (entry.isFile()) files.push(path);
  }
  return files.sort();
}
const files = await distFiles(join(root, "packages/ts/dist"));
let distBytes = 0;
let distGzipBytes = 0;
for (const file of files) {
  const bytes = await readFile(file);
  distBytes += bytes.length;
  distGzipBytes += gzipSync(bytes, { level: 9 }).length;
}
const report = {
  durationMs: performance.now() - started,
  schemaVersion: 1, timestamp: new Date().toISOString(),
  revision: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
  dirty: !!execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim(),
  node: process.version, platform: `${platform()} ${arch()}`, cpu: cpus()[0]?.model,
  samples, warmup, definitions: 500, results,
  size: { distBytes, distGzipBytes, files: files.length, method: "All dist files, including declarations and maps; gzip level 9 per file, summed" },
};
let baseline;
try { baseline = JSON.parse(await readFile(baselinePath, "utf8")); }
catch (error) { if (error.code !== "ENOENT") throw error; }
const rows = Object.entries(results).map(([metric, result]) => ({
  metric, unit: "ms", current: +result.medianMs.toFixed(3),
  baseline: baseline?.results[metric]?.medianMs.toFixed(3) ?? "—",
  change: baseline?.results[metric] ? `${((result.medianMs / baseline.results[metric].medianMs - 1) * 100).toFixed(1)}%` : "—",
}));
for (const metric of ["distBytes", "distGzipBytes"]) rows.push({ metric, unit: "bytes", current: report.size[metric], baseline: baseline?.size[metric] ?? "—", change: baseline ? `${((report.size[metric] / baseline.size[metric] - 1) * 100).toFixed(1)}%` : "—" });
console.table(rows);
await mkdir(dirname(options.out), { recursive: true });
await writeFile(options.out, `${JSON.stringify(report, null, 2)}\n`);
if (options.update) {
  await mkdir(dirname(baselinePath), { recursive: true });
  await writeFile(baselinePath, `${JSON.stringify(report, null, 2)}\n`);
}
console.log(`Latency report: ${options.out}${options.update ? " (baseline updated)" : ""}`);

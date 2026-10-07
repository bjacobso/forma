import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { cpus, platform, arch } from "node:os";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const options = { samples: 9, warmup: 3, engine: "packages/ts/dist/Engine.mjs", label: "current" };
for (let i = 2; i < process.argv.length; i++) {
  const key = process.argv[i].replace(/^--/, "");
  if (!["samples", "warmup", "engine", "baseline", "output", "label"].includes(key) || !process.argv[i + 1]) {
    throw new Error("Usage: node scripts/benchmark-typecheck.mjs [--engine PATH] [--baseline PATH] [--label LABEL] [--samples N] [--warmup N] [--output PATH]");
  }
  const value = process.argv[++i];
  options[key] = ["samples", "warmup"].includes(key) ? Number(value) : value;
}
assert(Number.isInteger(options.samples) && options.samples > 0);
assert(Number.isInteger(options.warmup) && options.warmup > 0);

const workloads = [10, 100, 250, 500].map(count => ({
  name: `definitions-${count}`,
  source: Array.from({ length: count }, (_, i) => `(define value-${i} (+ ${i} 1))`).join("\n") + `\nvalue-${count - 1}`,
}));
workloads.push({
  name: "polymorphic-100",
  source: "(define identity [x] x)\n" + Array.from({ length: 100 }, (_, i) => `(define value-${i} (identity (+ ${i} 1)))`).join("\n") + "\nvalue-99",
});

// Validation and consumption happen outside the timed public API call.
let consumed = 0;
function check(engine, source) {
  const start = performance.now();
  const result = engine.typecheck({ source, sourceId: "benchmark" });
  const elapsed = performance.now() - start;
  assert.equal(result.display, "Int");
  assert.deepEqual(result.diagnostics, []);
  consumed += result.display.length;
  return elapsed;
}
const engines = [];
assert(!options.baseline || options.label !== "baseline", "Paired engine labels must differ");
for (const [label, path] of [
  ...(options.baseline ? [["baseline", options.baseline]] : []),
  [options.label, options.engine],
]) {
  const start = performance.now();
  const engine = await import(pathToFileURL(resolve(root, path)).href);
  const importMs = performance.now() - start;
  const firstCheckMs = check(engine, workloads[0].source);
  engines.push({ label, path, engine, importMs, firstCheckMs });
}
const results = [];
for (const workload of workloads) {
  for (let i = 0; i < options.warmup; i++) {
    for (const entry of engines) check(entry.engine, workload.source);
  }
  const samples = new Map(engines.map(entry => [entry.label, []]));
  for (let i = 0; i < options.samples; i++) {
    // Alternate the order of paired measurements to reduce ordering bias.
    for (const entry of i % 2 ? [...engines].reverse() : engines) {
      samples.get(entry.label).push(check(entry.engine, workload.source));
    }
  }
  for (const entry of engines) {
    const times = samples.get(entry.label);
    const sorted = [...times].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    const medianMs = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
    results.push({ workload: workload.name, label: entry.label, medianMs, samplesMs: times });
    console.error(`${entry.label} ${workload.name}: ${medianMs.toFixed(3)} ms`);
  }
}
const effectPackage = JSON.parse(await readFile(resolve(root, "node_modules/effect/package.json"), "utf8"));
const report = {
  timestamp: new Date().toISOString(),
  revision: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
  dirty: !!execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim(),
  node: process.version,
  effect: effectPackage.version,
  cpu: cpus()[0]?.model,
  logicalCpus: cpus().length,
  platform: `${platform()} ${arch()}`,
  command: ["node", ...process.argv.slice(1)],
  samples: options.samples,
  warmup: options.warmup,
  startup: engines.map(({ label, path, importMs, firstCheckMs }) => ({ label, path, importMs, firstCheckMs })),
  consumed,
  results,
};
const json = `${JSON.stringify(report, null, 2)}\n`;
if (options.output) {
  const path = resolve(root, options.output);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, json);
} else console.log(json);

// Profile a disposable build copy; production source and dist are never edited.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cp, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { cpus, tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), "forma-memo-profile-"));
const median = xs => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const source = Array.from({ length: 500 }, (_, i) => `(define value-${i} (+ ${i} 1))`).join("\n") + "\nvalue-499\n";
try {
  await cp(join(root, "packages/ts/dist"), join(temporary, "dist"), { recursive: true });
  await symlink(join(root, "node_modules"), join(temporary, "node_modules"));
  const target = join(temporary, "dist/type/infer-program.mjs");
  let text = await readFile(target, "utf8");
  const start = "for (const component of definitionComponents(defGroup)) {";
  const end = "for (const inferredDef of inferredDefs) lastDefType.set(inferredDef.name, inferredDef.type);";
  assert.equal(text.split(start).length, 2, "build shape changed: review instrumentation");
  assert.equal(text.split(end).length, 2, "build shape changed: review instrumentation");
  text = text.replace(start, `${start}\nconst memoStarted = performance.now();`)
    .replace(end, `${end}\nglobalThis.__memoProfile.push({names:component.map(d => d.name), ms:performance.now()-memoStarted});`);
  await writeFile(target, text);
  const { AnalysisWorkspace: Original } = await import(pathToFileURL(join(root, "packages/ts/dist/Analysis.mjs")));
  const { AnalysisWorkspace: Profiled } = await import(pathToFileURL(join(temporary, "dist/Analysis.mjs")));
  const original = new Original(), profiled = new Profiled();
  globalThis.__memoProfile = [];
  for (const workspace of [original, profiled]) {
    workspace.setDocument("benchmark.lisp", source);
    assert.deepEqual(workspace.analysis("benchmark.lisp").diagnostics, []);
  }
  const samples = [];
  for (let i = 0; i < 33; i++) {
    const changed = source.replace("(+ 250 1)", `(+ 250 ${i + 2})`);
    const times = {};
    let components;
    // Alternate order to limit systematic warmup/GC bias.
    for (const [label, workspace] of (i % 2 ? [["original", original], ["profiled", profiled]] : [["profiled", profiled], ["original", original]])) {
      globalThis.__memoProfile = [];
      const startTime = performance.now();
      workspace.setDocument("benchmark.lisp", changed);
      const result = workspace.analysis("benchmark.lisp");
      times[label] = performance.now() - startTime;
      assert.equal(result.resultType, "Int");
      assert.deepEqual(result.diagnostics, []);
      if (label === "profiled") components = globalThis.__memoProfile;
    }
    assert.equal(components.length, 500);
    const unchanged = components.filter(c => !c.names.includes("value-250"));
    assert.equal(unchanged.length, 499);
    if (i >= 3) samples.push({ ...times,
      unchangedMs: unchanged.reduce((sum, c) => sum + c.ms, 0),
      editedMs: components.find(c => c.names.includes("value-250")).ms });
  }
  const report = { revision: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
    node: process.version, cpu: cpus()[0]?.model, warmup: 3, samples,
    medians: Object.fromEntries(["original", "profiled", "unchangedMs", "editedMs"].map(k => [k, median(samples.map(s => s[k]))])),
    unchangedFraction: samples.reduce((n, s) => n + s.unchangedMs, 0) / samples.reduce((n, s) => n + s.profiled, 0),
    method: "Elapsed time inside each definition SCC, including environment application, inference and generalization; excludes graph construction, parse/lower and final projection. 499 unchanged independent definitions, one edited definition, unchanged final expression excluded. GC inside a component is charged to it." };
  const output = resolve(root, "docs/proposals/scripts/memo-profile.json");
  await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ output, medians: report.medians, unchangedFraction: report.unchangedFraction }, null, 2));
} finally {
  delete globalThis.__memoProfile;
  await rm(temporary, { recursive: true, force: true });
}

import assert from "node:assert/strict";
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Exploratory patches apply only to copied build artifacts under .context/.
// Keep these hypotheses separate from production compiler changes.
const script = fileURLToPath(import.meta.url);
const root = resolve(dirname(script), "..");
const variants = [
  "baseline",
  "substitution",
  "substitution-node-map",
  "step-counter",
];
const base = resolve(root, ".context/ts-perf-variants");
const replace = (path, from, to) => {
  const source = readFileSync(path, "utf8");
  assert.equal(
    source.split(from).length,
    2,
    `Expected exactly one patch location in ${path}`,
  );
  writeFileSync(path, source.replace(from, to));
};
if (!process.argv.includes("--worker") && !process.argv.includes("--large")) {
  mkdirSync(base, { recursive: true });
  const results = { measuredAt: new Date().toISOString(), variants: {} };
  for (const variant of variants) {
    const dir = resolve(base, variant);
    cpSync(resolve(root, "packages/ts/dist"), dir, { recursive: true });
    if (variant.startsWith("substitution")) {
      const path = resolve(dir, "type/substitution.mjs");
      replace(
        path,
        "function applyScheme(s, scheme) {",
        `function restrictForBenchmark(map, bound) {
        if (!bound.some(v => map.has(v))) return map;
        const copy = new Map(map);
        for (const v of bound) copy.delete(v);
        return copy;
      }
      function applyScheme(s, scheme) {`,
      );
      for (const [field, name] of [
        ["tvars", "tRestricted"],
        ["rvars", "rRestricted"],
        ["evars", "eRestricted"],
      ]) {
        replace(
          path,
          `const ${name} = new Map(s.${field});\n\tfor (const v of scheme.${field}) ${name}.delete(v);`,
          `const ${name} = restrictForBenchmark(s.${field}, scheme.${field});`,
        );
      }
    }
    if (variant === "substitution-node-map") {
      replace(
        resolve(dir, "type/context.mjs"),
        "const next = new Map(m);\n\t\t\t\t\tnext.set(nodeId, resolved);\n\t\t\t\t\treturn next;",
        "m.set(nodeId, resolved);\n\t\t\t\t\treturn m;",
      );
    }
    if (variant === "step-counter") {
      const path = resolve(dir, "vm/vm.mjs");
      replace(
        path,
        "stepCounter: yield* Ref.make(0)",
        "stepCounter: { value: 0 }",
      );
      replace(
        path,
        "yield* Ref.updateAndGet(stepCounter, (count) => count + 1)",
        "++stepCounter.value",
      );
      replace(
        path,
        "yield* Ref.update(stepCounter, (count) => count - 1)",
        "stepCounter.value--",
      );
    }
    const child = spawnSync(process.execPath, [script, "--worker", variant], {
      cwd: root,
      encoding: "utf8",
      timeout: 240000,
    });
    assert.equal(child.status, 0, child.stderr);
    results.variants[variant] = JSON.parse(child.stdout);
    console.log(variant, JSON.stringify(results.variants[variant].timings));
    writeFileSync(
      resolve(root, ".context/perf-experiments.json"),
      JSON.stringify(results, null, 2) + "\n",
    );
  }
  for (const variant of variants)
    assert.deepEqual(
      results.variants[variant].correctness,
      results.variants.baseline.correctness,
      variant + " output differs",
    );
  results.large = {
    measuredAt: new Date().toISOString(),
    workload: "definitions-500/typecheck",
    variants: {},
  };
  for (const variant of ["substitution", "substitution-node-map"]) {
    const child = spawnSync(process.execPath, [script, "--large", variant], {
      cwd: root,
      encoding: "utf8",
      timeout: 120000,
    });
    assert.equal(child.status, 0, child.stderr);
    results.large.variants[variant] = JSON.parse(child.stdout);
  }
  writeFileSync(
    resolve(root, ".context/perf-experiments.json"),
    JSON.stringify(results, null, 2) + "\n",
  );
  console.log("All experimental outputs match baseline.");
} else if (process.argv.includes("--worker")) {
  const variant = process.argv.at(-1);
  const E = await import(pathToFileURL(resolve(base, variant, "Engine.mjs")));
  const VM = await import(pathToFileURL(resolve(base, variant, "VM.mjs")));
  const Reader = await import(
    pathToFileURL(resolve(base, variant, "Reader.mjs"))
  );
  const Builtins = await import(
    pathToFileURL(resolve(base, variant, "Builtins.mjs"))
  );
  const { Effect } = await import("effect");
  const workloads = [];
  for (const count of [100, 250]) {
    workloads.push({
      id: `definitions-${count}/typecheck`,
      pass: "typecheck",
      source:
        Array.from(
          { length: count },
          (_, i) => `(define value-${i} (+ ${i} 1))`,
        ).join("\n") + `\nvalue-${count - 1}`,
    });
  }
  workloads.push({
    id: "polymorphic-100/typecheck",
    pass: "typecheck",
    source:
      "(define identity [x] x)\n" +
      Array.from(
        { length: 100 },
        (_, i) => `(define value-${i} (identity (+ ${i} 1)))`,
      ).join("\n") +
      "\nvalue-99",
  });
  workloads.push({
    id: "map-reduce-1000/evaluate",
    pass: "evaluate",
    source: `(reduce (fn [a b] (+ a b)) 0 (map (fn [x] (+ (* x x) 1)) [${Array.from({ length: 1000 }, (_, i) => i).join(" ")}]))`,
  });
  // Many VM arithmetic operations with few expensive collection callbacks.
  const arithmetic = `(do ${Array.from({ length: 1000 }, () => "(+ 1 2)").join(" ")})`;
  workloads.push({
    id: "arithmetic-1000/evaluate",
    pass: "evaluate",
    source: arithmetic,
  });
  workloads.push({
    id: "arithmetic-1000/precompiled",
    pass: "precompiled",
    source: arithmetic,
  });
  const output = { timings: {}, correctness: {} };
  for (const w of workloads) {
    let op;
    if (w.pass === "precompiled") {
      const compiled = VM.compileProgram(
        Effect.runSync(Reader.parseManyToSExpr(w.source)),
        { builtins: Builtins.defaultBuiltins },
      );
      op = () => ({
        ...Effect.runSync(
          VM.runChunkWithStats(compiled.chunk, {
            builtins: compiled.builtinRegistry.toArray(
              Builtins.defaultBuiltins,
            ),
            builtinLookup: compiled.builtinRegistry.toMap(
              Builtins.defaultBuiltins,
            ),
            globals: new Array(compiled.globals.count),
            stepLimit: 2000000,
          }),
        ),
        diagnostics: [],
      });
    } else op = () => E[w.pass]({ source: w.source, stepLimit: 2000000 });
    let result;
    for (let i = 0; i < 5; i++)
      result = w.pass === "evaluate" ? await op() : op();
    assert.equal(
      result.diagnostics.length,
      0,
      JSON.stringify(result.diagnostics),
    );
    const pilot = performance.now();
    result = w.pass === "evaluate" ? await op() : op();
    const batch = Math.max(
      1,
      Math.min(100, Math.ceil(100 / (performance.now() - pilot))),
    );
    const samples = [];
    for (let sample = 0; sample < 9; sample++) {
      const started = performance.now();
      for (let i = 0; i < batch; i++)
        result = w.pass === "evaluate" ? await op() : op();
      samples.push((performance.now() - started) / batch);
    }
    output.timings[w.id] = {
      medianMs: [...samples].sort((a, b) => a - b)[4],
      samplesMs: samples,
      batch,
    };
    output.correctness[w.id] = {
      display: result.display,
      value: result.value,
      steps: result.steps,
      diagnostics: result.diagnostics,
    };
  }
  // Check representative successes and failures across actual shared type fixtures.
  const manifest = JSON.parse(
    readFileSync(resolve(root, "conformance/engine-parity/cases.json")),
  );
  for (const fixture of manifest.cases.filter(
    (f) => f.passes.includes("typecheck") && !f.preludes?.length,
  )) {
    const source =
      fixture.source ??
      readFileSync(
        resolve(root, "conformance/engine-parity", fixture.sourceFile),
        "utf8",
      );
    const result = E.typecheck({ source, sourceId: fixture.id });
    output.correctness["fixture/" + fixture.id] = {
      display: result.display,
      diagnostics: result.diagnostics,
    };
  }
  console.log(JSON.stringify(output));
} else {
  const variant = process.argv.at(-1);
  const E = await import(pathToFileURL(resolve(base, variant, "Engine.mjs")));
  const source =
    Array.from(
      { length: 500 },
      (_, i) => `(define value-${i} (+ ${i} 1))`,
    ).join("\n") + "\nvalue-499";
  for (let i = 0; i < 5; i++) E.typecheck({ source });
  const samplesMs = [];
  for (let i = 0; i < 9; i++) {
    const started = performance.now();
    const result = E.typecheck({ source });
    samplesMs.push(performance.now() - started);
    assert.equal(result.display, "Int");
    assert.equal(result.diagnostics.length, 0);
  }
  console.log(
    JSON.stringify({
      medianMs: [...samplesMs].sort((a, b) => a - b)[4],
      samplesMs,
    }),
  );
}

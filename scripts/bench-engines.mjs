// Run after building TypeScript, OCaml native/JS, and the OCaml bench executable.
// Each engine has a persistent worker. Timers exclude worker IPC and startup.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { cpus, release } from "node:os";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const script = fileURLToPath(import.meta.url);
const nativeCli = resolve(root, "packages/ocaml/dist/native/forma_cli.exe");
const nativeBench = resolve(
  root,
  "packages/ocaml/_build/default/bench/engine_bench.exe",
);
const jsArtifact = resolve(root, "packages/ocaml/dist/js/jsoo_entry.cjs");
const tsArtifact = resolve(root, "packages/ts/dist/Engine.mjs");

const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : process.argv[index + 1];
};
const percentile = (values, fraction) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
};
const hash = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

async function worker(engine) {
  let run;
  if (engine === "typescript") {
    const api = await import(tsArtifact);
    run = (workload) => {
      const request = {
        source: workload.source,
        sourceId: "benchmark",
        stepLimit: 2_000_000,
      };
      if (process.argv.includes("--wire-typescript")) {
        const payload = JSON.stringify(request);
        return () => {
          const result = api[workload.pass](JSON.parse(payload));
          return workload.pass === "evaluate"
            ? result.then((value) => JSON.stringify(value))
            : JSON.stringify(result);
        };
      }
      return () => api[workload.pass](request);
    };
  } else {
    // The artifact prints a version line at import, as it does in the LSP bridge.
    process.argv = process.argv.slice(0, 2);
    const artifact = createRequire(import.meta.url)(jsArtifact);
    assert.equal(typeof artifact.formaOcaml?.handleJson, "function");
    run = (workload) => {
      const payload = JSON.stringify(abiRequest(workload));
      return () => artifact.formaOcaml.handleJson(payload);
    };
  }
  console.log(JSON.stringify({ ready: true }));
  for await (const line of createInterface({ input: process.stdin })) {
    const { workload, warmup, batch, samples } = JSON.parse(line);
    const operation = run(workload);
    // OCaml is synchronous. TypeScript evaluation runs the public async facade.
    const asynchronous =
      engine === "typescript" && workload.pass === "evaluate";
    let response = asynchronous ? await operation() : operation();
    for (let i = 0; i < warmup; i++)
      response = asynchronous ? await operation() : operation();
    const samplesMs = [];
    for (let sample = 0; sample < samples; sample++) {
      const started = performance.now();
      for (let i = 0; i < batch; i++)
        response = asynchronous ? await operation() : operation();
      samplesMs.push((performance.now() - started) / batch);
    }
    if (engine !== "typescript" || process.argv.includes("--wire-typescript"))
      response = JSON.parse(response);
    console.log(JSON.stringify({ response, samplesMs }));
  }
}

function abiRequest(workload) {
  return {
    op: workload.pass === "parse" ? "parseAst" : workload.pass,
    sourceId: "benchmark",
    source: workload.source,
  };
}

class Worker {
  constructor(engine) {
    this.engine = engine;
    const command = engine === "ocaml-native" ? nativeBench : process.execPath;
    const args = engine === "ocaml-native" ? [] : [script, "--worker", engine];
    if (engine === "typescript" && process.argv.includes("--wire-typescript"))
      args.push("--wire-typescript");
    this.child = spawn(command, args, {
      cwd: root,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.pending = [];
    this.stderr = "";
    this.ready = new Promise((resolveReady, rejectReady) => {
      this.resolveReady = resolveReady;
      this.rejectReady = rejectReady;
    });
    this.child.stderr.on("data", (chunk) => {
      this.stderr += chunk;
    });
    createInterface({ input: this.child.stdout }).on("line", (line) => {
      try {
        const value = JSON.parse(line);
        if (value.ready) this.resolveReady();
        else if (Object.hasOwn(value, "samplesMs"))
          this.pending.shift()?.resolve(value);
      } catch (error) {
        this.fail(error);
      }
    });
    this.child.on("error", (error) => this.fail(error));
    this.child.stdin.on("error", (error) => this.fail(error));
    this.exit = new Promise((resolveExit) => {
      this.child.on("close", (code) => {
        this.fail(new Error(`${engine} exited (${code}): ${this.stderr}`));
        resolveExit(code);
      });
    });
  }
  fail(error) {
    this.rejectReady(error);
    for (const pending of this.pending.splice(0)) pending.reject(error);
  }
  async measure(workload, config) {
    await this.ready;
    return new Promise((resolveResult, reject) => {
      const timer = setTimeout(() => {
        this.child.kill();
        reject(new Error(`${this.engine}/${workload.id} exceeded 120 seconds`));
      }, 120_000);
      this.pending.push({
        resolve: (value) => {
          clearTimeout(timer);
          resolveResult(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      const message =
        this.engine === "ocaml-native"
          ? `${config.warmup} ${config.batch} ${config.samples}\n${JSON.stringify(abiRequest(workload))}\n`
          : `${JSON.stringify({ workload, ...config })}\n`;
      this.child.stdin.write(message);
    });
  }
  async close() {
    this.child.stdin.end();
    await this.exit;
  }
}

function workloads() {
  const result = [];
  const add = (id, source, passes, expectedValue, expectedType) => {
    for (const pass of passes)
      result.push({
        id: `${id}/${pass}`,
        source,
        pass,
        expectedValue,
        expectedType,
      });
  };
  add(
    "arithmetic",
    "(+ 1 2)",
    ["parse", "expand", "typecheck", "evaluate"],
    3,
    "Int",
  );
  for (const count of [10, 100, 500]) {
    const defs =
      Array.from(
        { length: count },
        (_, i) => `(define value-${i} (+ ${i} 1))`,
      ).join("\n") + `\nvalue-${count - 1}`;
    add(
      `definitions-${count}`,
      defs,
      ["parse", "typecheck", "evaluate"],
      count,
      "Int",
    );
  }
  const polymorphic =
    "(define identity [x] x)\n" +
    Array.from(
      { length: 100 },
      (_, i) => `(define value-${i} (identity (+ ${i} 1)))`,
    ).join("\n") +
    "\nvalue-99";
  add("polymorphic-100", polymorphic, ["typecheck"], 100, "Int");
  const macros =
    "(macro (twice x) `(+ ~x ~x))\n" +
    Array.from({ length: 100 }, (_, i) => `(twice ${i})`).join("\n");
  add("macros-100", macros, ["expand", "typecheck", "evaluate"], 198, "Int");
  for (const count of [100, 1000]) {
    const vector = `[${Array.from({ length: count }, (_, i) => i).join(" ")}]`;
    add(
      `map-reduce-${count}`,
      `(reduce (fn [a b] (+ a b)) 0 (map (fn [x] (+ (* x x) 1)) ${vector}))`,
      ["evaluate"],
      (count * (count - 1) * (2 * count - 1)) / 6 + count,
    );
  }
  for (const filename of ["compiler.lisp", "ontology.lisp"]) {
    add(
      `prelude-${filename}`,
      readFileSync(resolve(root, "preludes", filename), "utf8"),
      ["parse"],
    );
  }
  add(
    "checkout",
    readFileSync(
      resolve(
        root,
        "conformance/effect-typescript/cases/multi-service-checkout/program.lisp",
      ),
      "utf8",
    ),
    ["parse"],
  );
  add(
    "operational-effects",
    readFileSync(
      resolve(root, "conformance/operational-effects/program.lisp"),
      "utf8",
    ),
    ["typecheck"],
  );
  return result;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== "span")
      .map(([key, item]) => [key, canonical(item)]),
  );
}

function validate(workload, responses) {
  for (const [engine, response] of Object.entries(responses)) {
    assert.equal(
      response.ok === false,
      false,
      `${engine}/${workload.id}: ${JSON.stringify(response)}`,
    );
    assert.equal(
      (response.diagnostics ?? []).filter((d) => d.severity !== "warning")
        .length,
      0,
      `${engine}/${workload.id}: diagnostics`,
    );
  }
  const ts = responses.typescript;
  const native = responses["ocaml-native"];
  const js = responses["ocaml-js"];
  assert.deepEqual(
    canonical(native),
    canonical(js),
    `${workload.id}: OCaml target mismatch`,
  );
  if (workload.pass === "parse" || workload.pass === "expand") {
    // OCaml retains macro declarations in expansion output; TS removes them.
    // Compare expanded runtime forms, retaining every other AST difference.
    const runtimeForms = (ast) =>
      workload.pass === "expand"
        ? ast.filter((node) => node.items?.[0]?.value !== "__macro")
        : ast;
    assert.deepEqual(
      canonical(runtimeForms(ts.ast)),
      canonical(runtimeForms(native.value)),
      `${workload.id}: AST mismatch`,
    );
    return { kind: "ast", forms: ts.ast.length, hash: hash(canonical(ts.ast)) };
  }
  if (workload.pass === "evaluate") {
    assert.equal(ts.value, workload.expectedValue, `${workload.id}: TS value`);
    assert.equal(
      native.value.value,
      workload.expectedValue,
      `${workload.id}: OCaml value`,
    );
    return { kind: "value", value: workload.expectedValue };
  }
  const normalized = (display) =>
    display.replace(/\bStr\b/g, "String").replace(/\bNumber\b/g, "Int");
  assert.equal(
    normalized(ts.display),
    normalized(native.type),
    `${workload.id}: inferred type mismatch`,
  );
  if (workload.expectedType)
    assert.equal(normalized(ts.display), workload.expectedType);
  return { kind: "type", display: ts.display, ocamlDisplay: native.type };
}

function coldStart(engine, count) {
  const samplesMs = [];
  for (let i = 0; i < count + 1; i++) {
    const started = performance.now();
    const command = engine === "ocaml-native" ? nativeCli : process.execPath;
    const args =
      engine === "ocaml-native"
        ? ["request", '{"op":"version"}']
        : engine === "ocaml-js"
          ? [jsArtifact, '{"op":"version"}']
          : [
              "--input-type=module",
              "-e",
              `await import(${JSON.stringify(tsArtifact)});`,
            ];
    const child = spawnSync(command, args, {
      cwd: root,
      encoding: "utf8",
      timeout: 30_000,
    });
    assert.equal(child.status, 0, child.stderr || String(child.error));
    if (i > 0) samplesMs.push(performance.now() - started);
  }
  return {
    samplesMs,
    medianMs: percentile(samplesMs, 0.5),
    p95Ms: percentile(samplesMs, 0.95),
  };
}

async function main() {
  const output = resolve(
    arg("--report", resolve(root, ".context/engine-benchmark.json")),
  );
  const samples = Number(arg("--samples", "9"));
  assert.ok(
    Number.isInteger(samples) && samples >= 3,
    "--samples must be an integer >= 3",
  );
  const engines = ["typescript", "ocaml-native", "ocaml-js"];
  for (const path of [tsArtifact, nativeCli, nativeBench, jsArtifact])
    assert.ok(existsSync(path), `Missing build: ${path}`);
  const report = {
    version: 1,
    status: "running",
    measuredAt: new Date().toISOString(),
    revision: spawnSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).stdout.trim(),
    environment: {
      node: process.version,
      platform: process.platform,
      kernel: release(),
      cpu: cpus()[0].model,
      logicalCpus: cpus().length,
      ocaml: spawnSync("opam", ["exec", "--", "ocamlc", "-version"], {
        cwd: root,
        encoding: "utf8",
      }).stdout.trim(),
      jsOfOcaml: spawnSync("opam", ["exec", "--", "js_of_ocaml", "--version"], {
        cwd: root,
        encoding: "utf8",
      }).stdout.trim(),
    },
    methodology: {
      warmup:
        "Adaptive batching targets approximately 100ms per sample; warmup is at least 5 calls or two batches.",
      samples,
      typescriptTransport: process.argv.includes("--wire-typescript")
        ? "json-roundtrip"
        : "objects",
      timing:
        "Persistent processes; timed batches exclude parent-worker IPC. " +
        (process.argv.includes("--wire-typescript")
          ? "TS includes JSON request decoding and response encoding. "
          : "TS returns objects. ") +
        "OCaml ABI includes request decoding and response JSON encoding. Response JSON decoding in Node is outside timing.",
      correctness:
        "Successful diagnostics, expected scalar values/types, AST structure without spans, and agreement between OCaml native/JS. Expand compares runtime forms (OCaml retains __macro declarations; TS drops them). Number maps to Int only for these integer-only fixtures; Str maps to String.",
      coldStart:
        "Process launch + TS Engine module import or OCaml version request; filesystem caches warm, one discarded launch. Not browser download latency.",
    },
    coldStart: {},
    workloads: [],
  };
  const selected = workloads().filter(
    (w) => !arg("--case", "") || w.id === arg("--case", ""),
  );
  assert.ok(selected.length, "No matching benchmark case");
  if (process.argv.includes("--resume") && existsSync(output)) {
    const previous = JSON.parse(readFileSync(output, "utf8"));
    assert.equal(
      previous.revision,
      report.revision,
      "Cannot resume a different revision",
    );
    assert.equal(
      previous.environment.node,
      report.environment.node,
      "Cannot resume a different Node version",
    );
    assert.equal(
      previous.methodology.samples,
      samples,
      "Cannot resume a different sample count",
    );
    assert.equal(
      previous.methodology.typescriptTransport,
      report.methodology.typescriptTransport,
      "Cannot resume a different transport mode",
    );
    for (const row of previous.workloads) {
      const workload = selected.find((w) => w.id === row.id);
      assert.ok(workload, `Unknown resumed workload: ${row.id}`);
      assert.equal(row.sourceBytes, Buffer.byteLength(workload.source));
      assert.equal(
        row.sourceHash,
        hash(workload.source),
        `Source changed: ${row.id}`,
      );
    }
    report.workloads = previous.workloads;
    report.coldStart = previous.coldStart;
    report.measuredAt = previous.measuredAt;
    report.resumedAt = new Date().toISOString();
  } else {
    for (const engine of engines)
      report.coldStart[engine] = coldStart(engine, samples);
  }
  const workers = Object.fromEntries(
    engines.map((engine) => [engine, new Worker(engine)]),
  );
  try {
    for (const [index, workload] of selected.entries()) {
      if (report.workloads.some((row) => row.id === workload.id)) continue;
      const responses = {};
      const measures = {};
      // Rotate execution order across cases; only one worker does timed work at once.
      const order = engines
        .slice(index % 3)
        .concat(engines.slice(0, index % 3));
      for (const engine of order) {
        const pilot = await workers[engine].measure(workload, {
          warmup: 3,
          batch: 1,
          samples: 3,
        });
        const batch = Math.max(
          1,
          Math.min(
            5000,
            Math.ceil(100 / Math.max(0.02, percentile(pilot.samplesMs, 0.5))),
          ),
        );
        const measured = await workers[engine].measure(workload, {
          warmup: Math.max(5, batch * 2),
          batch,
          samples,
        });
        responses[engine] = measured.response;
        measures[engine] = {
          batch,
          warmup: Math.max(5, batch * 2),
          samplesMs: measured.samplesMs,
          medianMs: percentile(measured.samplesMs, 0.5),
          p95Ms: percentile(measured.samplesMs, 0.95),
        };
      }
      const correctness = validate(workload, responses);
      const row = {
        id: workload.id,
        sourceBytes: Buffer.byteLength(workload.source),
        sourceHash: hash(workload.source),
        pass: workload.pass,
        correctness,
        engines: measures,
      };
      report.workloads.push(row);
      console.log(
        `${workload.id}: ${engines.map((e) => `${e}=${measures[e].medianMs.toFixed(3)}ms`).join(" ")}`,
      );
      mkdirSync(dirname(output), { recursive: true });
      writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
    }
  } finally {
    await Promise.all(Object.values(workers).map((worker) => worker.close()));
  }
  report.status = "complete";
  writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
  console.log(`Report: ${output}`);
}

if (process.argv.includes("--worker")) await worker(arg("--worker"));
else await main();

import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createInterface } from "node:readline";
import { brotliCompressSync, gzipSync } from "node:zlib";
import { readExampleSources, readPreludes } from "./corpus.mjs";

const cwd = new URL("..", import.meta.url);
const daemonResponseTimeoutMs = Number(process.env.FORMA_DAEMON_TIMEOUT_MS ?? 30000);

const run = (command, args) => {
  const started = performance.now();
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
  });
  const elapsedMs = performance.now() - started;

  if (result.error?.code === "ENOENT") {
    console.error(
      `Missing required command: ${command}. Install OCaml and Dune before benchmarking @formalang/ocaml.`,
    );
    process.exit(127);
  }

  if (result.status !== 0) {
    process.stderr.write(result.stderr ?? "");
    process.stdout.write(result.stdout ?? "");
    process.exit(result.status ?? 1);
  }

  return { result, elapsedMs };
};

const fileBytes = (path) => statSync(path).size;

const listFiles = (path) => {
  if (!existsSync(path)) {
    return [];
  }

  const stat = statSync(path);
  if (stat.isFile()) {
    return [path];
  }

  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const child = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, path);
    return listFiles(child);
  });
};

const brotliBytes = (paths) =>
  brotliCompressSync(Buffer.concat(paths.map((path) => readFileSync(path)))).byteLength;

const gzipBytes = (paths) =>
  gzipSync(Buffer.concat(paths.map((path) => readFileSync(path)))).byteLength;

const corpusSummary = async (nativePath) => {
  const preludes = readPreludes({ kind: "prelude" });
  const sources = readExampleSources({
    kind: "source",
    canonicalOnly: true,
    dropOntologyManifest: true,
  });

  const daemon = spawn(nativePath.pathname, ["daemon"], {
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stderr = "";
  daemon.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  const responses = [];
  const waiters = [];
  const lines = createInterface({ input: daemon.stdout });
  lines.on("line", (line) => {
    responses.push(line);
    const waiter = waiters.shift();
    if (waiter) waiter();
  });

  const waitForLine = async () => {
    if (responses.length > 0) return responses.shift();
    return new Promise((resolveLine, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Timed out waiting for daemon response. stderr: ${stderr}`));
      }, daemonResponseTimeoutMs);
      waiters.push(() => {
        clearTimeout(timeout);
        resolveLine(responses.shift());
      });
    });
  };

  const request = async (payload) => {
    daemon.stdin.write(`${JSON.stringify(payload)}\n`);
    return JSON.parse(await waitForLine());
  };

  const cacheHitForSource = (response, sourceId) => {
    const sourceCache = response?.value?.sourceCache ?? [];
    const source = sourceCache.find((entry) => entry.sourceId === sourceId);
    return source?.cacheHit ?? null;
  };

  const started = performance.now();
  const openStarted = performance.now();
  const opened = await request({ op: "openSession" });
  const openMs = Number((performance.now() - openStarted).toFixed(2));
  const sessionId = opened.value.sessionId;
  const preludeLoadStarted = performance.now();
  const loadedPreludes = await request({
    op: "loadSourceBundle",
    sessionId,
    sources: preludes,
  });
  const preludeLoadMs = Number((performance.now() - preludeLoadStarted).toFixed(2));
  const sourceLoadStarted = performance.now();
  const loadedSources = await request({
    op: "loadSourceBundle",
    sessionId,
    sources,
  });
  const sourceLoadMs = Number((performance.now() - sourceLoadStarted).toFixed(2));
  const sourceIds = sources.map((source) => source.sourceId);
  const firstSummarizeStarted = performance.now();
  const artifact = await request({ op: "artifactSummary", sessionId, sourceIds });
  const firstSummarizeMs = Number((performance.now() - firstSummarizeStarted).toFixed(2));
  const loadAndSummarizeMs = Number((performance.now() - started).toFixed(2));
  const warmStarted = performance.now();
  const warmArtifact = await request({ op: "artifactSummary", sessionId, sourceIds });
  const warmSummarizeMs = Number((performance.now() - warmStarted).toFixed(2));
  const warmEmitStarted = performance.now();
  const warmEmitMany = await request({ op: "emitMany", sessionId, sourceIds });
  const warmEmitManyMs = Number((performance.now() - warmEmitStarted).toFixed(2));
  const editedSource = sources[sources.length - 1];
  const editLoadStarted = performance.now();
  const editedLoad = await request({
    op: "loadSource",
    sessionId,
    sourceId: editedSource.sourceId,
    source: `${editedSource.source}\n`,
  });
  const editLoadMs = Number((performance.now() - editLoadStarted).toFixed(2));
  const editSummarizeStarted = performance.now();
  const editedArtifact = await request({ op: "artifactSummary", sessionId, sourceIds });
  const editSummarizeAfterLoadMs = Number((performance.now() - editSummarizeStarted).toFixed(2));
  const editLoadAndSummarizeMs = Number((editLoadMs + editSummarizeAfterLoadMs).toFixed(2));
  const editEmitLoadStarted = performance.now();
  const editedEmitLoad = await request({
    op: "loadSource",
    sessionId,
    sourceId: editedSource.sourceId,
    source: `${editedSource.source}\n\n`,
  });
  const editEmitLoadMs = Number((performance.now() - editEmitLoadStarted).toFixed(2));
  const editEmitManyStarted = performance.now();
  const editedEmitMany = await request({ op: "emitMany", sessionId, sourceIds });
  const editEmitManyAfterLoadMs = Number((performance.now() - editEmitManyStarted).toFixed(2));
  const editLoadAndEmitManyMs = Number((editEmitLoadMs + editEmitManyAfterLoadMs).toFixed(2));
  await request({ op: "closeSession", sessionId });
  daemon.stdin.end();

  const exitCode = await new Promise((resolveExit) => daemon.on("close", resolveExit));
  if (exitCode !== 0) {
    throw new Error(`Daemon exited with ${exitCode}: ${stderr}`);
  }

  return {
    loadAndSummarizeMs,
    openMs,
    preludeLoadMs,
    sourceLoadMs,
    firstSummarizeMs,
    warmSummarizeMs,
    warmEmitManyMs,
    editLoadAndSummarizeMs,
    editLoadMs,
    editSummarizeAfterLoadMs,
    editLoadAndEmitManyMs,
    editEmitLoadMs,
    editEmitManyAfterLoadMs,
    editedSourceId: editedSource.sourceId,
    preludeCount: preludes.length,
    sourceCount: sources.length,
    loadedCount: loadedPreludes.value.loadedCount + loadedSources.value.loadedCount,
    preludeLoadPhaseTimings: loadedPreludes.value.phaseTimings,
    sourceLoadPhaseTimings: loadedSources.value.phaseTimings,
    editLoadPhaseTimings: editedLoad.value.phaseTimings,
    editEmitLoadPhaseTimings: editedEmitLoad.value.phaseTimings,
    declarationCount: artifact.value.declarationCount,
    diagnosticCount: artifact.value.diagnosticCount,
    firstSummaryCacheHitCount: artifact.value.cacheHitCount,
    firstSummaryCacheMissCount: artifact.value.cacheMissCount,
    cacheHitCount: warmArtifact.value.cacheHitCount,
    cacheMissCount: warmArtifact.value.cacheMissCount,
    warmEmitCacheHitCount: warmEmitMany.value.cacheHitCount,
    warmEmitCacheMissCount: warmEmitMany.value.cacheMissCount,
    editCacheHitCount: editedArtifact.value.cacheHitCount,
    editCacheMissCount: editedArtifact.value.cacheMissCount,
    editSourceSummaryCacheHit: cacheHitForSource(editedArtifact, editedSource.sourceId),
    editEmitCacheHitCount: editedEmitMany.value.cacheHitCount,
    editEmitCacheMissCount: editedEmitMany.value.cacheMissCount,
    editSourceEmitCacheHit: cacheHitForSource(editedEmitMany, editedSource.sourceId),
  };
};

const latencySummary = (samples) => {
  const sorted = [...samples].sort((left, right) => left - right);
  const avg = samples.reduce((sum, sample) => sum + sample, 0) / samples.length;
  return {
    runs: samples.length,
    avgMs: Number(avg.toFixed(2)),
    minMs: Number(sorted[0].toFixed(2)),
    p50Ms: Number(sorted[Math.floor(sorted.length / 2)].toFixed(2)),
    maxMs: Number(sorted[sorted.length - 1].toFixed(2)),
  };
};

const requestLatencySummary = (command, argsPrefix, payload, runs = 9) => {
  const samples = [];
  for (let index = 0; index < runs; index += 1) {
    const { elapsedMs } = run(command, [...argsPrefix, payload]);
    samples.push(elapsedMs);
  }
  return latencySummary(samples);
};

const nativePath = new URL("dist/native/forma_cli.exe", cwd);
const jsPath = new URL("dist/js/jsoo_entry.cjs", cwd);
const wasmWrapperPath = new URL("dist/wasm/wasm_entry.cjs", cwd);
const wasmAssetsPath = new URL("dist/wasm/wasm_entry.bc.wasm.assets/", cwd);
const evalLatencyPayload = JSON.stringify({
  op: "evaluate",
  sourceId: "bench/eval-latency",
  source: "(let [base 10 add-base (fn [x] (+ base x))] (add-base 5))",
});

const { elapsedMs: nativeStartupMs } = run(nativePath.pathname, [
  "request",
  JSON.stringify({ op: "version" }),
]);

const js = existsSync(jsPath)
  ? (() => {
      const { elapsedMs } = run("node", [jsPath.pathname, JSON.stringify({ op: "version" })]);
      return {
        bytes: fileBytes(jsPath),
        brotliBytes: brotliBytes([jsPath]),
        gzipBytes: gzipBytes([jsPath]),
        startupMs: Number(elapsedMs.toFixed(2)),
      };
    })()
  : null;

const wasm = existsSync(wasmWrapperPath)
  ? (() => {
      const { elapsedMs } = run("node", [
        wasmWrapperPath.pathname,
        JSON.stringify({ op: "version" }),
      ]);
      const wasmFiles = listFiles(wasmAssetsPath).filter((path) => path.pathname.endsWith(".wasm"));
      const allFiles = [wasmWrapperPath, ...wasmFiles];
      return {
        wasmBytes: wasmFiles.reduce((sum, path) => sum + fileBytes(path), 0),
        wrapperBytes: fileBytes(wasmWrapperPath),
        brotliBytes: brotliBytes(allFiles),
        gzipBytes: gzipBytes(allFiles),
        startupMs: Number(elapsedMs.toFixed(2)),
      };
    })()
  : null;

const corpus = await corpusSummary(nativePath);
const evalLatency = {
  native: requestLatencySummary(nativePath.pathname, ["request"], evalLatencyPayload),
  js: existsSync(jsPath)
    ? requestLatencySummary("node", [jsPath.pathname], evalLatencyPayload)
    : null,
  wasm: existsSync(wasmWrapperPath)
    ? requestLatencySummary("node", [wasmWrapperPath.pathname], evalLatencyPayload)
    : null,
};

console.log(
  JSON.stringify(
    {
      native: {
        bytes: fileBytes(nativePath),
        startupMs: Number(nativeStartupMs.toFixed(2)),
      },
      js,
      wasm,
      corpus,
      evalLatency,
    },
    null,
    2,
  ),
);

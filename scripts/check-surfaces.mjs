import { existsSync, readFileSync, readdirSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Effect } from "effect";
import {
  diffValues,
  normalizeAst,
  normalizeEvaluate,
  normalizeTsDeclarations,
  normalizeTypecheck,
  normalizeValue,
} from "./surfaces/compare.mjs";
import { stableJson, validateGolden } from "./surfaces/goldens.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const suiteDir = resolve(repoRoot, "conformance/surfaces");
const tsEntry = resolve(repoRoot, "packages/ts/dist/index.mjs");
const hostEntry = resolve(repoRoot, "packages/host/dist/index.mjs");
const defaultReport = resolve(repoRoot, ".context/surfaces-report.json");
const sourceIdPrefix = "surfaces";
const passes = new Set(["parse", "expand", "typecheck", "evaluate", "effect-ir", "canonical-ir"]);

function optionsFromArgs(args) {
  const options = { report: defaultReport, onlyCase: undefined, list: false, update: process.env.FORMA_UPDATE_GOLDEN === "1" };
  for (let index = 0; index < args.length; index++) {
    if (args[index] === "--report" && args[index + 1]) options.report = resolve(args[++index]);
    else if (args[index] === "--case" && args[index + 1]) options.onlyCase = args[++index];
    else if (args[index] === "--update") options.update = true;
    else if (args[index] === "--list") options.list = true;
    else if (args[index] === "--help") {
      console.log("Usage: pnpm surfaces [--case ID] [--report PATH] [--list | --update]");
      process.exit(0);
    } else throw new Error(`Unknown surfaces option: ${args[index]}`);
  }
  if (options.update && options.onlyCase) throw new Error("Update the complete suite, not a single case");
  return options;
}

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const options = optionsFromArgs(process.argv.slice(2));
const casesManifest = readJson(resolve(suiteDir, "cases.json"));
const goldenPath = id => resolve(suiteDir, "goldens", `${id}.json`);
const candidateGoldens = new Map();
const zeroExpected = readJson(resolve(repoRoot, "conformance/forma-zero/expected.json"));

function validateFixtures() {
  if (casesManifest.version !== 1) throw new Error("Unsupported surfaces manifest version");
  const ids = new Set();
  for (const fixture of casesManifest.cases) {
    if (!fixture.id || ids.has(fixture.id)) throw new Error(`Duplicate or missing fixture id: ${fixture.id}`);
    ids.add(fixture.id);
    if ((typeof fixture.source === "string") === (typeof fixture.sourceFile === "string")) {
      throw new Error(`Fixture ${fixture.id} needs exactly one of source or sourceFile`);
    }
    if (!Array.isArray(fixture.passes) || fixture.passes.some((pass) => !passes.has(pass))) {
      throw new Error(`Fixture ${fixture.id} has an unsupported pass`);
    }
  }
  if (options.update) return;
  const storedIds = readdirSync(resolve(suiteDir, "goldens"), { recursive: true })
    .filter(name => name.endsWith(".json")).map(name => name.slice(0, -5)).sort();
  if (diffValues(storedIds, [...ids].sort()).length) throw new Error("Stored golden files and cases.json disagree");
  for (const fixture of casesManifest.cases) validateGolden(readJson(goldenPath(fixture.id)), fixture.id, fixture.passes);
}

const selected = id => options.onlyCase === undefined || options.onlyCase === id;

async function capture(fn) {
  try {
    return await fn();
  } catch (error) {
    return { runnerError: error instanceof Error ? error.message : String(error) };
  }
}

function check(report, id, pass, actual, expected) {
  const differences = diffValues(actual, expected, Infinity);
  report.comparisons.push({ id, pass, actual, expected, differences });
  report.summary.comparisons++;
  if (actual?.runnerError) report.summary.runnerFailures++;
  if (differences.length) {
    report.failures.push({ id: `${id}/${pass}`, differences });
    report.summary.failures++;
  }
}

// Cases in cases.json compare against their stored golden; --update rewrites it instead.
function checkGolden(report, id, pass, actual) {
  if (options.update) {
    const entry = candidateGoldens.get(id) ?? { version: 1, id, outputs: {} };
    entry.outputs[pass] = actual;
    candidateGoldens.set(id, entry);
    if (actual?.runnerError) report.summary.runnerFailures++;
    return;
  }
  check(report, id, pass, actual, readJson(goldenPath(id)).outputs[pass]);
}

async function checkSessionLoads(report, tsHost) {
  const fixtures = readJson(resolve(repoRoot, "conformance/session-load/loads.json"));
  for (const fixture of fixtures.cases) {
    const id = `session-load/${fixture.id}`;
    if (!selected(id)) continue;
    const { sessionId } = await tsHost.openSession();
    try {
      if (fixture.initial) {
        const initial = await tsHost.loadSource({ ...fixture.initial, sessionId });
        if (initial.diagnostics.length) throw new Error(`Initial load: ${JSON.stringify(initial)}`);
      }
      check(report, id, "loadSource", await capture(async () => {
        const result = await tsHost.loadSource({ ...fixture.load, sessionId });
        return { ok: !result.diagnostics.some(d => d.severity === "error"), located: result.diagnostics.every(d => d.span?.sourceId === fixture.load.sourceId) };
      }), fixture.expected);
      if (fixture.evaluate) {
        const value = await capture(async () => {
          const result = await tsHost.evaluateInSession({ sessionId, source: fixture.evaluate });
          return result.status === "completed" ? normalizeValue(result.result.value) : result;
        });
        check(report, `${id}/retained-value`, "evaluate", value, normalizeValue(fixture.expectedValue));
      }
    } finally {
      await tsHost.closeSession({ sessionId });
    }
  }
}

function projectEffectIr(sourceId, source, ts) {
  const forms = Effect.runSync(ts.Reader.parseManyToSExpr(source));
  const projected = ts.Mechanics.mechanicsPackageableDeclarations(forms, sourceId);
  if (!projected.ok) throw new Error(`Effect projection failed: ${JSON.stringify(projected.diagnostics)}`);
  return normalizeTsDeclarations(projected.declarations);
}

function projectCanonicalIr(sourceId, source, preludes, ts) {
  const read = name => readFileSync(resolve(repoRoot, `preludes/${name}.lisp`), "utf8");
  const names = (preludes ?? ["kernel", "compiler", "ontology"]).map(name => name.replace(/\.lisp$/, ""));
  const prelude = ts.Descriptor.bootstrapFromSources(
    names.includes("compiler") ? read("compiler") : "",
    names.includes("ontology") ? read("ontology") : "",
    ...names.filter(name => !["kernel", "compiler", "ontology"].includes(name)).map(read),
  );
  const result = ts.Descriptor.elaborateProgram(source, { sourceId, prelude });
  if (!result.ok) throw new Error(`Domain projection failed: ${JSON.stringify(result.diagnostics)}`);
  return normalizeTsDeclarations(result.declarations);
}

async function checkFormaZero(report, ts) {
  const suite = resolve(repoRoot, "conformance/forma-zero");
  const prelude = readFileSync(resolve(suite, "prelude.lisp"), "utf8");
  const names = Object.keys(zeroExpected).sort();
  const files = readdirSync(resolve(suite, "cases")).filter(name => name.endsWith(".lisp")).map(name => name.slice(0, -5)).sort();
  if (JSON.stringify(files) !== JSON.stringify(names)) {
    throw new Error(`Forma Zero cases and expected.json disagree: files=${files.join(",")} golden=${names.join(",")}`);
  }
  const layer = ts.Evaluator.makePreludeLayer(ts.Builtins.defaultBuiltins);
  const evaluationOptions = { stepLimit: 500_000, builtins: ts.Builtins.defaultBuiltins };
  for (const name of names) {
    const id = `forma-zero/${name}`;
    if (!selected(id)) continue;
    const source = readFileSync(resolve(suite, "cases", `${name}.lisp`), "utf8");
    check(report, id, "evaluate", await capture(async () => {
      const { value } = await Effect.runPromise(Effect.provide(ts.Evaluator.evaluate(`${prelude}\n${source}`, evaluationOptions), layer));
      if (ts.Evaluator.isKFloat(value)) return { kind: "float", value: Number.isFinite(value.value) ? value.value : String(value.value) };
      return { kind: typeof value === "string" ? "string" : typeof value === "boolean" ? "bool" : "int", value };
    }), zeroExpected[name]);
  }
}

async function main() {
  validateFixtures();
  if (options.list) {
    for (const fixture of casesManifest.cases) console.log(`${fixture.id}: ${fixture.passes.join(", ")}`);
    console.log("forma-zero/<case>: evaluate (all cases in conformance/forma-zero)");
    console.log("session-load/<case>: loadSource (all cases in conformance/session-load/loads.json)");
    return;
  }
  for (const [path, build] of [[tsEntry, "pnpm --filter @formalang/ts build"], [hostEntry, "pnpm --filter @formalang/host build"]]) {
    if (!existsSync(path)) {
      console.error(`Missing ${path}. Run ${build}.`);
      process.exitCode = 2;
      return;
    }
  }
  const [ts, host] = await Promise.all([import(pathToFileURL(tsEntry).href), import(pathToFileURL(hostEntry).href)]);
  const tsHost = new host.TsLanguageHost();
  const report = {
    formatVersion: 2,
    generatedAt: new Date().toISOString(),
    mode: options.update ? "update" : "check",
    status: "running",
    summary: { comparisons: 0, failures: 0, runnerFailures: 0 },
    comparisons: [],
    failures: [],
  };
  try {
    await checkSessionLoads(report, tsHost);
    for (const fixture of casesManifest.cases) {
      if (!selected(fixture.id)) continue;
      const source = fixture.source ?? readFileSync(resolve(suiteDir, fixture.sourceFile), "utf8");
      const sourceId = `${sourceIdPrefix}/${fixture.id}`;
      for (const pass of fixture.passes) {
        let actual;
        if (pass === "canonical-ir") actual = await capture(() => projectCanonicalIr(sourceId, source, fixture.preludes, ts));
        else if (pass === "effect-ir") actual = await capture(() => projectEffectIr(sourceId, source, ts));
        else {
          const project = pass === "parse" || pass === "expand" ? normalizeAst : pass === "typecheck" ? normalizeTypecheck : normalizeEvaluate;
          actual = await capture(async () => project(await tsHost[pass]({ sourceId, source })));
        }
        checkGolden(report, fixture.id, pass, actual);
        // Pinned expectations are reviewed by hand and never rewritten by --update.
        const expected = fixture.expected?.[pass];
        if (expected !== undefined) {
          const differences = diffValues(actual, expected);
          if (differences.length) {
            report.failures.push({ id: `${fixture.id}/${pass}`, pinned: true, differences });
            report.summary.failures++;
          }
        }
      }
    }
    if (options.onlyCase === undefined || options.onlyCase.startsWith("forma-zero/")) await checkFormaZero(report, ts);
    if (options.onlyCase !== undefined && !report.comparisons.some(item => item.id === options.onlyCase) && !candidateGoldens.has(options.onlyCase)) {
      throw new Error(`No surfaces fixture matched --case ${options.onlyCase}`);
    }
    report.status = report.summary.failures === 0 && report.summary.runnerFailures === 0 ? "pass" : "fail";
  } catch (error) {
    report.status = "error";
    report.reason = error instanceof Error ? error.message : String(error);
  }
  await mkdir(dirname(options.report), { recursive: true });
  await writeFile(options.report, `${JSON.stringify(report, null, 2)}\n`);

  // Only rewrite goldens when every pinned expectation and runner call succeeded.
  if (options.update && report.status === "pass") {
    for (const [id, golden] of candidateGoldens) {
      await mkdir(dirname(goldenPath(id)), { recursive: true });
      await writeFile(goldenPath(id), stableJson(golden));
    }
  }

  for (const comparison of report.comparisons) {
    if (comparison.actual?.runnerError) console.error(`${comparison.id}/${comparison.pass} runner error: ${comparison.actual.runnerError}`);
  }
  for (const failure of report.failures) {
    for (const difference of failure.differences.slice(0, 20)) {
      console.error(`${failure.id}${failure.pinned ? " (pinned)" : ""} ${difference.path}: actual=${JSON.stringify(difference.actual)} expected=${JSON.stringify(difference.expected)}`);
    }
  }
  const verb = options.update ? (report.status === "pass" ? `updated ${candidateGoldens.size} goldens` : "did not update goldens") : `${report.summary.comparisons} comparisons`;
  console.log(`Surfaces ${report.status}: ${verb}, ${report.summary.failures} failures, ${report.summary.runnerFailures} runner failures. Report: ${options.report}`);
  if (report.reason) console.error(report.reason);
  if (report.status !== "pass") process.exitCode = 1;
}

await main();

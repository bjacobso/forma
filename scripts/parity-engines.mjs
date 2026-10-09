import { existsSync, readFileSync, readdirSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Effect } from "effect";
import {
  diffValues,
  normalizeAst,
  normalizeEvaluate,
  normalizeOcamlDeclarations,
  normalizeTsDeclarations,
  normalizeTypecheck,
  normalizeValue,
} from "./parity/compare.mjs";
import { checkDivergence, stableJson, validateDivergences, validateGolden } from "./parity/goldens.mjs";
import { JsOcamlDaemon } from "./parity/js-ocaml-daemon.mjs";
import { OcamlDaemon } from "./parity/ocaml-daemon.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const suiteDir = resolve(repoRoot, "conformance/engine-parity");
const ocamlDir = resolve(repoRoot, "packages/ocaml");
const nativeCli = resolve(process.env.FORMA_OCAML_CLI ?? resolve(ocamlDir, "dist/native/forma_cli.exe"));
const jsEntry = resolve(ocamlDir, "dist/js/jsoo_entry.cjs");
const tsEntry = resolve(repoRoot, "packages/ts/dist/index.mjs");
const hostEntry = resolve(repoRoot, "packages/host/dist/index.mjs");
const defaultReport = resolve(repoRoot, ".context/parity-report.json");

function optionsFromArgs(args) {
  const options = { report: defaultReport, onlyCase: undefined, list: false, typescriptOnly: false, updateGoldens: process.env.FORMA_UPDATE_GOLDEN === "1" };
  for (let index = 0; index < args.length; index++) {
    if (args[index] === "--report" && args[index + 1]) options.report = resolve(args[++index]);
    else if (args[index] === "--case" && args[index + 1]) options.onlyCase = args[++index];
    else if (args[index] === "--typescript-only") options.typescriptOnly = true;
    else if (args[index] === "--update-goldens") options.updateGoldens = true;
    else if (args[index] === "--list") options.list = true;
    else if (args[index] === "--help") {
      console.log("Usage: pnpm parity:engines [--case ID] [--report PATH] [--list] [--typescript-only | --update-goldens]");
      process.exit(0);
    } else throw new Error(`Unknown parity option: ${args[index]}`);
  }
  if (options.typescriptOnly && options.updateGoldens) throw new Error("Goldens must be captured from native OCaml");
  if (options.updateGoldens && options.onlyCase) throw new Error("Capture the complete suite when updating goldens");
  return options;
}

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const options = optionsFromArgs(process.argv.slice(2));
const casesManifest = readJson(resolve(suiteDir, "cases.json"));
const matrix = readJson(resolve(suiteDir, "matrix.json"));
const divergences = readJson(resolve(suiteDir, "divergences.json"));
const goldenPath = id => resolve(suiteDir, "goldens", `${id}.json`);
const candidateGoldens = new Map();
const expectedKeys = casesManifest.cases.flatMap(fixture => fixture.passes.map(pass => `${fixture.id}/${pass}`));
const zeroExpected = readJson(resolve(repoRoot, "conformance/forma-zero/expected.json"));
expectedKeys.push(...Object.keys(zeroExpected).map(name => `forma-zero/${name}/evaluate`));

function validateFixtures() {
  if (casesManifest.version !== 1 || matrix.version !== 1) throw new Error("Unsupported engine parity manifest version");
  validateDivergences(divergences, expectedKeys, matrix);
  if (!options.updateGoldens) {
    const storedIds = readdirSync(resolve(suiteDir, "goldens"), { recursive: true })
      .filter(name => name.endsWith(".json")).map(name => name.slice(0, -5)).sort();
    if (diffValues(storedIds, casesManifest.cases.map(fixture => fixture.id).sort()).length) {
      throw new Error("Stored golden files and cases.json disagree");
    }
    for (const fixture of casesManifest.cases) {
      const golden = readJson(goldenPath(fixture.id));
      validateGolden(golden, fixture.id, fixture.passes);
    }
  }
  const ids = new Set();
  const passes = new Set(["parse", "expand", "typecheck", "evaluate", "effect-ir", "canonical-ir"]);
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
  const surfaces = new Set(matrix.surfaces.map((surface) => surface.id));
  if (surfaces.size !== matrix.surfaces.length) throw new Error("Duplicate parity matrix surface");
  for (const pass of passes) if (!surfaces.has(pass)) throw new Error(`Missing parity matrix surface ${pass}`);
}

function selected(id) {
  return options.onlyCase === undefined || options.onlyCase === id;
}

async function saveReport(report) {
  await mkdir(dirname(options.report), { recursive: true });
  await writeFile(options.report, `${JSON.stringify(report, null, 2)}\n`);
}

function checkOk(label, response) {
  if (response?.ok !== true) throw new Error(`${label}: ${JSON.stringify(response)}`);
  return response.value;
}

async function capture(fn) {
  try {
    return await fn();
  } catch (error) {
    return { runnerError: error instanceof Error ? error.message : String(error) };
  }
}

function addComparison(report, id, pass, typescript, ocaml, extra = {}) {
  const golden = id.startsWith("forma-zero/") ? zeroExpected[id.slice(11)]
    : options.updateGoldens ? ocaml : readJson(goldenPath(id)).outputs[pass];
  const differences = diffValues(typescript, golden, Infinity);
  const divergence = divergences.cases.find(item => item.id === id && item.pass === pass);
  const accepted = checkDivergence(differences, divergence);
  report.comparisons.push({ id, pass, typescript, ...(options.typescriptOnly ? {} : { ocaml }), golden, differences, knownDivergence: accepted && differences.length > 0, ...extra });
  report.summary.comparisons++;
  report.summary.differences += differences.length;
  if (accepted && differences.length) report.summary.knownDivergences++;
  if (!accepted) {
    report.goldenFailures.push({ id: `${id}/${pass}`, engine: "typescript", differences, reason: divergence ? "Known divergence changed or resolved; review its entry" : "New divergence" });
    report.summary.goldenFailures++;
  }
  if (typescript?.runnerError || ocaml?.runnerError) report.summary.runnerFailures++;
  if (!options.typescriptOnly && !options.updateGoldens) addGoldenCheck(report, id, pass, "ocaml", ocaml, golden);
  if (options.updateGoldens && !id.startsWith("forma-zero/")) {
    const entry = candidateGoldens.get(id) ?? { version: 1, capturedFrom: "ocaml-native", id, outputs: {} };
    entry.outputs[pass] = ocaml;
    candidateGoldens.set(id, entry);
  }
}

function addGoldenCheck(report, id, pass, engine, actual, expected) {
  if (engine === "ocaml-js") report.summary.targetComparisons++;
  const differences = diffValues(actual, expected, Infinity);
  if (differences.length) {
    report.goldenFailures.push({ id: `${id}/${pass}`, engine, differences });
    report.summary.goldenFailures++;
  }
  if (actual?.runnerError) report.summary.runnerFailures++;
}

const nativeOutput = fn => options.typescriptOnly ? Promise.resolve(undefined) : capture(fn);

function projectTsEffectIr(sourceId, source, ts) {
  const forms = Effect.runSync(ts.Reader.parseManyToSExpr(source));
  const projected = ts.Mechanics.mechanicsPackageableDeclarations(forms, sourceId);
  if (!projected.ok) throw new Error(`TS effect projection failed: ${JSON.stringify(projected.diagnostics)}`);
  return normalizeTsDeclarations(projected.declarations);
}

async function emitOcamlEffectIr(sourceId, source, daemon, preludes = []) {
  const opened = checkOk("openSession", await daemon.request({ op: "openSession" }));
  const sessionId = opened.sessionId;
  try {
    for (const filename of preludes) checkOk(`loadPrelude ${filename}`, await daemon.request({op: "loadPrelude", sessionId, sourceId: `preludes/${filename.replace(/\.lisp$/, "")}.lisp`, source: readFileSync(resolve(repoRoot, `preludes/${filename.replace(/\.lisp$/, "")}.lisp`), "utf8")}));
    checkOk("loadSource", await daemon.request({ op: "loadSource", sessionId, sourceId, source }));
    const emitted = checkOk("emit", await daemon.request({ op: "emit", sessionId, sourceId, backend: "canonical-ir" }));
    const content = emitted.artifacts?.[0]?.content;
    return normalizeOcamlDeclarations(content);
  } finally {
    checkOk("closeSession", await daemon.request({ op: "closeSession", sessionId }));
  }
}

function preludeForms(prelude, ts) {
  const forms = Effect.runSync(ts.Reader.parseManyToSExpr(prelude));
  return forms.map((form) => prelude.slice(form.loc.start, form.loc.end));
}

async function compareFormaZero(report, ts, daemon, jsDaemon) {
  const suite = resolve(repoRoot, "conformance/forma-zero");
  const prelude = readFileSync(resolve(suite, "prelude.lisp"), "utf8");
  const expected = readJson(resolve(suite, "expected.json"));
  const names = Object.keys(expected).sort();
  const files = readdirSync(resolve(suite, "cases"))
    .filter((name) => name.endsWith(".lisp"))
    .map((name) => name.slice(0, -5))
    .sort();
  if (JSON.stringify(files) !== JSON.stringify(names)) {
    throw new Error(`Forma Zero cases and expected.json disagree: files=${files.join(",")} golden=${names.join(",")}`);
  }
  const sessions = [];
  for (const target of [daemon, jsDaemon].filter(Boolean)) {
    const opened = checkOk("forma-zero openSession", await target.request({ op: "openSession" }));
    sessions.push({ target, sessionId: opened.sessionId });
  }
  try {
    for (const [index, form] of preludeForms(prelude, ts).entries()) {
      if (process.env.FORMA_PARITY_TRACE) console.error(`forma-zero/prelude-${index}`);
      for (const { target, sessionId } of sessions) checkOk(`forma-zero prelude ${index}`, await target.request({
        op: "loadPrelude", sessionId, sourceId: `parity/forma-zero-prelude-${index}`, source: form,
      }));
    }
    const layer = ts.Evaluator.makePreludeLayer(ts.Builtins.defaultBuiltins);
    const evaluationOptions = { stepLimit: 500_000, builtins: ts.Builtins.defaultBuiltins };
    for (const name of names) {
      const id = `forma-zero/${name}`;
      if (process.env.FORMA_PARITY_TRACE) console.error(id);
      if (!selected(id)) continue;
      const source = readFileSync(resolve(suite, "cases", `${name}.lisp`), "utf8");
      const typescript = await capture(async () => {
        const result = await Effect.runPromise(Effect.provide(
          ts.Evaluator.evaluate(`${prelude}\n${source}`, evaluationOptions), layer,
        ));
        const value = result.value;
        return { kind: typeof value === "string" ? "string" : typeof value === "boolean" ? "bool" : Number.isInteger(value) ? "int" : "float", value };
      });
      const values = [];
      for (const { target, sessionId } of sessions) values.push(await capture(async () => {
        const response = await target.request({ op: "evaluate", sessionId, sourceId: `parity/${id}`, source });
        return normalizeValue(checkOk(id, response));
      }));
      const ocaml = values[0];
      if (jsDaemon) addGoldenCheck(report, id, "evaluate", "ocaml-js", values[1], ocaml);
      addComparison(report, id, "evaluate", typescript, ocaml, { expected: expected[name] });
      if (options.updateGoldens) {
        addGoldenCheck(report, id, "evaluate", "ocaml", ocaml, expected[name]);
      }
    }
  } finally {
    for (const { target, sessionId } of sessions) checkOk("forma-zero closeSession", await target.request({ op: "closeSession", sessionId }));
  }
}

async function main() {
  validateFixtures();
  if (options.list) {
    for (const fixture of casesManifest.cases) console.log(`${fixture.id}: ${fixture.passes.join(", ")}`);
    console.log("forma-zero/<case>: evaluate (all cases in conformance/forma-zero)");
    console.log("Tracked gaps:", matrix.surfaces.filter((surface) => surface.status === "gap").map((surface) => surface.id).join(", "));
    return;
  }
  const report = {
    formatVersion: 1,
    generatedAt: new Date().toISOString(),
    mode: options.typescriptOnly ? "typescript-only" : options.updateGoldens ? "capture" : "live",
    matrix,
    status: "running",
    summary: { comparisons: 0, differences: 0, goldenFailures: 0, runnerFailures: 0, targetComparisons: 0, knownDivergences: 0 },
    comparisons: [],
    goldenFailures: [],
  };
  for (const [path, build] of [...(!options.typescriptOnly ? [[nativeCli, "pnpm build:ocaml"], [jsEntry, "opam exec -- pnpm build:ocaml (including js_of_ocaml)"]] : []), [tsEntry, "pnpm --filter @formalang/ts build"], [hostEntry, "pnpm --filter @formalang/host build"]]) {
    if (!existsSync(path)) {
      report.status = "blocked";
      report.reason = `Missing ${path}. Run ${build}.`;
      await saveReport(report);
      console.error(report.reason);
      console.log(`Blocked engine parity report: ${options.report}`);
      process.exitCode = 2;
      return;
    }
  }

  const [ts, host] = await Promise.all([
    import(pathToFileURL(tsEntry).href),
    import(pathToFileURL(hostEntry).href),
  ]);
  const tsHost = new host.TsLanguageHost();
  const ocamlHost = options.typescriptOnly ? undefined : new host.NodeOcamlLanguageHost({ cliPath: nativeCli });
  const daemon = options.typescriptOnly ? undefined : new OcamlDaemon(nativeCli, ocamlDir);
  const jsHost = options.typescriptOnly ? undefined : new host.JsOcamlLanguageHost({ jsPath: jsEntry });
  const jsDaemon = options.typescriptOnly ? undefined : new JsOcamlDaemon(jsEntry);
  try {
    const [tsVersion, ocamlVersion] = await Promise.all([tsHost.version(), ocamlHost?.version()]);
    report.engines = { typescript: tsVersion, ocaml: ocamlVersion };
    const loadSurface = matrix.surfaces.find((surface) => surface.id === "loadSource");
    for (const [engine, actual, expected] of [
      ["typescript", tsVersion.sourceLoadSemantics, loadSurface.typescript],
      ...(!options.typescriptOnly ? [["ocaml", ocamlVersion.sourceLoadSemantics, loadSurface.ocaml]] : []),
    ]) {
      const differences = diffValues(expected, actual);
      if (differences.length > 0) {
        report.goldenFailures.push({ id: "version/loadSource", engine, differences });
        report.summary.goldenFailures += differences.length;
      }
    }

    for (const fixture of casesManifest.cases) {
      if (!selected(fixture.id)) continue;
      const source = fixture.source ?? readFileSync(resolve(suiteDir, fixture.sourceFile), "utf8");
      const sourceId = `engine-parity/${fixture.id}`;
      for (const pass of fixture.passes) {
        if (process.env.FORMA_PARITY_TRACE) console.error(`${fixture.id}/${pass}`);
        if (pass === "canonical-ir") {
          const [typescript, ocaml] = await Promise.all([
            capture(() => {
              const read = n => readFileSync(resolve(repoRoot, `preludes/${n.replace(/\.lisp$/, "")}.lisp`), "utf8");
              const selectedPreludes = (fixture.preludes ?? ["kernel", "compiler", "ontology"]).map(name => name.replace(/\.lisp$/, ""));
              const prelude = ts.Descriptor.bootstrapFromSources(selectedPreludes.includes("compiler") ? read("compiler") : "", selectedPreludes.includes("ontology") ? read("ontology") : "", ...selectedPreludes.filter(name => !["kernel", "compiler", "ontology"].includes(name)).map(read));
              const result = ts.Descriptor.elaborateProgram(source, {sourceId, prelude});
              if (!result.ok) throw new Error(`TS domain projection failed: ${JSON.stringify(result.diagnostics)}`);
              return normalizeTsDeclarations(result.declarations);
            }),
            nativeOutput(() => emitOcamlEffectIr(sourceId, source, daemon, fixture.preludes ?? ["kernel", "compiler", "ontology"])),
          ]);
          if (jsDaemon) addGoldenCheck(report, fixture.id, pass, "ocaml-js", await capture(() => emitOcamlEffectIr(sourceId, source, jsDaemon, fixture.preludes ?? ["kernel", "compiler", "ontology"])), ocaml);
          addComparison(report, fixture.id, pass, typescript, ocaml);
          continue;
        }
        if (pass === "effect-ir") {
          const [typescript, ocaml] = await Promise.all([
            capture(() => projectTsEffectIr(sourceId, source, ts)),
            nativeOutput(() => emitOcamlEffectIr(sourceId, source, daemon)),
          ]);
          if (jsDaemon) addGoldenCheck(report, fixture.id, pass, "ocaml-js", await capture(() => emitOcamlEffectIr(sourceId, source, jsDaemon)), ocaml);
          addComparison(report, fixture.id, pass, typescript, ocaml);
          continue;
        }
        const request = { sourceId, source };
        const project = pass === "parse" || pass === "expand"
          ? normalizeAst
          : pass === "typecheck"
            ? (value) => normalizeTypecheck(value, fixture.typeAliases)
            : normalizeEvaluate;
        const [typescript, ocaml] = await Promise.all([
          capture(async () => project(await tsHost[pass](request))),
          nativeOutput(async () => project(await ocamlHost[pass](request))),
        ]);
        if (jsHost) addGoldenCheck(report, fixture.id, pass, "ocaml-js", await capture(async () => project(await jsHost[pass](request))), ocaml);
        addComparison(report, fixture.id, pass, typescript, ocaml,
          fixture.typeAliases ? { normalization: { typeAliases: fixture.typeAliases } } : {});
      }
    }
    if (options.onlyCase === undefined || options.onlyCase.startsWith("forma-zero/")) {
      await compareFormaZero(report, ts, daemon, jsDaemon);
    }
    if (options.onlyCase !== undefined && !report.comparisons.some((item) => item.id === options.onlyCase)) {
      throw new Error(`No parity fixture matched --case ${options.onlyCase}`);
    }
    report.status = report.summary.goldenFailures === 0 && report.summary.runnerFailures === 0 ? "pass" : "fail";
  } catch (error) {
    report.status = "error";
    report.reason = error instanceof Error ? error.message : String(error);
  } finally {
    try {
      await daemon?.close();
      await jsDaemon?.close();
    } catch (error) {
      report.status = "error";
      report.reason = error instanceof Error ? error.message : String(error);
    }
    await saveReport(report);
  }

  // Never overwrite references unless every native/JS target check succeeded.
  if (options.updateGoldens && report.status === "pass") {
    for (const [id, golden] of candidateGoldens) {
      await mkdir(dirname(goldenPath(id)), { recursive: true });
      await writeFile(goldenPath(id), stableJson(golden));
    }
  }

  for (const comparison of report.comparisons) {
    if (comparison.typescript?.runnerError) console.error(`${comparison.id}/${comparison.pass} TS runner error: ${comparison.typescript.runnerError}`);
    if (comparison.ocaml?.runnerError) console.error(`${comparison.id}/${comparison.pass} OCaml runner error: ${comparison.ocaml.runnerError}`);
    if (comparison.typescript?.runnerError || comparison.ocaml?.runnerError) continue;
    if (comparison.knownDivergence) continue;
    for (const difference of comparison.differences.slice(0, 20)) {
      console.error(`${comparison.id}/${comparison.pass} ${difference.path}: TS=${JSON.stringify(difference.typescript)} OCaml=${JSON.stringify(difference.ocaml)}`);
    }
  }
  for (const failure of report.goldenFailures) {
    console.error(`${failure.id} ${failure.engine} differs from its reviewed reference: ${JSON.stringify(failure.differences)}`);
  }
  console.log(`Engine parity ${report.status}: ${report.summary.comparisons} comparisons, ${report.summary.targetComparisons} native/JS checks, ${report.summary.knownDivergences} reviewed divergences, ${report.summary.differences} TS/reference diffs, ${report.summary.goldenFailures} golden diffs, ${report.summary.runnerFailures} runner failures. Report: ${options.report}`);
  if (report.reason) console.error(report.reason);
  if (report.status !== "pass") process.exitCode = 1;
}

await main();

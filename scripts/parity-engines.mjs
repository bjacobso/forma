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
import { OcamlDaemon } from "./parity/ocaml-daemon.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const suiteDir = resolve(repoRoot, "conformance/engine-parity");
const ocamlDir = resolve(repoRoot, "packages/ocaml");
const nativeCli = resolve(process.env.FORMA_OCAML_CLI ?? resolve(ocamlDir, "dist/native/forma_cli.exe"));
const tsEntry = resolve(repoRoot, "packages/ts/dist/index.mjs");
const hostEntry = resolve(repoRoot, "packages/host/dist/index.mjs");
const defaultReport = resolve(repoRoot, ".context/parity-report.json");

function optionsFromArgs(args) {
  const options = { report: defaultReport, onlyCase: undefined, list: false };
  for (let index = 0; index < args.length; index++) {
    if (args[index] === "--report" && args[index + 1]) options.report = resolve(args[++index]);
    else if (args[index] === "--case" && args[index + 1]) options.onlyCase = args[++index];
    else if (args[index] === "--list") options.list = true;
    else if (args[index] === "--help") {
      console.log("Usage: pnpm parity:engines [--case ID] [--report PATH] [--list]");
      process.exit(0);
    } else throw new Error(`Unknown parity option: ${args[index]}`);
  }
  return options;
}

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const options = optionsFromArgs(process.argv.slice(2));
const casesManifest = readJson(resolve(suiteDir, "cases.json"));
const matrix = readJson(resolve(suiteDir, "matrix.json"));

function validateFixtures() {
  if (casesManifest.version !== 1 || matrix.version !== 1) throw new Error("Unsupported engine parity manifest version");
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
  const differences = diffValues(typescript, ocaml);
  report.comparisons.push({ id, pass, typescript, ocaml, differences, ...extra });
  report.summary.comparisons++;
  report.summary.differences += differences.length;
  if (typescript?.runnerError || ocaml?.runnerError) report.summary.runnerFailures++;
}

async function compareSessionLoads(report, tsHost, daemon) {
  const fixtures = readJson(resolve(repoRoot, "conformance/session-load/loads.json"));
  for (const fixture of fixtures.cases) {
    const id = `session-load/${fixture.id}`;
    if (!selected(id)) continue;
    const tsSession = await tsHost.openSession();
    const ocamlSession = checkOk("openSession", await daemon.request({ op: "openSession" }));
    try {
      if (fixture.initial) {
        const initial = await tsHost.loadSource({ ...fixture.initial, sessionId: tsSession.sessionId });
        if (initial.diagnostics.length) throw new Error(`TS initial load: ${JSON.stringify(initial)}`);
        checkOk("initial load", await daemon.request({ op: "loadSource", ...fixture.initial, sessionId: ocamlSession.sessionId }));
      }
      const ts = await capture(async () => {
        const result = await tsHost.loadSource({ ...fixture.load, sessionId: tsSession.sessionId });
        return { ok: !result.diagnostics.some(d => d.severity === "error"), located: result.diagnostics.every(d => d.span?.sourceId === fixture.load.sourceId) };
      });
      const ocaml = await capture(async () => {
        const result = await daemon.request({ op: "loadSource", ...fixture.load, sessionId: ocamlSession.sessionId });
        return { ok: result.ok, located: (result.diagnostics ?? []).every(d => d.span?.sourceId === fixture.load.sourceId) };
      });
      addComparison(report, id, "loadSource", ts, ocaml);
      for (const [engine, actual] of [["typescript", ts], ["ocaml", ocaml]]) {
        const differences = diffValues(fixture.expected, actual);
        if (differences.length) {
          report.goldenFailures.push({ id, engine, differences });
          report.summary.goldenFailures += differences.length;
        }
      }
      if (fixture.evaluate) {
        const tsResult = await tsHost.evaluateInSession({ sessionId: tsSession.sessionId, source: fixture.evaluate });
        const ocamlResult = checkOk("retained prelude", await daemon.request({ op: "replSubmit", sessionId: ocamlSession.sessionId, source: fixture.evaluate }));
        const tsValue = tsResult.status === "completed" ? normalizeValue(tsResult.result.value) : tsResult;
        const ocamlValue = normalizeValue(ocamlResult.value);
        addComparison(report, `${id}/retained-value`, "evaluate", tsValue, ocamlValue);
        const expected = normalizeValue(fixture.expectedValue);
        for (const [engine, actual] of [["typescript", tsValue], ["ocaml", ocamlValue]]) {
          const differences = diffValues(expected, actual);
          if (differences.length) {
            report.goldenFailures.push({ id, engine, differences });
            report.summary.goldenFailures += differences.length;
          }
        }
      }
    } finally {
      await tsHost.closeSession({ sessionId: tsSession.sessionId });
      checkOk("closeSession", await daemon.request({ op: "closeSession", sessionId: ocamlSession.sessionId }));
    }
  }
}

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

async function compareFormaZero(report, ts, daemon) {
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
  const opened = checkOk("forma-zero openSession", await daemon.request({ op: "openSession" }));
  const sessionId = opened.sessionId;
  try {
    for (const [index, form] of preludeForms(prelude, ts).entries()) {
      if (process.env.FORMA_PARITY_TRACE) console.error(`forma-zero/prelude-${index}`);
      checkOk(`forma-zero prelude ${index}`, await daemon.request({
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
      const ocaml = await capture(async () => {
        const response = await daemon.request({ op: "evaluate", sessionId, sourceId: `parity/${id}`, source });
        return normalizeValue(checkOk(id, response));
      });
      addComparison(report, id, "evaluate", typescript, ocaml, { expected: expected[name] });
      for (const [engine, value] of [["typescript", typescript], ["ocaml", ocaml]]) {
        const differences = diffValues(expected[name], value);
        if (differences.length > 0) {
          report.goldenFailures.push({ id, engine, differences });
          report.summary.goldenFailures += differences.length;
        }
      }
    }
  } finally {
    checkOk("forma-zero closeSession", await daemon.request({ op: "closeSession", sessionId }));
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
    matrix,
    status: "running",
    summary: { comparisons: 0, differences: 0, goldenFailures: 0, runnerFailures: 0 },
    comparisons: [],
    goldenFailures: [],
  };
  for (const [path, build] of [[nativeCli, "pnpm build:ocaml"], [tsEntry, "pnpm --filter @formalang/ts build"], [hostEntry, "pnpm --filter @formalang/host build"]]) {
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
  const ocamlHost = new host.NodeOcamlLanguageHost({ cliPath: nativeCli });
  const daemon = new OcamlDaemon(nativeCli, ocamlDir);
  try {
    const [tsVersion, ocamlVersion] = await Promise.all([tsHost.version(), ocamlHost.version()]);
    report.engines = { typescript: tsVersion, ocaml: ocamlVersion };
    const loadSurface = matrix.surfaces.find((surface) => surface.id === "loadSource");
    for (const [engine, actual, expected] of [
      ["typescript", tsVersion.sourceLoadSemantics, loadSurface.typescript],
      ["ocaml", ocamlVersion.sourceLoadSemantics, loadSurface.ocaml],
    ]) {
      const differences = diffValues(expected, actual);
      if (differences.length > 0) {
        report.goldenFailures.push({ id: "version/loadSource", engine, differences });
        report.summary.goldenFailures += differences.length;
      }
    }

    await compareSessionLoads(report, tsHost, daemon);

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
            capture(() => emitOcamlEffectIr(sourceId, source, daemon, fixture.preludes ?? ["kernel", "compiler", "ontology"])),
          ]);
          addComparison(report, fixture.id, pass, typescript, ocaml);
          continue;
        }
        if (pass === "effect-ir") {
          const [typescript, ocaml] = await Promise.all([
            capture(() => projectTsEffectIr(sourceId, source, ts)),
            capture(() => emitOcamlEffectIr(sourceId, source, daemon)),
          ]);
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
          capture(async () => project(await ocamlHost[pass](request))),
        ]);
        addComparison(report, fixture.id, pass, typescript, ocaml,
          fixture.typeAliases ? { normalization: { typeAliases: fixture.typeAliases } } : {});
        const expected = fixture.expected?.[pass];
        if (expected !== undefined) {
          for (const [engine, actual] of [["typescript", typescript], ["ocaml", ocaml]]) {
            const differences = diffValues(expected, actual);
            if (differences.length > 0) {
              report.goldenFailures.push({ id: fixture.id, pass, engine, differences });
              report.summary.goldenFailures += differences.length;
            }
          }
        }
      }
    }
    if (options.onlyCase === undefined || options.onlyCase.startsWith("forma-zero/")) {
      await compareFormaZero(report, ts, daemon);
    }
    if (options.onlyCase !== undefined && !report.comparisons.some((item) => item.id === options.onlyCase)) {
      throw new Error(`No parity fixture matched --case ${options.onlyCase}`);
    }
    report.status = report.summary.differences === 0 && report.summary.goldenFailures === 0 && report.summary.runnerFailures === 0 ? "pass" : "fail";
  } catch (error) {
    report.status = "error";
    report.reason = error instanceof Error ? error.message : String(error);
  } finally {
    try {
      await daemon.close();
    } catch (error) {
      report.status = "error";
      report.reason = error instanceof Error ? error.message : String(error);
    }
    await saveReport(report);
  }

  for (const comparison of report.comparisons) {
    if (comparison.typescript?.runnerError) console.error(`${comparison.id}/${comparison.pass} TS runner error: ${comparison.typescript.runnerError}`);
    if (comparison.ocaml?.runnerError) console.error(`${comparison.id}/${comparison.pass} OCaml runner error: ${comparison.ocaml.runnerError}`);
    if (comparison.typescript?.runnerError || comparison.ocaml?.runnerError) continue;
    for (const difference of comparison.differences.slice(0, 20)) {
      console.error(`${comparison.id}/${comparison.pass} ${difference.path}: TS=${JSON.stringify(difference.typescript)} OCaml=${JSON.stringify(difference.ocaml)}`);
    }
  }
  for (const failure of report.goldenFailures) {
    console.error(`${failure.id} ${failure.engine} differs from its shared golden: ${JSON.stringify(failure.differences)}`);
  }
  console.log(`Engine parity ${report.status}: ${report.summary.comparisons} comparisons, ${report.summary.differences} engine diffs, ${report.summary.goldenFailures} golden diffs, ${report.summary.runnerFailures} runner failures. Report: ${options.report}`);
  if (report.reason) console.error(report.reason);
  if (report.status !== "pass") process.exitCode = 1;
}

await main();

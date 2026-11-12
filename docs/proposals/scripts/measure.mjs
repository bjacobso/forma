// Run from the repository root after building ts and host. No product files change.
import { readFileSync, readdirSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir, cpus } from "node:os";
import { execFileSync } from "node:child_process";
import { Effect } from "effect";
import * as Engine from "../../../packages/ts/dist/Engine.mjs";
import * as Type from "../../../packages/ts/dist/Type.mjs";
import * as Mechanics from "../../../packages/ts/dist/Mechanics.mjs";
import * as Reader from "../../../packages/ts/dist/Reader.mjs";
import * as Evaluator from "../../../packages/ts/dist/Evaluator.mjs";
import * as VM from "../../../packages/ts/dist/VM.mjs";
import { Env } from "../../../packages/ts/dist/Env.mjs";
import { defaultBuiltins as builtins } from "../../../packages/ts/dist/Builtins.mjs";
import { buildVMGlobals } from "../../../packages/ts/dist/evaluator/vm-bridge.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
process.chdir(root);
const read = p => readFileSync(p, "utf8");
const json = p => JSON.parse(read(p));
const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e =>
  e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`]).sort();
const error = e => ({ error: e?._tag ?? e?.name ?? "Error", message: e?.message ?? String(e) });
const capture = run => { try { return run(); } catch (e) { return error(e); } };
const errors = diagnostics => diagnostics.filter(d => d.severity === "error").map(d => ({ code: d.code, message: d.message }));
const forms = source => {
  const p = Reader.parse(source);
  if (p.errors.length) throw new Error(JSON.stringify(p.errors));
  return Evaluator.expandKernelExprsSync(Reader.toSExprMany(p.redTree), { builtins }).expanded;
};
const options = { builtins, stepLimit: 10_000 };
function compile(exprs) {
  const env = Env.empty();
  const c = VM.compileProgram(exprs, { builtins, env, normalized: true, includePrelude: false });
  return { chunk: c.chunk, options: {
    builtins: c.builtinRegistry.toArray(builtins), builtinLookup: c.builtinRegistry.toMap(builtins),
    globals: buildVMGlobals(c.globals, env), globalNames: Array.from({ length: c.globals.count }, (_, i) => c.globals.nameAt(i)),
    strictGlobals: true, stepLimit: options.stepLimit,
  } };
}
function printed(value) {
  if (Evaluator.isKFn(value)) return "<function>";
  return Evaluator.printKValue(value);
}
function run(exprs, vm, kernel = VM) {
  const result = vm ? (() => { const c = compile(exprs); return Effect.runSync(kernel.runChunkWithStats(c.chunk, c.options)); })()
    : Effect.runSync(Evaluator.evaluateCompileTimeExprs(exprs, options));
  return { printed: printed(result.value), steps: result.steps };
}
const sources = walk("conformance").filter(p => p.endsWith(".lisp")).map(id => ({ id, source: read(id) }));
const surface = json("conformance/surfaces/cases.json").cases;
for (const c of surface) if (c.source) sources.push({ id: `surface:${c.id}`, source: c.source });
const ledger = json("conformance/check-run/known-divergences.json");
for (const e of ledger) if (e.program) sources.push({ id: `ledger:${e.id}`, source: e.program });
// Include inline programs outside the surface/ledger manifests as well. Golden
// output and expectation JSON are data, not executable source inputs.
for (const path of walk("conformance").filter(p => p.endsWith(".json") && !p.includes("/goldens/") && !p.includes("expected") && !p.endsWith("known-divergences.json") && p !== "conformance/surfaces/cases.json")) {
  const visit = (value, pointer) => {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      const id = `${pointer}/${key}`;
      if ((key === "source" || key === "program") && typeof child === "string" && !/\.(lisp|forma)$/.test(child.trim())) sources.push({id, source:child});
      else visit(child, id);
    }
  };
  visit(json(path), path);
}
const parity = sources.map(({ id, source }) => {
  const exprs = capture(() => forms(source));
  if (exprs.error) return { id, frontend: exprs };
  const tree = capture(() => run(exprs, false));
  const vm = capture(() => run(exprs, true));
  return { id, tree, vm, same: tree.error || vm.error
    ? tree.error === vm.error && tree.message === vm.message
    : tree.printed === vm.printed };
});
const matrix = sources.filter(e => e.id.startsWith("conformance/fixtures/typecheck/") || e.id.startsWith("conformance/effect-typescript/cases/") && e.id.endsWith("/program.lisp"))
  .map(({id, source}) => {
    const hm = capture(() => {
      const r = Effect.runSync(Type.inferSource(source));
      return { display: Type.showType(r.type), errors: errors(r.diagnostics) };
    });
    const m = Mechanics.elaborateEffectProgram(source, { sourceId: id });
    return { id, hm, mechanics: { declarations: m.declarations.length, errors: errors(m.diagnostics) },
      hmAccepts: !hm.error && !hm.errors?.length,
      mechanicsAccepts: m.ok && m.declarations.length > 0 };
  });
const numeric = await Promise.all(ledger.map(async e => {
  const source = e.program ?? read(`conformance/check-run/${e.seed}`);
  const c = await Engine.typecheck({source}); const r = await Engine.evaluate({source, stepLimit: 10_000});
  return { id: e.id, source, display: c.display, printed: r.printed, check: errors(c.diagnostics), run: errors(r.diagnostics) };
}));
const interventions = {
  E2: "(: square (-> Int Int)) (define square [x] (* x x)) (map square [1 2 3])",
  G1: "(: inc (-> Int Int)) (define inc [x] (+ x 1)) (map inc [0])",
  G2: "(: positive (-> Int Bool)) (define positive [x] (> x 0)) (filter positive [0 1])",
  G3: "(: sum (-> Int Int Int)) (define sum [a b] (+ a b)) (reduce sum 0 [1])",
  G4: "(if false 0.0 1.0)", G5: "(if true 0.0 1.0)",
};
const numericInterventions = await Promise.all(Object.entries(interventions).map(async ([id,source]) => {
  const c = await Engine.typecheck({source}); const r = await Engine.evaluate({source,stepLimit:10_000});
  return {id,source,display:c.display,printed:r.printed,check:errors(c.diagnostics),run:errors(r.diagnostics)};
}));
// Paired VM experiment: patch only a temporary copy of the built module.
// A runtime-owned cell is shared with reentrant map/filter callbacks. A counter
// local to executeVM would reset on callbacks and invalidate the safety budget.
const temporary = mkdtempSync(resolve(tmpdir(), "forma-trust-"));
let timing;
try {
  const vmPath = resolve("packages/ts/dist/vm/vm.mjs");
  let code = read(vmPath).replace(/(from |import )"(\.[^"]+)"/g, (_, prefix, p) => `${prefix}"${pathToFileURL(resolve(dirname(vmPath), p)).href}"`)
    .replace('from "effect"', `from "${import.meta.resolve("effect")}"`);
  for (const [before, after] of [
    ["yield* Ref.make(0)", "{ value: 0 }"],
    ["yield* Ref.updateAndGet(stepCounter, (count) => count + 1)", "++stepCounter.value"],
    ["yield* Ref.update(stepCounter, (count) => count - 1)", "stepCounter.value--"],
  ]) {
    if (code.split(before).length !== 2) throw new Error(`Counter patch no longer unique: ${before}`);
    code = code.replace(before, after);
  }
  writeFileSync(`${temporary}/local.mjs`, code);
  const local = await import(pathToFileURL(`${temporary}/local.mjs`));
  const localParity = sources.map(({id, source}, i) => {
    const outcome = capture(() => run(forms(source), true, local));
    const baseline = parity[i].vm ?? parity[i].frontend;
    return {id, same: JSON.stringify(outcome) === JSON.stringify(baseline), outcome, baseline};
  });
  const workloads = [10,100,250,500].map(n => ({ name: `definitions-${n}`,
    source: Array.from({length:n}, (_,i) => `(define v${i} (+ ${i} 1))`).join("\n") + `\nv${n-1}` }));
  workloads.push({name:"callbacks-250", source:`(map (fn [x] (* x x)) [${Array.from({length:250}, (_,i)=>i).join(" ")}])`});
  const results = [];
  for (const w of workloads) {
    const exprs = forms(w.source);
    const compiled = compile(exprs);
    const runners = {
      tree: () => Effect.runSync(Evaluator.evaluateCompileTimeExprs(exprs, options)),
      vm: () => Effect.runSync(VM.runChunkWithStats(compiled.chunk, {...compiled.options, globals: [...compiled.options.globals]})),
      local: () => Effect.runSync(local.runChunkWithStats(compiled.chunk, {...compiled.options, globals: [...compiled.options.globals]})),
    };
    const expected = run(exprs, false).printed;
    const samples = Object.fromEntries(Object.keys(runners).map(k => [k, []]));
    for (let i=0;i<12;i++) for (const k of i%2 ? Object.keys(runners).reverse() : Object.keys(runners)) {
      const start = performance.now(); const r = runners[k](); const ms = performance.now()-start;
      if (printed(r.value) !== expected) throw new Error(`Wrong benchmark value: ${w.name}/${k}`);
      if (i>=3) samples[k].push(ms);
    }
    results.push({name:w.name, results:Object.fromEntries(Object.entries(samples).map(([k,t])=>[k,{medianMs:[...t].sort((a,b)=>a-b)[4], samplesMs:t}]))});
  }
  timing = { warmup:3, samples:9, results, localCounterDifferences:localParity.filter(e=>!e.same) };
} finally { rmSync(temporary, {recursive:true, force:true}); }
const prelude = await Promise.all(walk("preludes").filter(p=>p.endsWith(".lisp")).map(async id => {
  const r = await Engine.typecheck({ source:read(id), sourceId:id });
  return {id, errors:errors(r.diagnostics)};
}));
const report = {
  revision: execFileSync("git", ["rev-parse","HEAD"], {encoding:"utf8"}).trim(), node:process.version, cpu:cpus()[0]?.model,
  corpus: {total:sources.length, frontendFailures:parity.filter(p=>p.frontend).length,
    bothValues:parity.filter(p=>p.tree && !p.tree.error && !p.vm.error).length,
    exactAgreement:parity.filter(p=>p.same).length, differences:parity.filter(p=>p.same===false)},
  parity, matrix, numeric, numericInterventions, prelude, timing,
};
writeFileSync("docs/proposals/scripts/evidence.json", JSON.stringify(report,null,2)+"\n");
console.log(JSON.stringify({ ...report.corpus, differences:report.corpus.differences.length,
  matrix:matrix.length, matrixCounts:matrix.reduce((a,c)=>{const k=`${c.hmAccepts}/${c.mechanicsAccepts}`;a[k]=(a[k]??0)+1;return a;},{}),
  numeric, preludeFiles:prelude.length, preludeFailures:prelude.filter(p=>p.errors.length).length, timing },null,2));

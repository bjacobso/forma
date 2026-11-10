import { mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { TrialStore, compilerFingerprint, runTrial, sources, entry, policy, forms, kernel, type TrialOptions } from "./cache-trial.js";
import { ModuleError, resolveModuleGraph, sourceModuleResolver, type ModuleSource } from "../../packages/ts/src/modules/graph.js";
import { ModuleRuntime } from "../../packages/ts/src/modules/runtime.js";

const options: TrialOptions = { compiler: compilerFingerprint(), checker: "scheme-trial/v1", mode: "batch", preludeOrder: [kernel] };
const edit = (bundle: readonly ModuleSource[], id: string, before: string, after: string): ModuleSource[] =>
  bundle.map(s => {
    if (s.id !== id) return s;
    expect(s.source).toContain(before);
    return { ...s, source: s.source.replace(before, after) };
  });
const append = (bundle: readonly ModuleSource[], id: string, text: string) =>
  bundle.map(s => s.id === id ? { ...s, source: `${s.source}\n${text}` } : s);
const stats = (result: ReturnType<typeof runTrial>) => ({ hits: result.hits, misses: result.misses, bodies: result.inferredBodies });
const irField = (result: ReturnType<typeof runTrial>, name: string, field: string): unknown => {
  const modules = JSON.parse(result.projections) as [string, { name: string; ir: [string, unknown][] }[]][];
  return new Map(modules.find(([id]) => id === entry)![1].find(d => d.name === name)!.ir).get(field);
};

function database(run: (store: TrialStore) => void) {
  const directory = mkdtempSync(join(tmpdir(), "forma-cache-"));
  const store = new TrialStore(join(directory, "program.sqlite"));
  try { run(store); } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
}

test("SQLite schemes match independent graph inference across fresh Node processes", () => {
  const directory = mkdtempSync(join(tmpdir(), "forma-cache-"));
  try {
    // Node's transform-types handles syntax; this hook maps the compiler's ESM .js imports to source .ts.
    const script = `
      import { registerHooks } from "node:module";
      registerHooks({ resolve(specifier, context, next) {
        try { return next(specifier, context); } catch (error) {
          if (specifier.startsWith(".") && specifier.endsWith(".js")) return next(specifier.slice(0, -3) + ".ts", context);
          throw error;
        }
      }});
      const {TrialStore, runTrial, sources, compilerFingerprint, kernel} = await import("./trials/vendor-risk/cache-trial.ts");
      const store = new TrialStore(process.argv[1]);
      try { console.log(JSON.stringify(runTrial(store, sources(), {
        compiler: compilerFingerprint(), checker: "scheme-trial/v1", mode: "batch", preludeOrder: [kernel]
      }))); } finally { store.close(); }
    `;
    const launch = (): ReturnType<typeof runTrial> => JSON.parse(execFileSync(process.execPath,
      ["--experimental-transform-types", "--input-type=module", "-e", script, join(directory, "program.sqlite")],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
    const cold = launch();
    expect(cold.hits).toBe(0);
    expect(cold.inferredBodies).toBeGreaterThan(0);
    const warm = launch();
    expect(warm.misses).toBe(0);
    expect(warm.inferredBodies).toBe(0);
    expect(warm.schemes).toEqual(cold.schemes);
    console.log(JSON.stringify({ cold: stats(cold), newProcess: stats(warm) }));
  } finally { rmSync(directory, { recursive: true, force: true }); }
}, 20_000);

test("conservative source invalidation covers layout, unrelated code, schemas, helpers, data, macros and forms", () => database(store => {
  // Give the proposed vendor review data on opposite sides of the changed validity window.
  const base = edit(sources(), entry, ':reviewed-on -1 :questionnaire-complete false :soc2-issued-on -1',
    ':reviewed-on 700 :questionnaire-complete true :soc2-issued-on 800');
  const cold = runTrial(store, base, options);
  const cases: [string, string, ModuleSource[]][] = [
    ["layout", policy, append(base, policy, "; layout only")],
    ["unrelated definition", policy, append(base, policy, "(define trial-unused 791)")],
    ["dependency type", policy, edit(base, policy, ":name String", ":name String :trial-note (Option String)")],
    ["private helper, same signature", policy, edit(base, policy, "(< today (+ start days))", "(<= today (+ start days))")],
    ["consumed compile-time data", policy, edit(base, policy, "review-validity-days 365", "review-validity-days 250")],
    ["macro implementation", kernel, edit(base, kernel, "(macro (not x) `(if ~x false true))", "(macro (not x) `(if ~x (= 1 2) (= 1 1)))")],
    ["form projection", forms, edit(base, forms, ':as-of as-of', ':as-of (+ as-of 1)')],
    ["declaration data", entry, edit(base, entry, '(vendor cobalt-crm :status "proposed" :as-of 1000', '(vendor cobalt-crm :status "proposed" :as-of 1001')],
  ];
  for (const [label, changed, bundle] of cases) {
    // Existing definitions must identify the changed source; a new definition has no prior entry.
    store.db.exec("DELETE FROM checks");
    runTrial(store, base, options);
    const result = runTrial(store, bundle, options);
    expect(result.hits, label).toBe(0);
    expect(result.events.filter(e => cold.events.some(old => old.names[0] === e.names[0]))
      .every(e => e.reasons.includes(`source:${changed}`)), label).toBe(true);
    expect(result.inferredBodies, label).toBeGreaterThanOrEqual(cold.inferredBodies);
    if (label === "layout") expect(result.events.map(e => e.definitions)).toEqual(cold.events.map(e => e.definitions));
    if (label === "consumed compile-time data") {
      expect(irField(cold, "cobalt-crm", ":blockers")).toEqual(["high-risk vendor has no data processing agreement"]);
      expect(irField(result, "cobalt-crm", ":blockers")).toEqual([
        "security review expired or not yet valid", "high-risk vendor has no data processing agreement"]);
    }
    if (label === "form projection" || label === "declaration data")
      expect(irField(result, "cobalt-crm", ":as-of")).toBe(1001);
    const warm = runTrial(store, bundle, options);
    expect(warm.misses, label).toBe(0);
    expect(warm.inferredBodies, label).toBe(0);
    console.log(JSON.stringify({ case: label, ...stats(result), reasons: [...new Set(result.events.flatMap(e => e.reasons))] }));
  }
}));

test("checker/compiler namespaces, actual editor option and ordered prelude manifest invalidate", () => database(store => {
  const base = sources();
  runTrial(store, base, options);
  for (const [field, changed] of [
    ["checker", { ...options, checker: "scheme-trial/v2" }],
    ["compiler", { ...options, compiler: `${options.compiler}-upgrade` }],
    ["mode", { ...options, mode: "editor" as const }],
    ["preludes", { ...options, preludeOrder: ["host/default", kernel] }],
    ["preludes", { ...options, preludeOrder: [kernel, "host/default"] }],
  ] as const) {
    const result = runTrial(store, base, changed);
    expect(result.hits).toBe(0);
    expect(result.events.every(e => e.reasons.includes(field))).toBe(true);
    expect(runTrial(store, base, changed).misses).toBe(0);
  }
}));

test("recursive definitions share one cache entry and invalidate together", () => database(store => {
  const bundle = append(sources(), policy, `
(: trial-even (-> Int Bool))
(: trial-odd (-> Int Bool))
(define trial-even [n] (if (= n 0) true (trial-odd (- n 1))))
(define trial-odd [n] (if (= n 0) false (trial-even (- n 1))))`);
  const cold = runTrial(store, bundle, options);
  const group = cold.events.find(e => e.names.some(n => n.startsWith("trial-even__forma_")))!;
  expect(group.names).toHaveLength(2);
  expect(runTrial(store, bundle, options).inferredBodies).toBe(0);
  const changed = runTrial(store, edit(bundle, policy, "(if (= n 0) true (trial-odd", "(if (= n 0) false (trial-odd"), options);
  const newGroup = changed.events.find(e => e.names.some(n => n.startsWith("trial-even__forma_")))!;
  expect(newGroup.outcome).toBe("miss");
  expect(newGroup.component).not.toBe(group.component);
  expect(newGroup.definitions.filter((hash, i) => hash !== group.definitions[i])).toHaveLength(1);
}));

test("portable polymorphic schemes work at different types and mixed hit/miss inference", () => database(store => {
  const bundle = append(sources(), policy, `
(define trial-id [x] x)
(define trial-int (trial-id 73))
(define trial-string (trial-id "different"))
(define trial-field [record] record.value)`);
  const cold = runTrial(store, bundle, options);
  expect(runTrial(store, bundle, options).inferredBodies).toBe(0);
  const row = store.db.prepare("SELECT key FROM checks WHERE slot LIKE '%trial-string__forma_%'").get()!;
  store.db.prepare("DELETE FROM checks WHERE key = ?").run(row.key as string);
  const mixed = runTrial(store, bundle, options);
  expect(mixed.misses).toBe(1);
  expect(mixed.inferredBodies).toBe(1);
  expect(mixed.schemes).toEqual(cold.schemes);
}));

test("graph-wide context types and effect contracts invalidate even outside policy imports", () => database(store => {
  const extra = "trials/vendor-risk/src/trial-context.forma";
  const bundle = [...append(sources(), entry, '(import "./trial-context.forma" :as trial)'),
    { id: extra, source: '(export Context) (type Context {:count Int}) (error TrialError {:message String}) (: trial-op (-> Int (Effect Int [] []))) (define trial-op [n] n)' }];
  runTrial(store, bundle, options);
  for (const changed of [edit(bundle, extra, ":count Int", ":count String"),
    edit(bundle, extra, "(Effect Int [] [])", "(Effect Int [TrialError] [])")]) {
    const result = runTrial(store, changed, options);
    expect(result.hits).toBe(0);
    expect(result.events.every(e => e.reasons.includes(`source:${extra}`))).toBe(true);
    expect(runTrial(store, changed, options).inferredBodies).toBe(0);
  }
}));

test("new type errors and form-check failures are rejected; diagnostics relocate and failures are not stored", () => database(store => {
  const base = sources();
  runTrial(store, base, options);
  const count = () => store.db.prepare("SELECT COUNT(*) AS n FROM checks").get()!.n;
  const before = count();
  const invalid = edit(base, entry, ':reviewed-on 900', ':reviewed-on 600');
  const failure = (bundle: ModuleSource[], target: TrialStore) => {
    try { runTrial(target, bundle, options); throw new Error("Expected rejection"); }
    catch (error) {
      if (!(error instanceof ModuleError)) throw error;
      return error.diagnostics;
    }
  };
  const first = failure(invalid, store);
  expect(first.some(d => d.code === "vendor/active-without-review")).toBe(true);
  const shifted = invalid.map(s => s.id === entry ? { ...s, source: `; shift\n\n${s.source}` } : s);
  const after = failure(shifted, store);
  database(fresh => expect(failure(shifted, fresh)).toEqual(after));
  expect(after[0]!.span!.startOffset).toBe(first[0]!.span!.startOffset + 9);
  expect(count()).toBe(before);
  expect(() => runTrial(store, edit(base, policy, "review-validity-days 365", 'review-validity-days "wrong"'), options)).toThrow();
  expect(count()).toBe(before);
}));

test("a mismatching cached scheme is detected by the clean oracle", () => database(store => {
  runTrial(store, sources(), options);
  const row = store.db.prepare("SELECT key, schemes FROM checks WHERE slot LIKE '%review-validity-days__forma_%'").get()!;
  const schemes = JSON.parse(row.schemes as string);
  schemes[0][1].type = { _tag: "TCon", name: "String" };
  store.db.prepare("UPDATE checks SET schemes = ? WHERE key = ?").run(JSON.stringify(schemes), row.key as string);
  expect(() => runTrial(store, sources(), options)).toThrow();
}));

test("old pinned release reloads and executes after promotion, reopening, and cache eviction", async () => {
  const directory = mkdtempSync(join(tmpdir(), "forma-history-"));
  let store = new TrialStore(join(directory, "program.sqlite"));
  try {
    const old = sources();
    const oldResult = runTrial(store, old, options);
    const oldId = store.pin(old, options);
    store.moveRef("live", oldId);
    const updated = edit(old, policy, "review-validity-days 365", "review-validity-days 366");
    runTrial(store, updated, options);
    const newId = store.pin(updated, options, oldId);
    store.moveRef("live", newId);
    store.db.exec("DELETE FROM checks");
    store.close();
    store = new TrialStore(join(directory, "program.sqlite"));
    expect(store.db.prepare("SELECT release FROM refs WHERE name = 'live'").get()!.release).toBe(newId);
    expect(store.db.prepare("SELECT parent FROM releases WHERE id = ?").get(newId)!.parent).toBe(oldId);
    const pinned = store.load(oldId);
    const rebuilt = runTrial(store, pinned.bundle, pinned.options);
    expect(rebuilt.hits).toBe(0);
    expect(rebuilt.schemes).toEqual(oldResult.schemes);
    expect(rebuilt.projections).toEqual(oldResult.projections);
    const evaluate = async (bundle: ModuleSource[]) => {
      const probe = { id: "trials/vendor-risk/src/history-probe.forma", source: '(import "./policy.forma" [review-validity-days]) review-validity-days' };
      const graph = resolveModuleGraph(probe, sourceModuleResolver([...bundle, probe]));
      return (await new ModuleRuntime().evaluate(graph)).result.value;
    };
    expect(await evaluate(pinned.bundle)).toBe(365);
    expect(await evaluate(store.load(newId).bundle)).toBe(366);
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});

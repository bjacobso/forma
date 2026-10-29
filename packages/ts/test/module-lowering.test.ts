import { expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { generateEffectProgram } from "../src/mechanics/elaborate.js";
import {
  checkModuleGraph,
  linkEffectModules,
  resolveModuleGraph,
  sourceModuleResolver,
  ModuleRuntime,
  generatedBindingName,
  moduleOutputName,
  type ModuleSource,
} from "../src/Modules.js";

const library: ModuleSource = {
  id: "library.forma",
  source: `
    (export value expression)
    (type DeclarationId Symbol)
    (type ValueIR {:name Symbol :value Int})
    (form (value name value)
      :types {:name (Declares DeclarationId) :value Int}
      :ir ValueIR
      :lower (fn [ir] \`[(define ~(get ir :name) ~(get ir :value))])
      {:name name :value value})
    (type ExpressionIR {:name Symbol :body RuntimeExpr})
    (form (expression name body)
      :types {:name (Declares DeclarationId) :body RuntimeExpr}
      :ir ExpressionIR
      :lower (fn [ir] \`[(define ~(get ir :name) ~(lower-syntax (get ir :body)))])
      {:name name :body body})`,
};

function graph(source: string, dependencies: readonly ModuleSource[] = [library]) {
  const entry = { id: "main.forma", source };
  return resolveModuleGraph(entry, sourceModuleResolver([...dependencies, entry]));
}

test("a checked declaration has distinct compile-time data and runtime signatures", async () => {
  const g = graph('(import "./library.forma" [value]) (export answer) (value answer 42)');
  const checked = checkModuleGraph(g);
  expect(checked.diagnostics).toEqual([]);
  const answer = checked.interfaces.at(-1)!.exports[0]!;
  expect(answer.scheme?.type).toBe("Int");
  expect(answer.data?.contract).toBeDefined();
  expect(answer.data?.scheme?.type).toHaveProperty("fields");
  const linked = linkEffectModules(g);
  expect(linked.diagnostics).toEqual([]);
  expect(linked.modules.at(-1)!.code).toContain("= 42;");
  expect(linked.modules[0]!.code).not.toContain("DeclarationId");
  const result = await new ModuleRuntime().evaluate(g);
  expect(result.result.env.lookup(answer.symbol)).toBe(42);
});

const fixture = resolve(import.meta.dirname, "../../../conformance/runtime-modules");
const fixtureSources = readdirSync(fixture).filter(name => name.endsWith(".forma")).map(name => ({
  id: name, source: readFileSync(resolve(fixture, name), "utf8"),
}));

test("library-defined operations compile strictly and run deferred callbacks with real Effect services", () => {
  const g = graph(fixtureSources.find(s => s.id === "main.forma")!.source, fixtureSources);
  const checked = checkModuleGraph(g);
  expect(checked.diagnostics).toEqual([]);
  const linked = linkEffectModules(g);
  expect(linked.diagnostics).toEqual([]);
  const exported = (module: string, name: string) => generatedBindingName(checked.interfaces.find(m => m.moduleId === module)!.exports.find(b => b.name === name)!);
  const root = resolve(import.meta.dirname, "../../..");
  mkdirSync(resolve(root, ".context"), { recursive: true });
  const directory = mkdtempSync(resolve(root, ".context/runtime-module-test-"));
  try {
    writeFileSync(resolve(directory, "package.json"), '{"type":"module"}');
    for (const module of linked.modules) {
      expect(module.code).not.toMatch(/\bany\b/);
      writeFileSync(resolve(directory, module.fileName), module.code);
    }
    const layer = generateEffectProgram(readFileSync(resolve(fixture, "callback-layer.lisp"), "utf8"));
    expect(layer.diagnostics).toEqual([]);
    writeFileSync(resolve(directory, "callback-layer.ts"), layer.code!);
    writeFileSync(resolve(directory, "run.ts"), `
      import assert from "node:assert/strict";
      import { Effect, Layer } from "effect";
      import { ${exported("main.forma", "main")} as main, ${exported("main.forma", "feature-handler")} as handler } from "./${linked.entry.replace(/\.ts$/, ".js")}";
      import { ${exported("store.forma", "Store")} as Store, ${exported("store.forma", "Unavailable")} as Unavailable } from "./${moduleOutputName("store.forma").replace(/\.ts$/, ".js")}";
      import { ${exported("feature.forma", "make-handler")} as makeHandler, ${exported("feature.forma", "plan")} as plan } from "./${moduleOutputName("feature.forma").replace(/\.ts$/, ".js")}";
      import { Store as LayerStore, Reader, ReaderLive } from "./callback-layer.js";
      let calls = 0;
      const success = Layer.succeed(Store, { get: (id: string) => Effect.sync(() => { calls++; assert.ok(id === "counter-1" || id === "seed"); return 42; }) });
      assert.equal(calls, 0);
      const step = plan(2);
      assert.deepEqual(step({ count: 40 }), { count: 42 });
      assert.equal(await Effect.runPromise(Effect.provide(main, success)), 42);
      assert.equal(await Effect.runPromise(Effect.provide(handler(), success)), 42);
      assert.equal(calls, 2);
      const captured = await Effect.runPromise(Effect.provide(makeHandler, success));
      assert.equal(calls, 3);
      assert.equal(await Effect.runPromise(captured()), 42);
      assert.equal(await Effect.runPromise(captured()), 42);
      assert.equal(calls, 3);
      const failure = Layer.succeed(Store, { get: (id: string) => Effect.fail(new Unavailable({ id })) });
      const recovered = Effect.catch(Effect.provide(main, failure), error => Effect.succeed(error.id));
      assert.equal(await Effect.runPromise(recovered), "counter-1");
      assert.equal(await Effect.runPromise(Effect.catch(Effect.provide(makeHandler, failure), error => Effect.succeed(error.id))), "seed");
      const readerLayer = Layer.provide(ReaderLive, Layer.succeed(LayerStore, { get: (id: string) => Effect.sync(() => { assert.equal(id, "layer"); return 99; }) }));
      const readerWork = Effect.gen(function* () { const reader = yield* Reader; return yield* reader.read(); });
      assert.equal(await Effect.runPromise(Effect.provide(readerWork, readerLayer)), 99);
      console.log("ok");
    `);
    writeFileSync(resolve(directory, "tsconfig.json"), JSON.stringify({
      compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", types: ["node"], strict: true, exactOptionalPropertyTypes: true, noUncheckedIndexedAccess: true, skipLibCheck: true, outDir: "out" },
      include: ["*.ts"],
    }));
    try {
      execFileSync(process.execPath, [resolve(root, "node_modules/typescript/bin/tsc"), "-p", resolve(directory, "tsconfig.json")], { encoding: "utf8" });
    } catch (error) {
      throw new Error(String((error as { stdout: unknown }).stdout));
    }
    expect(execFileSync(process.execPath, [resolve(directory, "out/run.js")], { encoding: "utf8" }).trim()).toBe("ok");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 20000);

test("lowered exports link through barrels and namespaced consumers", () => {
  const child = { id: "child.forma", source: '(import "./library.forma" [value]) (export answer) (value answer 42)' };
  const barrel = { id: "barrel.forma", source: '(export-from "./child.forma" [answer])' };
  const g = graph('(import "./barrel.forma" :as child) (export result) (define result (+ child/answer 1))', [library, child, barrel]);
  expect(checkModuleGraph(g).diagnostics).toEqual([]);
  const linked = linkEffectModules(g);
  expect(linked.diagnostics).toEqual([]);
  expect(linked.modules.find(m => m.moduleId === "barrel.forma")!.code).toContain("export {");
});

test("runtime syntax holes preserve calls, vectors, and authored diagnostics", () => {
  const source = '(import "./library.forma" [expression]) (export result) (expression result (+ 40 2))';
  const g = graph(source);
  expect(checkModuleGraph(g).diagnostics).toEqual([]);
  expect(linkEffectModules(g).diagnostics).toEqual([]);
  const broken = graph(source.replace("(+ 40 2)", '(+ 40 "bad")'));
  const check = checkModuleGraph(broken);
  expect(check.ok).toBe(false);
  expect(check.diagnostics[0]!.span?.sourceId).toBe("main.forma");
  const badSource = source.replace("(+ 40 2)", '(+ 40 "bad")');
  expect(check.diagnostics[0]!.span?.startOffset).toBe(badSource.indexOf('(+ 40 "bad")'));
  const vector = graph(source.replace("(+ 40 2)", "[40 2]"));
  expect(linkEffectModules(vector).diagnostics).toEqual([]);
});

test("generated binders do not capture caller syntax or private helpers", async () => {
  const changed = {
    ...library,
    source: library.source.replace('(export value expression)', '(export value expression) (define finish [x] (+ x 1))')
      .replace('~(lower-syntax (get ir :body))', '(let [value 100] (finish ~(lower-syntax (get ir :body))))'),
  };
  const g = graph('(import "./library.forma" [expression]) (export result) (define value 41) (define finish [x] "caller") (expression result value)', [changed]);
  const check = checkModuleGraph(g);
  expect(check.diagnostics).toEqual([]);
  const linked = linkEffectModules(g);
  expect(linked.diagnostics).toEqual([]);
  const helper = g.modules[0]!.bindings.get("finish")!;
  expect(linked.modules[0]!.code).toContain(`export const ${generatedBindingName(helper)}`);
  const { result } = await new ModuleRuntime().evaluate(g);
  expect(result.env.lookup(g.modules.at(-1)!.bindings.get("result")!.symbol)).toBe(42);
});

test("selecting nested authored syntax retains its diagnostic span", () => {
  const changed = { ...library, source: library.source.replace('~(lower-syntax (get ir :body))', '~(lower-syntax (first (get ir :body)))') };
  const source = '(import "./library.forma" [expression]) (expression result [(+ 40 "bad")])';
  const checked = checkModuleGraph(graph(source, [changed]));
  expect(checked.ok).toBe(false);
  expect(checked.diagnostics[0]?.span).toMatchObject({ sourceId: "main.forma", startOffset: source.indexOf('(+ 40 "bad")') });
});

test("unsupported effects returning metadata are diagnosed rather than dropped", () => {
  const linked = linkEffectModules(graph('(export main) (define main (succeed (quote x)))'));
  expect(linked.ok).toBe(false);
  expect(linked.modules).toEqual([]);
});

test.each([
  ['(Effect Int [Unavailable] [Store.get])', '(Effect Int [] [Store.get])'],
  ['(Effect Int [Unavailable] [Store.get])', '(Effect Int [Unavailable])'],
])("lowered callback calls retain their Effect channels: %s → %s", (before, after) => {
  const entry = fixtureSources.find(s => s.id === "main.forma")!;
  const source = entry.source.replace(`(: main ${before})`, `(: main ${after})`);
  const linked = linkEffectModules(graph(source, fixtureSources));
  expect(linked.ok).toBe(false);
  expect(linked.modules).toEqual([]);
  expect(linked.diagnostics.some(d => d.span?.sourceId === "main.forma")).toBe(true);
});

test("kernel evaluation refuses a lowered Effect initializer", async () => {
  const g = graph(fixtureSources.find(s => s.id === "main.forma")!.source, fixtureSources);
  await expect(new ModuleRuntime().evaluate(g)).rejects.toHaveProperty("diagnostic.code", "module/effect-runtime");
});

test.each([
  ['42', "module/lower-result"],
  ['(fn [] 42)', "module/lower-result"],
  ['(log "during compilation")', "module/lower"],
  ['\`[]', "module/lower-declaration"],
  ['\`[(define foreign 1)]', "module/lower-declaration"],
  ['\`[(define ~(get ir :name) 1) (define ~(get ir :name) 2)]', "module/lower-declaration"],
  ['\`[(log "during import")]', "module/lower-declaration"],
])("invalid lowering %s fails at its application", (body, code) => {
  const source = '(import "./library.forma" [value]) (value answer 42)';
  const changed = { ...library, source: library.source.replace('`[(define ~(get ir :name) ~(get ir :value))]', body) };
  try {
    graph(source, [changed]);
    throw Error("Expected rejection");
  } catch (error) {
    expect(error).toHaveProperty("diagnostic.code", code);
    expect(error).toHaveProperty("diagnostic.span.sourceId", "main.forma");
    expect(error).toHaveProperty("diagnostic.span.startOffset", source.indexOf("(value answer"));
  }
});

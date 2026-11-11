import { readFileSync } from "node:fs";
import { describe, expect, test, vi } from "vitest";
import { checkModuleGraph, moduleResultDisplay, ModuleRuntime, resolveModuleGraph, sourceModuleResolver } from "../src/Modules.js";

const root = new URL("../../../conformance/modules/run-forms/", import.meta.url);
const files = ["rules.lisp", "data.lisp", "main.lisp"].map(name => ({
  id: `fixture/${name}`,
  source: readFileSync(new URL(name, root), "utf8"),
}));
const expected = JSON.parse(readFileSync(new URL("expected.json", root), "utf8"));
const graph = () => resolveModuleGraph(files[2]!, sourceModuleResolver(files));

describe("checker against module runtime", () => {
  test("fills inline Option records using imported parameter signatures", async () => {
    const library = { id: "details.lisp", source: `(export Details valid?)
(type Details {:vendor (Option String) :asset-tag (Option String)})
(: valid? (-> Details Bool))
(define valid? [details] (match details.vendor (Some vendor) (= vendor "Acme") None false))` };
    const g = resolveModuleGraph({ id: "main.lisp", source: '(import "./details.lisp" [Details valid?]) (valid? {:vendor "Acme"})' }, sourceModuleResolver([library]));
    expect(checkModuleGraph(g).diagnostics).toEqual([]);
    expect((await new ModuleRuntime().evaluate(g)).result.value).toBe(true);
  });

  test("accepted imported forms and dependent values run", async () => {
    const g = graph();
    const checked = checkModuleGraph(g);
    expect(checked.diagnostics).toEqual(expected.diagnostics);
    expect(moduleResultDisplay(checked, g.entry)).toBe(expected.display);
    expect((await new ModuleRuntime().evaluate(g)).result.value).toEqual(expected.value);
  });

  test("runtime reuses checked descriptors without rerunning form hooks", async () => {
    const g = graph();
    expect(checkModuleGraph(g).ok).toBe(true);
    const data = g.modules.find(m => m.id === "fixture/data.lisp")!;
    const declaration = data.bindings.get("welcome")!;
    const descriptor = data.compileTime!.read(declaration.symbol);
    for (const module of g.modules) {
      // Any repeated validation or projection would now fail.
      vi.spyOn(module.compileTime!, "run").mockImplementation(() => { throw new Error("hook ran during runtime evaluation"); });
    }
    const runtime = new ModuleRuntime();
    for (let i = 0; i < 2; i++) {
      expect((await runtime.evaluate(g)).result.value).toEqual(expected.value);
      expect(runtime.instances.get(data.id)!.result.env.lookup(declaration.symbol)).toBe(descriptor);
    }
  });

  test("a final named application evaluates to its declaration descriptor", async () => {
    const entry = { ...files[1]!, source: files[1]!.source + '\n(greeting final "Grace")' };
    const g = resolveModuleGraph(entry, sourceModuleResolver(files));
    expect(checkModuleGraph(g).ok).toBe(true);
    const module = g.modules.at(-1)!;
    const value = module.compileTime!.read(module.bindings.get("final")!.symbol);
    expect((await new ModuleRuntime().evaluate(g)).result.value).toBe(value);
  });

  test("an unnamed application evaluates to its projected IR", async () => {
    const entry = { id: "fixture/unnamed.lisp",
      source: readFileSync(new URL("unnamed.lisp", root), "utf8") };
    const g = resolveModuleGraph(entry, sourceModuleResolver([]));
    expect(checkModuleGraph(g).ok).toBe(true);
    expect((await new ModuleRuntime().evaluate(g)).result.value).toEqual(new Map([[":message", "projected"]]));
  });

  test("an application initializes every name it declares", async () => {
    const entry = { id: "fixture/multiple-names.lisp",
      source: readFileSync(new URL("multiple-names.lisp", root), "utf8") };
    const g = resolveModuleGraph(entry, sourceModuleResolver([]));
    expect(checkModuleGraph(g).diagnostics).toEqual([]);
    const module = g.modules.at(-1)!;
    const descriptors = ["first-entry", "second-entry"].map(name =>
      module.compileTime!.read(module.bindings.get(name)!.symbol));
    expect((await new ModuleRuntime().evaluate(g)).result.value).toEqual(descriptors);
  });
});

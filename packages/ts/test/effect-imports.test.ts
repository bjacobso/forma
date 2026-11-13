import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { generateEffectSystem } from "../src/EffectSystem.js";
import { checkModuleGraph, generatedBindingName, linkEffectModules, resolveModuleGraph, sourceModuleResolver } from "../src/Modules.js";

const fixture = (name: string) => readFileSync(resolve(import.meta.dirname, "../../../conformance/effect-typescript/modules/library-imports", name), "utf8");
const domain = { id: "domain.lisp", source: fixture("domain.lisp") };
const rpc = { id: "rpc.lisp", source: fixture("rpc.lisp") };

describe("import-selected Effect libraries", () => {
  test("checks and links a library using another module's schema", () => {
    const graph = resolveModuleGraph(rpc, sourceModuleResolver([domain]));
    expect(checkModuleGraph(graph).diagnostics).toEqual([]);
    const linked = linkEffectModules(graph);
    expect(linked.diagnostics).toEqual([]);
    expect(linked.modules.filter(m => !m.moduleId.startsWith("forma:"))).toHaveLength(2);
    const code = linked.modules.find(m => m.moduleId === rpc.id)!.code;
    expect(code).toContain('from "effect/rpc"');
    const binding = graph.modules.find(m => m.id === rpc.id)!.interface.exports.find(b => b.name === "Greetings")!;
    expect(code).toContain(`export const ${generatedBindingName(binding)} =`);
    expect(code).toMatch(/import \{ .*Greeting.* \} from "\.\/module_.*\.js";/);
    expect(code).not.toContain("Schema.Struct");
    const generated = generateEffectSystem(graph);
    expect(generated.diagnostics).toEqual([]);
    expect(generated.modules).toHaveLength(2);
    expect(generated.system!.edges.some(edge => edge.kind === "uses" && edge.to.startsWith("schema:Greeting"))).toBe(true);
  });

  test.each([
    ["http-api", '(api Health (group health (endpoint get :get "/health" :success String)))'],
    ["cluster", '(entity Counter :state {:n Int} :initial {:n 0} :storage :memory :accept-state-loss true (query Count :success Int :reply state.n))'],
  ])("checks the imported %s library", (library, source) => {
    const graph = resolveModuleGraph({ id: "main.lisp", source: `(import "forma:effect/${library}" [])\n${source}` }, sourceModuleResolver([]));
    expect(checkModuleGraph(graph).diagnostics).toEqual([]);
    expect(linkEffectModules(graph).diagnostics).toEqual([]);
  });

  test("a dependency's import does not select the library in its consumer", () => {
    expect(() => resolveModuleGraph({ id: "main.lisp", source: '(import "./rpc.lisp" []) (rpc-group Bad (rpc "Bad" :payload String :success String))' }, sourceModuleResolver([domain, rpc])))
      .toThrow('add (import "forma:effect/rpc" [rpc-group rpc])');
  });

  test("namespace library imports introduce and export declarations", () => {
    const graph = resolveModuleGraph({ id: "main.lisp", source: '(import "forma:effect/rpc" :as r) (export Greetings) (r/rpc-group Greetings (r/rpc "Greet" :payload String :success String))' }, sourceModuleResolver([]));
    const linked = linkEffectModules(graph);
    expect(linked.diagnostics).toEqual([]);
    expect(linked.modules[0]!.code).toContain(" as Greetings }");
  });

  test("preserves author error tags across module boundaries", () => {
    const error = { id: "error.lisp", source: fixture("error.lisp") };
    const graph = resolveModuleGraph({ id: "main.lisp", source: '(import "./error.lisp" [Missing]) (import "forma:effect/rpc" [rpc-group rpc]) (rpc-group Test (rpc "Get" :payload String :success String :error Missing))' }, sourceModuleResolver([error]));
    const linked = linkEffectModules(graph);
    expect(linked.diagnostics).toEqual([]);
    expect(linked.modules.find(m => m.moduleId === error.id)!.code).toContain('()("Missing", {');
  });

  test("links inferred domain helpers instead of silently dropping them", () => {
    const helper = { id: "helper.lisp", source: '(export twice) (define twice [x] (+ x x))' };
    const graph = resolveModuleGraph({ id: "main.lisp", source: '(import "./helper.lisp" [twice]) (import "forma:effect/rpc" [])' }, sourceModuleResolver([helper]));
    const linked = linkEffectModules(graph);
    expect(linked.diagnostics).toEqual([]);
    expect(linked.modules.find(m => m.moduleId === helper.id)!.code).toContain("export const twice");
  });

  test("the bank program also works with import-selected libraries", () => {
    const bank = readFileSync(resolve(import.meta.dirname, "../../../conformance/effect-typescript/cases/effect-system-bank/program.lisp"), "utf8");
    const source = '(import "forma:effect/rpc" [rpc-group rpc])\n(import "forma:effect/http-api" [api group endpoint handle handler])\n(import "forma:effect/cluster" [entity command query])\n' + bank;
    const graph = resolveModuleGraph({ id: "bank.lisp", source }, sourceModuleResolver([]));
    const linked = linkEffectModules(graph);
    expect(linked.diagnostics).toEqual([]);
    expect(linked.modules[0]!.code).toContain('Rpc.make("Deposit"');
    expect(linked.modules[0]!.code).not.toMatch(/Rpc.make\("Deposit__forma_/);
  });

  test("re-exports a schema through a module without duplicating its definition", () => {
    const facade = { id: "facade.lisp", source: '(export-from "./domain.lisp" [Greeting])' };
    const entry = { ...rpc, source: rpc.source.replace("./domain.lisp", "./facade.lisp") };
    const linked = linkEffectModules(resolveModuleGraph(entry, sourceModuleResolver([domain, facade])));
    expect(linked.diagnostics).toEqual([]);
    expect(linked.modules.find(m => m.moduleId === facade.id)!.code).toMatch(/export \{ Greeting.* \} from /);
  });

  test("HTTP handlers can import an API declaration from another module", () => {
    const api = { id: "api.lisp", source: '(import "forma:effect/http-api" [api group endpoint]) (export Health) (api Health (group system (endpoint get :get "/health" :success String)))' };
    const entry = { id: "handlers.lisp", source: '(import "./api.lisp" [Health]) (import "forma:effect/http-api" [handle handler]) (: health (-> {} (Effect String))) (define health [request] "ok") (handle Health system (handler get health))' };
    const linked = linkEffectModules(resolveModuleGraph(entry, sourceModuleResolver([api])));
    expect(linked.diagnostics).toEqual([]);
    expect(linked.modules.find(m => m.moduleId === entry.id)!.code).toMatch(/import \{ Health.* \} from /);
  });

  test("rejects author exports that normalize to the same TypeScript name", () => {
    const graph = resolveModuleGraph({ id: "collision.lisp", source: '(import "forma:effect/rpc" []) (export foo-bar FooBar) (type foo-bar String) (type FooBar Int)' }, sourceModuleResolver([]));
    const linked = linkEffectModules(graph);
    expect(linked.ok).toBe(false);
    expect(linked.diagnostics).toContainEqual(expect.objectContaining({ code: "mechanics/name-collision", message: expect.not.stringContaining("__forma_") }));
  });

  test("a user-defined namespace form does not require an Effect library", () => {
    const library = { id: "custom.lisp", source: '(export rpc-group) (type CustomIR {:name Symbol}) (form (rpc-group name) :types {:name Symbol} :ir CustomIR {:name name})' };
    expect(() => resolveModuleGraph({ id: "main.lisp", source: '(import "./custom.lisp" :as custom) (custom/rpc-group hello)' }, sourceModuleResolver([library]))).not.toThrow();
  });

  test("imports operation names containing a dollar sign", () => {
    const helper = { id: "helper.lisp", source: '(export $twice) (define $twice [x] (+ x x))' };
    const graph = resolveModuleGraph({ id: "main.lisp", source: '(import "./helper.lisp" [$twice]) (import "forma:effect/rpc" []) (: main (Effect Int)) (define main (succeed ($twice 2)))' }, sourceModuleResolver([helper]));
    const linked = linkEffectModules(graph);
    expect(linked.diagnostics).toEqual([]);
    expect(linked.modules.find(m => m.moduleId === graph.entry)!.code).toContain('import { $twice');
  });

  test("reports the missing import at the library form", () => {
    expect(() => resolveModuleGraph({ id: "missing.lisp", source: fixture("missing-import.lisp") }, sourceModuleResolver([])))
      .toThrow('add (import "forma:effect/rpc" [rpc-group rpc])');
  });

  test("lists available Effect libraries for an unknown specifier", () => {
    expect(() => resolveModuleGraph({ id: "unknown.lisp", source: fixture("unknown-library.lisp") }, sourceModuleResolver([])))
      .toThrow(/forma:effect\/rpc.*forma:effect\/http-api.*forma:effect\/cluster/);
  });
});

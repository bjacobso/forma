import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Effect } from "effect";
import { describe, expect, test } from "vitest";
import { bootstrapFromSources } from "../src/descriptor/bootstrap.js";
import { elaborateProgram } from "../src/descriptor/elaborate.js";
import { preludeSource } from "../src/Preludes.js";
import { parseManyToSExpr } from "../src/Reader.js";
import { defaultBuiltins } from "../src/Builtins.js";
import { evaluate, makePreludeLayer } from "../src/Evaluator.js";
import { checkModuleGraph, resolveModuleGraph, sourceModuleResolver } from "../src/Modules.js";

const fixture = resolve(import.meta.dirname, "../../../conformance/form-extensions");
const read = (name: string) => readFileSync(resolve(fixture, name), "utf8");
const expected = JSON.parse(read("expected.json"));
const compiler = preludeSource("compiler.lisp");
const prelude = () => bootstrapFromSources(compiler, read("prelude.lisp"));
const definition = (extension: string) => `(type DataIR {:value String})
(form (data value) :types {:value String} :ir DataIR :extensions ${extension} {:value value})`;

// A prelude macro is also available to explicit file-module libraries.
const macro = Effect.runSync(parseManyToSExpr(compiler)).find(e =>
  e._tag === "List" && e.items[0]?._tag === "Sym" && e.items[0].name === "macro" &&
  e.items[1]?._tag === "List" && e.items[1].items[0]?._tag === "Sym" && e.items[1].items[0].name === "named-map",
)!;
const macroSource = compiler.slice(macro.loc.start, macro.loc.end);
const run = async (source: string) => (await Effect.runPromise(evaluate(macroSource + "\n" + source, {
  builtins: defaultBuiltins, stepLimit: 100_000,
}).pipe(Effect.provide(makePreludeLayer(defaultBuiltins))))).value;

describe("form-local extensions", () => {
  test("two unrelated namespaces retain constant data and project the pinned IR", () => {
    const loaded = prelude();
    expect(loaded.descriptions.get("label")?.extensions?.["catalog/label"]).toEqual(expected.extensions.label);
    expect(loaded.descriptions.get("release")?.extensions?.["build/release"]).toEqual(expected.extensions.release);
    expect(loaded.descriptions.get("label")?.extensions?.["protocol/object"]).toMatchObject({ name: "LabelIR" });
    const result = elaborateProgram(read("program.lisp"), { prelude: loaded });
    expect(result.diagnostics).toEqual([]);
    expect(result.declarations.map(d => d.payload)).toEqual(expected.payloads);
  });

  test("invalid executable metadata points to the offending expression", () => {
    const source = read("invalid-extension.lisp");
    try {
      bootstrapFromSources("", source);
      throw Error("expected invalid metadata");
    } catch (error) {
      expect(error).toMatchObject({ message: "Descriptor configuration must contain constant values", loc: { start: source.indexOf('(str "not constant")') } });
    }
  });

  test("local form definition diagnostics keep the metadata source span", () => {
    const source = read("invalid-extension.lisp");
    const result = elaborateProgram(source, { prelude: bootstrapFromSources("", ""), sourceId: "invalid-extension.lisp" });
    expect(result.diagnostics[0]).toMatchObject({
      code: "elaborate/form-definition",
      span: { sourceId: "invalid-extension.lisp", startOffset: source.indexOf('(str "not constant")') },
    });
  });

  test.each(["[]", "nil", "(build-config)"])("requires a literal extension map: %s", extension => {
    expect(() => bootstrapFromSources("", definition(extension))).toThrow(/:extensions expects a literal map/);
  });

  test.each(["{:custom unbound}", "{:custom 'unbound}", "{unbound true}", "{:custom {:x 1 \"x\" 2}}"])("rejects invalid constant data: %s", extension => {
    expect(() => bootstrapFromSources("", definition(extension))).toThrow(/Descriptor configuration|Duplicate descriptor configuration/);
  });

  test("rejects duplicate options and gives explicit namespaces precedence", () => {
    expect(() => bootstrapFromSources("", definition('{} :extensions {}'))).toThrow(/duplicate option :extensions/);
    const loaded = bootstrapFromSources("", definition('{:protocol/object {:name "Explicit"}}'));
    expect(loaded.descriptions.get("data")?.extensions?.["protocol/object"]).toEqual({ name: "Explicit" });
    expect(elaborateProgram('(data "value")', { prelude: loaded }).diagnostics).toEqual([]);
    const invalid = bootstrapFromSources("", definition('{:protocol/object {:name "Explicit"}}').replace('{:value value}', '{:value 42}'));
    expect(elaborateProgram('(data "value")', { prelude: invalid }).ok).toBe(false);
  });

  test("keeps the deprecated attachment convention working", () => {
    const legacy = '(define data.metadata \'{:descriptor-name "data" :extensions {custom {legacy true label "first" :label "last"}}})\n';
    const loaded = bootstrapFromSources("", legacy + definition('{:other {:direct true}}'));
    expect(loaded.descriptions.get("data")?.extensions).toMatchObject({ custom: { legacy: true, label: "last" }, other: { direct: true } });
  });

  test("retains metadata and private map macros on imported forms", () => {
    const library = { id: "p/library.lisp", source: '(import "./kernel.lisp" [or])\n' + macroSource + "\n" + read("prelude.lisp") + "\n(export label release)" };
    const main = { id: "p/main.lisp", source: '(import "./library.lisp" [label release])\n' + read("program.lisp") };
    const graph = resolveModuleGraph(main, sourceModuleResolver([library, main, { id: "p/kernel.lisp", source: readFileSync(resolve(fixture, "../../preludes/modules/kernel.lisp"), "utf8") }]));
    expect(checkModuleGraph(graph).diagnostics).toEqual([]);
    const imported = [...graph.modules.at(-1)!.compileTime!.forms.values()].find(form => form.identity.declaration === "label")!.descriptor;
    expect(imported.extensions?.["catalog/label"]).toEqual(expected.extensions.label);
    const exported = graph.modules.find(m => m.id === library.id)!.interface.exports.find(e => e.name === "label")!;
    expect(JSON.stringify(exported.form?.options)).toContain(":extensions");
  });
});

describe("named-map prelude macro", () => {
  test("uses lexical bindings and retains names, false, nil, and insertion order", async () => {
    expect(await run('(let [count 1 visible false note nil] (let [count 2] (named-map count visible note)))')).toEqual(new Map<string, number | boolean | null>([["count", 2], ["visible", false], ["note", null]]));
    expect(await run('(named-map)')).toEqual(new Map());
  });

  test.each(["(named-map (+ 1 2))", "(named-map :keyword)", "(named-map nil)", '(named-map "text")'])("rejects non-binding input: %s", async source => {
    await expect(run(source)).rejects.toThrow(/named-map expects identifier symbols/);
  });

  test("rejects duplicate names", async () => {
    await expect(run('(let [x 1] (named-map x x))')).rejects.toThrow(/named-map expects distinct names/);
  });
});

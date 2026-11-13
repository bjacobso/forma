import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "vitest";
import { checkModuleGraph, resolveModuleGraph, sourceModuleResolver } from "../src/Modules.js";

const library = readFileSync(resolve(import.meta.dirname, "../../../conformance/libraries/connectors/connectors.lisp"), "utf8");
const importing = (source: string, forms: string) => resolveModuleGraph(
  { id: "main.lisp", source: source + '\n(import "./library.lisp" [connector machine])\n' },
  sourceModuleResolver([{ id: "library.lisp", source: forms }]),
);

// The unchanged library is a regression fixture for imported descriptor families.
test("a plain file already exports descriptor forms", () => {
  const graph = resolveModuleGraph(
    { id: "main.lisp", source: '(import "./library.lisp" [item]) (item hello)' },
    sourceModuleResolver([{ id: "library.lisp", source: '(export item) (type ItemIR {:name Symbol}) (form (item name) :types {:name (Declares ItemDef)} :ir ItemIR {:name name})' }]),
  );
  expect(checkModuleGraph(graph).diagnostics).toEqual([]);
  expect(graph.modules.at(-1)!.compileTime!.elaborated()).toMatchObject([{ form: "item", name: "hello" }]);
});

test("the unchanged family is legal in a file module", () => {
  expect(checkModuleGraph(importing("", library)).diagnostics).toEqual([]);
});

test("linked nested references retain semantic validation", () => {
  const source = '(connector remote "Service" :capabilities [] :signals [updated] :owns [protocol])\n(machine protocol "Protocol" :signal updated :initial pending :final [] (state pending "Pending"))';
  const graph = importing(source, library);
  expect(checkModuleGraph(graph).diagnostics).toEqual([]);
  const applications = graph.modules.at(-1)!.compileTime!.elaborated();
  expect(applications).toHaveLength(2);
  expect(applications[1]!.ir).toEqual(new Map([
    [":kind", "Machine"], [":name", expect.anything()], [":doc", "Protocol"],
    [":signal", expect.anything()], [":initial", expect.anything()], [":final", []],
    [":states", [new Map([[":kind", "State"], [":name", expect.anything()], [":label", "Pending"]])]],
    [":transitions", []],
  ]));
  expect(() => importing(source.replace(':owns [protocol]', ':owns [missing]'), library))
    .toThrowError(expect.objectContaining({ diagnostic: expect.objectContaining({ code: "elaborate/unknown-reference" }) }));
});

test("linked child holes project before parent checks", () => {
  const source = '(machine protocol "Protocol" :signal updated :initial pending :final [done] (state pending "Pending") (state done "Done") (transition pending done))';
  expect(checkModuleGraph(importing(source, library)).diagnostics).toEqual([]);
  try {
    importing(source.replace(':initial pending', ':initial missing').replace(':final [done]', ':final [absent]'), library);
    expect.fail("expected state errors");
  } catch (error) {
    expect(error).toMatchObject({ diagnostic: { code: "E_MACHINE_STATE", message: "missing is not a declared state." }, related: [{ code: "E_MACHINE_STATE", message: "absent is not a declared state." }] });
  }
});

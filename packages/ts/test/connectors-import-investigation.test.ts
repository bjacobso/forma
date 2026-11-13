import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "vitest";
import { checkModuleGraph, resolveModuleGraph, sourceModuleResolver } from "../src/Modules.js";

const library = readFileSync(resolve(import.meta.dirname, "../../../conformance/libraries/connectors/connectors.lisp"), "utf8");
const importing = (source: string, forms: string) => resolveModuleGraph(
  { id: "main.lisp", source: source + '\n(import "./library.lisp" [connector machine])\n' },
  sourceModuleResolver([{ id: "library.lisp", source: forms }]),
);

// These probes record why LX2 stopped before changing compiler behavior.
// They are current limitations, not the desired connectors contract.
test("a plain file already exports descriptor forms", () => {
  const graph = resolveModuleGraph(
    { id: "main.lisp", source: '(import "./library.lisp" [item]) (item hello)' },
    sourceModuleResolver([{ id: "library.lisp", source: '(export item) (type ItemIR {:name Symbol}) (form (item name) :types {:name (Declares ItemDef)} :ir ItemIR {:name name})' }]),
  );
  expect(checkModuleGraph(graph).diagnostics).toEqual([]);
  expect(graph.modules.at(-1)!.compileTime!.elaborated()).toMatchObject([{ form: "item", name: "hello" }]);
});

test("the unchanged WorldVM family cannot be declared in a file module", () => {
  expect(() => importing("", library)).toThrow("Module declaration machine-child/state must be an unqualified name.");
});

// Probe beyond the naming gate without changing the checked-in library.
const unqualified = library.replaceAll("machine-child/state", "state")
  .replaceAll("machine-child/transition", "transition").replaceAll("machine/check", "machine-check");

test("linked nested reference holes reach ordinary value-contract validation", () => {
  expect(() => importing('(connector remote "Service" :capabilities [] :signals [updated] :owns [protocol])\n(machine protocol "Protocol" :signal updated :initial pending :final [])', unqualified))
    .toThrow("owns[0] must be undefined");
});

test("linked child holes evaluate authored child calls before projection", () => {
  expect(() => importing('(machine protocol "Protocol" :signal updated :initial pending :final [] (state pending "Pending"))', unqualified))
    .toThrow("Unbound symbol: state");
});

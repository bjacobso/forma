import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { checkModuleGraph, resolveModuleGraph, sourceModuleResolver } from "../src/Modules.js";
import { effectLibraryAdapter } from "../src/effect-system/modules.js";
import {
  createSystemGraphBuilder,
  descriptorFormAdapter,
  linkModuleSystem,
  type LibraryAdapter,
} from "../src/modules/linker.js";

const connectorsDir = resolve(import.meta.dirname, "../../../conformance/libraries/connectors");
const readConnector = (name: string) => readFileSync(resolve(connectorsDir, name), "utf8");

describe("output-neutral linker & JSON-emitting form libraries (LX2)", () => {
  test("plain checkModuleGraph checks a JSON-emitting non-Effect library and matches stored emit + graph golden", () => {
    const library = { id: "connectors.lisp", source: readConnector("connectors.lisp") };
    const program = { id: "program.lisp", source: readConnector("program.lisp") };
    const expected = JSON.parse(readConnector("expected.json"));

    const graph = resolveModuleGraph(program, sourceModuleResolver([library]));
    const checked = checkModuleGraph(graph);

    expect(checked.ok).toBe(true);
    expect(checked.diagnostics).toEqual([]);
    expect(checked.linked).toBeDefined();
    expect(checked.linked!.ok).toBe(true);

    // Strip source spans before golden comparison, then verify spans separately.
    const actual = {
      format: checked.linked!.format,
      entry: checked.linked!.entry,
      modules: checked.linked!.modules,
      system: {
        nodes: checked.linked!.system.nodes.map(({ span: _span, ...rest }) => rest),
        edges: checked.linked!.system.edges,
      },
    };
    expect(actual).toEqual(expected);

    // Every emitted system node carries an author source span in program.lisp.
    for (const node of checked.linked!.system.nodes) {
      expect(node.span?.sourceId).toBe("program.lisp");
    }
  });

  test("reports located :check diagnostics and nested Refers errors for the connectors library", () => {
    const library = { id: "connectors.lisp", source: readConnector("connectors.lisp") };

    const badState = `(import "./connectors.lisp" [machine])
(machine Broken "Broken"
  :signal webhook
  :initial missing_start
  :final [missing_end]
  (state ok "OK"))`;
    expect(() => resolveModuleGraph({ id: "bad.lisp", source: badState }, sourceModuleResolver([library])))
      .toThrowError(expect.objectContaining({
        diagnostics: expect.arrayContaining([
          expect.objectContaining({ code: "E_MACHINE_STATE", message: expect.stringContaining("missing_start") }),
          expect.objectContaining({ code: "E_MACHINE_STATE", message: expect.stringContaining("missing_end") }),
        ]),
      }));

    const badRef = `(import "./connectors.lisp" [connector])
(connector Stripe "Payment processor"
  :capabilities [charge]
  :signals [webhook]
  :owns [MissingMachine])`;
    expect(() => resolveModuleGraph({ id: "bad-ref.lisp", source: badRef }, sourceModuleResolver([library])))
      .toThrowError(expect.objectContaining({
        diagnostic: expect.objectContaining({ code: "elaborate/unknown-reference" }),
      }));
  });

  test("reports located diagnostics when :emit or :graph hooks fail or return invalid shapes", () => {
    const badGraphLib = `(export item)
(type ItemIR {:name Symbol})
(define item/graph [ir] "not-a-record")
(form (item name) :types {:name (Declares ItemDef)} :ir ItemIR :graph item/graph {:name name})`;
    const program = '(import "./lib.lisp" [item])\n(item Alpha)';
    const graph = resolveModuleGraph({ id: "main.lisp", source: program }, sourceModuleResolver([{ id: "lib.lisp", source: badGraphLib }]));
    const checked = checkModuleGraph(graph);
    expect(checked.ok).toBe(false);
    expect(checked.diagnostics).toContainEqual(expect.objectContaining({
      code: "linker/graph",
      phase: "emit",
      span: expect.objectContaining({ sourceId: "main.lisp", startLine: 2 }),
    }));
  });

  test.each([
    [
      "rpc",
      `(import "forma:effect/rpc" [rpc-group rpc])
(export Greetings)
(type Greeting {:message String})
(rpc-group Greetings (rpc "Greet" :payload String :success Greeting))`,
      "export const Greetings =",
      "rpc-group",
    ],
    [
      "http-api",
      `(import "forma:effect/http-api" [api group endpoint])
(export Health)
(api Health (group health (endpoint get :get "/health" :success String)))`,
      "export const Health =",
      "http-api",
    ],
    [
      "cluster",
      `(import "forma:effect/cluster" [entity query])
(export Counter)
(entity Counter :state {:n Int} :initial {:n 0} :storage :memory :accept-state-loss true (query Count :success Int :reply state.n))`,
      "export const Counter =",
      "entity",
    ],
  ])("forma:effect/%s passes through the same generalized LibraryAdapter interface", (lib, source, expectedExport, expectedKind) => {
    const graph = resolveModuleGraph({ id: `${lib}.lisp`, source }, sourceModuleResolver([]));
    const checked = checkModuleGraph(graph);
    expect(checked.ok).toBe(true);
    expect(checked.diagnostics).toEqual([]);
    expect(checked.linked).toBeDefined();
    expect(checked.linked!.format).toBe("typescript");
    expect(checked.linked!.modules).toHaveLength(1);
    expect(String(checked.linked!.modules[0]!.output)).toContain(expectedExport);
    expect(checked.linked!.system.nodes.some(n => n.kind === expectedKind)).toBe(true);

    // Direct dispatch through linkModuleSystem selects the matching adapter by graph.
    const direct = linkModuleSystem(graph, [descriptorFormAdapter, effectLibraryAdapter], {
      environments: checked.environments,
    });
    expect(direct?.ok).toBe(true);
    expect(direct?.format).toBe("typescript");
  });

  test("supports custom output-neutral adapters through linkModuleSystem", () => {
    const customAdapter: LibraryAdapter<readonly string[]> = {
      id: "custom-lines",
      format: "text/plain",
      matches: () => true,
      link: (g) => {
        const { add, build } = createSystemGraphBuilder();
        add.node("module", g.entry);
        return {
          ok: true,
          entry: g.entry.replace(/\.lisp$/, ".txt"),
          format: "text/plain",
          modules: [{ moduleId: g.entry, fileName: "main.txt", format: "text/plain", output: ["ok"] }],
          system: build(),
          diagnostics: [],
        };
      },
    };
    const graph = resolveModuleGraph({ id: "main.lisp", source: "(define x 1)" }, sourceModuleResolver([]));
    const linked = linkModuleSystem(graph, [customAdapter]);
    expect(linked?.ok).toBe(true);
    expect(linked?.format).toBe("text/plain");
    expect(linked?.modules[0]!.output).toEqual(["ok"]);
    expect(linked?.system.nodes).toEqual([{ id: "module:main.lisp", kind: "module", name: "main.lisp" }]);
  });
});

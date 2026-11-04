import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, test } from "vitest";
import { readModuleGraph, readNodePackages } from "../src/Node.js";
import {
  checkModuleGraph,
  ModuleError,
  resolveModuleGraph,
  sourceModuleResolver,
  type ModuleSource,
  type PackageTable,
} from "../src/Modules.js";

const ir: ModuleSource[] = [
  { id: "pkg:@acme/ir/src/index.forma", source: `(export FlowIR StepIR)
(import "./step.forma" [StepIR])
(type FlowIR {:kind "Flow" :steps (List StepIR)})` },
  { id: "pkg:@acme/ir/src/step.forma", source: `(export StepIR) (type StepIR {:name String})` },
];
const flows: ModuleSource[] = [
  { id: "pkg:@acme/flows/src/index.forma", source: `(import "@acme/ir" [FlowIR])
(export flow)
(type FlowDecl Symbol)
(form (flow name step ...) :types {:name (Declares FlowDecl) :step (List String)} :ir FlowIR
  {:kind "Flow" :steps (map (fn [n] {:name n}) step)})` },
];
const table: PackageTable = {
  packages: [
    { name: "@acme/ir", version: "1.0.0", exports: { ".": "src/index.forma" } },
    { name: "@acme/flows", version: "2.1.0", exports: { ".": "./src/index.forma" }, dependencies: ["@acme/ir"] },
  ],
  dependencies: ["@acme/flows", "@acme/ir"],
};

const graph = (main: string, packages: PackageTable = table, extra: readonly ModuleSource[] = []) => {
  const sources = [...ir, ...flows, ...extra, { id: "app/main.forma", source: main }];
  return resolveModuleGraph(sources.at(-1)!, sourceModuleResolver(sources), { packages });
};
const failure = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    if (error instanceof ModuleError) return error.diagnostic;
    throw error;
  }
  throw new Error("expected a module error");
};

describe("packages", () => {
  test("bare specifiers resolve through exports to location-independent identities", () => {
    const g = graph(`(import "@acme/flows" [flow]) (export Onboard) (flow Onboard "collect-i9")`);
    expect(checkModuleGraph(g).diagnostics).toEqual([]);
    expect(g.modules.map((module) => module.id)).toEqual([
      "pkg:@acme/ir/src/step.forma",
      "pkg:@acme/ir/src/index.forma",
      "pkg:@acme/flows/src/index.forma",
      "app/main.forma",
    ]);
    const onboard = g.modules.at(-1)!.interface.exports[0]!;
    expect(onboard.data?.contract).toEqual({
      fields: [[":kind", "Flow"], [":steps", ["List", expect.stringContaining("StepIR__forma_")]]],
    });
    expect(onboard.data?.contractId).toMatch(/^[a-f0-9]{64}$/);
  });

  test("report undeclared dependencies, private subpaths, missing packages, and escapes at the specifier", () => {
    const main = (specifier: string) => `(import "${specifier}" [FlowIR])`;
    const narrow = { ...table, dependencies: ["@acme/flows"] };
    expect(failure(() => graph(main("@acme/ir"), narrow))).toMatchObject({
      code: "module/undeclared-dependency",
      span: { sourceId: "app/main.forma", startOffset: 8, endOffset: 18 },
    });
    expect(failure(() => graph(main("@acme/ir/src/step.forma")))).toMatchObject({
      code: "module/package-private",
      message: "@acme/ir does not export ./src/step.forma; its exports are ..",
    });
    expect(failure(() => graph(main("@acme/missing"), { ...table, dependencies: ["@acme/missing"] }))).toMatchObject({ code: "module/package-not-found" });
    const escaping: ModuleSource = { id: "pkg:@acme/ir/src/escape.forma", source: `(import "../../flows/src/index.forma" [flow])` };
    const withEscape = { ...table, packages: [{ ...table.packages[0]!, exports: { ".": "src/index.forma", "./escape": "src/escape.forma" } }, table.packages[1]!] };
    expect(failure(() => graph(`(import "@acme/ir/escape" [flow])`, withEscape, [escaping]))).toMatchObject({ code: "module/package-escape" });
    expect(failure(() => graph(main("/abs/ir.forma")))).toMatchObject({ code: "module/specifier" });
  });

  test("reject a table whose exports leave their package", () => {
    const leaky = { packages: [{ name: "@acme/ir", exports: { ".": "../other/ir.forma" } }] };
    expect(failure(() => graph(`(import "@acme/ir" [FlowIR])`, leaky))).toMatchObject({
      code: "module/package-table",
      message: "@acme/ir export . leaves the package root.",
    });
  });

  test("a package's dependencies are its own, not its consumer's", () => {
    const sneaky: ModuleSource = { id: "pkg:@acme/ir/src/sneaky.forma", source: `(import "@acme/flows" [flow])` };
    const exposed = { ...table, packages: [{ ...table.packages[0]!, exports: { ".": "src/index.forma", "./sneaky": "src/sneaky.forma" } }, table.packages[1]!] };
    expect(failure(() => graph(`(import "@acme/ir/sneaky" [flow])`, exposed, [sneaky]))).toMatchObject({
      code: "module/undeclared-dependency",
      message: "@acme/ir does not declare a dependency on @acme/flows.",
    });
  });

  test("package modules import their package's prelude", () => {
    const withPrelude: PackageTable = {
      packages: [{ name: "@acme/util", exports: { ".": "lib.forma" }, prelude: "prelude.forma" }],
    };
    const util: ModuleSource[] = [
      { id: "pkg:@acme/util/prelude.forma", source: "(export twice) (define twice [x] (* 2 x))" },
      { id: "pkg:@acme/util/lib.forma", source: "(export four) (define four (twice 2))" },
    ];
    const sources = [...util, { id: "app/main.forma", source: `(import "@acme/util" [four]) (export answer) (define answer four)` }];
    const g = resolveModuleGraph(sources.at(-1)!, sourceModuleResolver(sources), { packages: withPrelude });
    expect(checkModuleGraph(g).diagnostics).toEqual([]);
    expect(failure(() => resolveModuleGraph(sources.at(-1)!, sourceModuleResolver(sources)))).toMatchObject({
      code: "module/package-not-found",
    });
  });
});

describe("Node packages", () => {
  const write = (root: string, files: Record<string, unknown>) => {
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), typeof content === "string" ? content : JSON.stringify(content));
    }
  };
  const app = (extra: Record<string, unknown> = {}) => {
    const root = mkdtempSync(join(tmpdir(), "forma-packages-"));
    write(root, {
      "package.json": { name: "app", dependencies: { "@acme/flows": "^2.0.0", "left-pad": "^1.0.0" }, devDependencies: { "@acme/ir": "^1.0.0" } },
      "node_modules/left-pad/package.json": { name: "left-pad", version: "1.3.0" },
      "node_modules/@acme/ir/package.json": { name: "@acme/ir", version: "1.0.0", forma: { exports: { ".": "./ir.forma" } } },
      "node_modules/@acme/ir/ir.forma": `(export FlowIR) (type FlowIR {:kind "Flow" :steps (List String)})`,
      "node_modules/@acme/flows/package.json": { name: "@acme/flows", version: "2.1.0", dependencies: { "@acme/ir": "^1.0.0" }, forma: { exports: { ".": "./src/index.forma" } } },
      "node_modules/@acme/flows/src/index.forma": `(import "@acme/ir" [FlowIR])
(export flow)
(type FlowDecl Symbol)
(form (flow name step ...) :types {:name (Declares FlowDecl) :step (List String)} :ir FlowIR {:kind "Flow" :steps step})`,
      "src/main.forma": `(import "@acme/flows" [flow]) (export Onboard) (flow Onboard "collect-i9")`,
      ...extra,
    });
    return root;
  };

  test("build the table from package.json files and resolve installed packages by identity", () => {
    const root = app();
    const packages = readNodePackages(join(root, "src/main.forma"))!;
    expect(packages.table).toEqual({
      packages: [
        { name: "@acme/flows", version: "2.1.0", exports: { ".": "./src/index.forma" }, dependencies: ["@acme/ir"] },
        { name: "@acme/ir", version: "1.0.0", exports: { ".": "./ir.forma" }, dependencies: [] },
      ],
      dependencies: ["@acme/flows", "@acme/ir"],
    });
    const g = readModuleGraph(join(root, "src/main.forma"));
    expect(checkModuleGraph(g).diagnostics).toEqual([]);
    expect(g.modules.map((module) => module.id).slice(0, 2)).toEqual(["pkg:@acme/ir/ir.forma", "pkg:@acme/flows/src/index.forma"]);
    // The same packages installed elsewhere produce the same contract identity.
    const elsewhere = readModuleGraph(join(app(), "src/main.forma"));
    expect(elsewhere.modules.at(-1)!.interface.exports[0]!.data?.contractId).toBe(g.modules.at(-1)!.interface.exports[0]!.data?.contractId);
  });

  test("reject two versions of one package", () => {
    const root = app({
      "node_modules/@acme/flows/node_modules/@acme/ir/package.json": { name: "@acme/ir", version: "2.0.0", forma: { exports: { ".": "./ir.forma" } } },
      "node_modules/@acme/flows/node_modules/@acme/ir/ir.forma": "(export FlowIR) (type FlowIR String)",
    });
    expect(failure(() => readModuleGraph(join(root, "src/main.forma")))).toMatchObject({ code: "module/package-version-conflict" });
  });
});

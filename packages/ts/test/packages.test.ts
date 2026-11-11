import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, test } from "vitest";
import { sha256 } from "../src/source/sha256.js";
import { packageFiles, readFormaManifest } from "../src/node/package-files.js";
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
  { id: "pkg:@acme/ir/src/index.lisp", source: `(export FlowIR StepIR)
(import "./step.lisp" [StepIR])
(type FlowIR {:kind "Flow" :steps (List StepIR)})` },
  { id: "pkg:@acme/ir/src/step.lisp", source: `(export StepIR) (type StepIR {:name String})` },
];
const flows: ModuleSource[] = [
  { id: "pkg:@acme/flows/src/index.lisp", source: `(import "@acme/ir" [FlowIR])
(export flow)
(type FlowDecl Symbol)
(form (flow name step ...) :types {:name (Declares FlowDecl) :step (List String)} :ir FlowIR
  {:kind "Flow" :steps (map (fn [n] {:name n}) step)})` },
];
const table: PackageTable = {
  packages: [
    { name: "@acme/ir", version: "1.0.0", exports: { ".": "src/index.lisp" } },
    { name: "@acme/flows", version: "2.1.0", exports: { ".": "./src/index.lisp" }, dependencies: ["@acme/ir"] },
  ],
  dependencies: ["@acme/flows", "@acme/ir"],
};

const graph = (main: string, packages: PackageTable = table, extra: readonly ModuleSource[] = []) => {
  const sources = [...ir, ...flows, ...extra, { id: "app/main.lisp", source: main }];
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
      "pkg:@acme/ir/src/step.lisp",
      "pkg:@acme/ir/src/index.lisp",
      "pkg:@acme/flows/src/index.lisp",
      "app/main.lisp",
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
      span: { sourceId: "app/main.lisp", startOffset: 8, endOffset: 18 },
    });
    expect(failure(() => graph(main("@acme/ir/src/step.lisp")))).toMatchObject({
      code: "module/package-private",
      message: "@acme/ir does not export ./src/step.lisp; its exports are ..",
    });
    expect(failure(() => graph(main("@acme/missing"), { ...table, dependencies: ["@acme/missing"] }))).toMatchObject({ code: "module/package-not-found" });
    const escaping: ModuleSource = { id: "pkg:@acme/ir/src/escape.lisp", source: `(import "../../flows/src/index.lisp" [flow])` };
    const withEscape = { ...table, packages: [{ ...table.packages[0]!, exports: { ".": "src/index.lisp", "./escape": "src/escape.lisp" } }, table.packages[1]!] };
    expect(failure(() => graph(`(import "@acme/ir/escape" [flow])`, withEscape, [escaping]))).toMatchObject({ code: "module/package-escape" });
    expect(failure(() => graph(main("/abs/ir.lisp")))).toMatchObject({ code: "module/specifier" });
  });

  test("reject a table whose exports leave their package", () => {
    const leaky = { packages: [{ name: "@acme/ir", exports: { ".": "../other/ir.lisp" } }] };
    expect(failure(() => graph(`(import "@acme/ir" [FlowIR])`, leaky))).toMatchObject({
      code: "module/package-table",
      message: "@acme/ir export . leaves the package root.",
    });
  });

  test("a package's dependencies are its own, not its consumer's", () => {
    const sneaky: ModuleSource = { id: "pkg:@acme/ir/src/sneaky.lisp", source: `(import "@acme/flows" [flow])` };
    const exposed = { ...table, packages: [{ ...table.packages[0]!, exports: { ".": "src/index.lisp", "./sneaky": "src/sneaky.lisp" } }, table.packages[1]!] };
    expect(failure(() => graph(`(import "@acme/ir/sneaky" [flow])`, exposed, [sneaky]))).toMatchObject({
      code: "module/undeclared-dependency",
      message: "@acme/ir does not declare a dependency on @acme/flows.",
    });
  });

  test("package modules import their package's prelude", () => {
    const withPrelude: PackageTable = {
      packages: [{ name: "@acme/util", exports: { ".": "lib.lisp" }, prelude: "prelude.lisp" }],
    };
    const util: ModuleSource[] = [
      { id: "pkg:@acme/util/prelude.lisp", source: "(export twice) (define twice [x] (* 2 x))" },
      { id: "pkg:@acme/util/lib.lisp", source: "(export four) (define four (twice 2))" },
    ];
    const sources = [...util, { id: "app/main.lisp", source: `(import "@acme/util" [four]) (export answer) (define answer four)` }];
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
      "forma.json": { name: "app", exports: {}, dependencies: { "@acme/flows": "github.com/acme/flows@v2.1.0", "@acme/ir": "gitlab.com/acme/ir@v1.0.0" } },
      "vendor/@acme/ir/forma.json": { name: "@acme/ir", version: "1.0.0", exports: { ".": "./ir.lisp" } },
      "vendor/@acme/ir/ir.lisp": `(export FlowIR) (type FlowIR {:kind "Flow" :steps (List String)})`,
      "vendor/@acme/flows/forma.json": { name: "@acme/flows", version: "2.1.0", dependencies: { "@acme/ir": "gitlab.com/acme/ir@v1.0.0" }, exports: { ".": "./src/index.lisp" } },
      "vendor/@acme/flows/src/index.lisp": `(import "@acme/ir" [FlowIR])
(export flow)
(type FlowDecl Symbol)
(form (flow name step ...) :types {:name (Declares FlowDecl) :step (List String)} :ir FlowIR {:kind "Flow" :steps step})`,
      "src/main.lisp": `(import "@acme/flows" [flow]) (export Onboard) (flow Onboard "collect-i9")`,
      ...extra,
    });
    write(root, { "forma.lock": {
      version: 1, manifest: sha256(readFileSync(join(root, "forma.json"), "utf8")),
      packages: Object.fromEntries(["flows", "ir"].map(name => [`@acme/${name}`, {
        source: name === "flows" ? "github.com/acme/flows@v2.1.0" : "gitlab.com/acme/ir@v1.0.0",
        resolved: name === "flows" ? "v2.1.0" : "v1.0.0", commit: "a".repeat(40),
        files: packageFiles(join(root, "vendor/@acme", name)),
      }])),
    } });
    return root;
  };

  test.each(["exports", "prelude"])("retired %s paths provide a manifest edit", field => {
    const root = app();
    const manifest = { name: "app", dependencies: { util: "./index.forma" }, exports: field === "exports" ? { ".": "./index.forma" } : {},
      ...(field === "prelude" ? { prelude: "./index.forma" } : {}) };
    write(root, { "forma.json": manifest });
    const text = readFileSync(join(root, "forma.json"), "utf8");
    const diagnostic = failure(() => readFormaManifest(root));
    expect(diagnostic).toMatchObject({ code: "module/retired-extension", help: expect.stringContaining(".lisp") });
    expect(diagnostic.fix).toEqual([{
      span: { sourceId: join(root, "forma.json"), startOffset: text.lastIndexOf('"./index.forma"'), endOffset: text.lastIndexOf('"./index.forma"') + '"./index.forma"'.length },
      newText: '"./index.lisp"',
    }]);
  });

  test("package sources use only the Lisp extension", () => {
    const root = app();
    write(root, { "other.txt": "(define value 1)", "source.lisp": "(define value 1)" });
    expect(Object.keys(packageFiles(root))).toContain("source.lisp");
    expect(Object.keys(packageFiles(root))).not.toContain("other.txt");
    write(root, { "forma.json": { name: "app", exports: { ".": "other.txt" } } });
    expect(failure(() => readFormaManifest(root)).code).toBe("module/package-manifest");
  });

  test("build the table from verified vendored manifests and resolve packages by identity", () => {
    const root = app();
    const packages = readNodePackages(join(root, "src/main.lisp"))!;
    expect(packages.table).toEqual({
      packages: [
        { name: "@acme/flows", version: "2.1.0", exports: { ".": "./src/index.lisp" }, dependencies: ["@acme/ir"] },
        { name: "@acme/ir", version: "1.0.0", exports: { ".": "./ir.lisp" }, dependencies: [] },
      ],
      dependencies: ["@acme/flows", "@acme/ir"],
    });
    const g = readModuleGraph(join(root, "src/main.lisp"));
    expect(checkModuleGraph(g).diagnostics).toEqual([]);
    expect(g.modules.map((module) => module.id).slice(0, 2)).toEqual(["pkg:@acme/ir/ir.lisp", "pkg:@acme/flows/src/index.lisp"]);
    // The same packages installed elsewhere produce the same contract identity.
    const elsewhere = readModuleGraph(join(app(), "src/main.lisp"));
    expect(elsewhere.modules.at(-1)!.interface.exports[0]!.data?.contractId).toBe(g.modules.at(-1)!.interface.exports[0]!.data?.contractId);
  });

  test.each(["edited", "missing", "extra", "stale", "missing-lock", "symlink"])("reject %s dependency state before compiling", kind => {
    const root = app();
    const file = join(root, "vendor/@acme/ir/ir.lisp");
    if (kind === "edited") writeFileSync(file, "(export Changed)");
    if (kind === "missing") rmSync(file);
    if (kind === "extra") writeFileSync(join(root, "vendor/extra.txt"), "extra");
    if (kind === "stale") write(root, { "forma.json": { name: "app", exports: {} } });
    if (kind === "missing-lock") rmSync(join(root, "forma.lock"));
    if (kind === "symlink") { rmSync(file); symlinkSync(join(root, "src/main.lisp"), file); }
    expect(failure(() => readModuleGraph(join(root, "src/main.lisp"))).code).toBe(
      ["stale", "missing-lock"].includes(kind) ? "module/package-stale" : "module/package-integrity",
    );
  });

  test("reject identity mismatches even with matching file hashes", () => {
    const root = app({ "vendor/@acme/ir/forma.json": { name: "wrong", exports: {} } });
    expect(failure(() => readNodePackages(join(root, "src/main.lisp")))).toMatchObject({ code: "module/package-name" });
  });

  test("relative dependencies stay local and package.json discovery is gone", () => {
    const root = mkdtempSync(join(tmpdir(), "forma-local-"));
    write(root, {
      "forma.json": { name: "app", exports: {}, dependencies: { util: "./util" } },
      "util/forma.json": { name: "util", exports: { ".": "index.lisp" } },
      "util/index.lisp": "(export answer) (define answer 42)",
      "main.lisp": '(import "util" [answer])',
    });
    write(root, { "forma.lock": { version: 1, manifest: sha256(readFileSync(join(root, "forma.json"), "utf8")),
      packages: { util: { source: "./util", resolved: "local", commit: null, files: packageFiles(join(root, "util")) } } } });
    expect(readNodePackages(join(root, "main.lisp"))!.directories.get("util")).toBe(join(root, "util"));
    expect(checkModuleGraph(readModuleGraph(join(root, "main.lisp"))).diagnostics).toEqual([]);
    rmSync(join(root, "forma.json"));
    write(root, { "package.json": { forma: { exports: {} } } });
    expect(readNodePackages(join(root, "main.lisp"))).toBeUndefined();
  });
});

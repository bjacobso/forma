import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { createHash } from "node:crypto";
import { JsonAbi } from "../src/json-abi.js";

const cli = resolve(import.meta.dirname, "../dist/cli.mjs");
const irSource = `(export FlowIR) (type FlowIR {:kind "Flow" :steps (List String)})`;
const flowsSource = `(import "@acme/ir" [FlowIR])
(export flow)
(type FlowDecl Symbol)
(form (flow name step ...) :types {:name (Declares FlowDecl) :step (List String)} :ir FlowIR {:kind "Flow" :steps step})`;
const mainSource = `(import "@acme/flows" [flow]) (export Onboard) (flow Onboard "collect-i9")`;

describe("packages through the host", () => {
  test("a session resolves bare imports through its package table", async () => {
    const abi = new JsonAbi();
    const send = async (request: object) => JSON.parse(JSON.stringify(await abi.handleJson(JSON.stringify(request))));
    const { value: { sessionId } } = await send({ op: "openSession" });
    expect(await send({
      op: "configureSession", sessionId,
      packages: {
        packages: [
          { name: "@acme/ir", version: "1.0.0", exports: { ".": "ir.forma" } },
          { name: "@acme/flows", version: "2.1.0", exports: { ".": "index.forma" }, dependencies: ["@acme/ir"] },
        ],
        dependencies: ["@acme/flows"],
      },
    })).toMatchObject({ ok: true });
    await send({ op: "loadSourceBundle", sessionId, sources: [
      { kind: "source", sourceId: "pkg:@acme/ir/ir.forma", source: irSource },
      { kind: "source", sourceId: "pkg:@acme/flows/index.forma", source: flowsSource },
      { kind: "source", sourceId: "main.forma", source: mainSource },
    ] });
    const graph = await send({ op: "moduleGraph", sessionId, sourceId: "main.forma" });
    expect(graph).toMatchObject({ ok: true, diagnostics: [] });
    expect(graph.value.interfaces.map((i: { moduleId: string }) => i.moduleId)).toEqual(["pkg:@acme/ir/ir.forma", "pkg:@acme/flows/index.forma", "main.forma"]);
    expect(await send({ op: "moduleGraph", sessionId, sourceId: "main.forma", source: `(import "@acme/ir" [FlowIR])` })).toMatchObject({
      ok: false, diagnostics: [{ code: "module/undeclared-dependency" }],
    });
  });

  test("the forma CLI checks a file against its verified vendored packages", () => {
    const root = mkdtempSync(join(tmpdir(), "forma-cli-packages-"));
    const files: Record<string, unknown> = {
      "forma.json": { name: "app", exports: {}, dependencies: { "@acme/flows": "github.com/acme/flows@v2.1.0" } },
      "vendor/@acme/ir/forma.json": { name: "@acme/ir", version: "1.0.0", exports: { ".": "./ir.forma" } },
      "vendor/@acme/ir/ir.forma": irSource,
      "vendor/@acme/flows/forma.json": { name: "@acme/flows", version: "2.1.0", dependencies: { "@acme/ir": "gitlab.com/acme/ir@v1.0.0" }, exports: { ".": "./index.forma" } },
      "vendor/@acme/flows/index.forma": flowsSource,
      "src/main.forma": mainSource,
    };
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), typeof content === "string" ? content : JSON.stringify(content));
    }
    const hash = (text: string) => createHash("sha256").update(text).digest("hex");
    writeFileSync(join(root, "forma.lock"), JSON.stringify({ version: 1,
      manifest: hash(readFileSync(join(root, "forma.json"), "utf8")),
      packages: Object.fromEntries(["flows", "ir"].map(name => [`@acme/${name}`, {
        source: name === "flows" ? "github.com/acme/flows@v2.1.0" : "gitlab.com/acme/ir@v1.0.0",
        resolved: name === "flows" ? "v2.1.0" : "v1.0.0", commit: "a".repeat(40),
        files: Object.fromEntries(Object.keys(files).filter(path => path.startsWith(`vendor/@acme/${name}/`))
          .map(path => [path.slice(`vendor/@acme/${name}/`.length), hash(readFileSync(join(root, path), "utf8"))])),
      }])),
    }));
    const run = (operation: string) => {
      const result = spawnSync(process.execPath, [cli, "file", operation, join(root, "src/main.forma")], { encoding: "utf8", timeout: 20_000 });
      return JSON.parse(result.stdout);
    };
    expect(run("typecheck")).toMatchObject({ ok: true, diagnostics: [] });
    const interfaces = run("interface");
    expect(interfaces).toMatchObject({ ok: true });
    expect(interfaces.value.interfaces.at(-1).exports[0].data.contractId).toMatch(/^[a-f0-9]{64}$/);
    writeFileSync(join(root, "vendor/@acme/ir/ir.forma"), "edited");
    expect(run("typecheck")).toMatchObject({ ok: false, diagnostics: [{ code: "module/package-integrity" }] });
  }, 30_000);

  test("dependency commands add local packages, verify offline, and refresh local edits", () => {
    const root = mkdtempSync(join(tmpdir(), "forma-cli-dependencies-"));
    const files: Record<string, unknown> = {
      "forma.json": { name: "app", exports: {} },
      "local/flows/forma.json": { name: "@acme/flows", exports: { ".": "index.forma" }, dependencies: { "@acme/ir": "../ir" } },
      "local/flows/index.forma": flowsSource,
      "local/ir/forma.json": { name: "@acme/ir", exports: { ".": "ir.forma" } },
      "local/ir/ir.forma": irSource,
      "main.forma": mainSource,
    };
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), typeof content === "string" ? content : JSON.stringify(content));
    }
    const run = (...args: string[]) => {
      const result = spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: "utf8", timeout: 20_000 });
      return { status: result.status, ...JSON.parse(result.stdout) };
    };
    expect(run("add", "@acme/flows", "./local/flows")).toMatchObject({ status: 0, ok: true });
    expect(run("verify")).toMatchObject({ status: 0, ok: true, value: { packages: ["@acme/flows", "@acme/ir"] } });
    expect(run("file", "typecheck", "main.forma")).toMatchObject({ status: 0, ok: true, diagnostics: [] });
    writeFileSync(join(root, "local/ir/ir.forma"), irSource + "\n; local edit\n");
    expect(run("verify")).toMatchObject({ status: 1, ok: false, diagnostics: [{ code: "module/package-integrity" }] });
    expect(run("update", "@acme/ir")).toMatchObject({ status: 0, ok: true });
    expect(run("vendor")).toMatchObject({ status: 0, ok: true });
    expect(run("verify")).toMatchObject({ status: 0, ok: true });
  }, 60_000);

});

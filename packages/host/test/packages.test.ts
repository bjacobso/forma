import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, expect, test } from "vitest";
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

  test("the forma CLI checks a file against its installed packages", () => {
    const root = mkdtempSync(join(tmpdir(), "forma-cli-packages-"));
    const files: Record<string, unknown> = {
      "package.json": { name: "app", dependencies: { "@acme/flows": "^2.0.0" } },
      "node_modules/@acme/ir/package.json": { name: "@acme/ir", version: "1.0.0", forma: { exports: { ".": "./ir.forma" } } },
      "node_modules/@acme/ir/ir.forma": irSource,
      "node_modules/@acme/flows/package.json": { name: "@acme/flows", version: "2.1.0", dependencies: { "@acme/ir": "^1.0.0" }, forma: { exports: { ".": "./index.forma" } } },
      "node_modules/@acme/flows/index.forma": flowsSource,
      "src/main.forma": mainSource,
    };
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), typeof content === "string" ? content : JSON.stringify(content));
    }
    const run = (operation: string) => {
      const result = spawnSync(process.execPath, [cli, "file", operation, join(root, "src/main.forma")], { encoding: "utf8", timeout: 20_000 });
      return JSON.parse(result.stdout);
    };
    expect(run("typecheck")).toMatchObject({ ok: true, diagnostics: [] });
    const interfaces = run("interface");
    expect(interfaces).toMatchObject({ ok: true });
    expect(interfaces.value.interfaces.at(-1).exports[0].data.contractId).toMatch(/^[a-f0-9]{64}$/);
  });
});

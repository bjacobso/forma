import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterAll, beforeAll, expect, test } from "vitest";

const cli = resolve(import.meta.dirname, "../dist/cli.mjs");
const dir = realpathSync(mkdtempSync(join(tmpdir(), "forma-mcp-")));
const outside = realpathSync(mkdtempSync(join(tmpdir(), "forma-mcp-outside-")));
const client = new Client({ name: "forma-test", version: "1.0.0" });
const transport = new StdioClientTransport({ command: process.execPath, args: [cli, "mcp"], cwd: dir, stderr: "pipe" });
let stderr = "";
transport.stderr?.on("data", chunk => { stderr += chunk; });
const call = async (name: string, args: Record<string, unknown>) => {
  const result = await client.callTool({ name, arguments: args });
  expect(result.content).toEqual([expect.objectContaining({ type: "text", text: expect.any(String) })]);
  return result.structuredContent as Record<string, any>;
};
beforeAll(async () => {
  writeFileSync(join(dir, "dep.lisp"), "(export answer)\n(define answer 42)");
  writeFileSync(join(dir, "main.lisp"), '(import "./dep.lisp" [answer])\nanswer');
  writeFileSync(join(dir, "fmt.lisp"), "(+   1  2)");
  writeFileSync(join(outside, "secret.lisp"), "42");
  symlinkSync(join(outside, "secret.lisp"), join(dir, "escape.lisp"));
  await client.connect(transport);
}, 30_000);
afterAll(async () => {
  await client.close();
  rmSync(dir, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

test("advertises tools and embeds the edit script schema", async () => {
  const { tools } = await client.listTools();
  expect(tools.map(tool => tool.name)).toEqual(expect.arrayContaining(["check", "run", "format", "explain", "describe_nodes", "edit"]));
  const schema = tools.find(tool => tool.name === "edit")!.inputSchema;
  expect(schema.properties?.script).toEqual({ $ref: "#/$defs/EditScript" });
  expect(schema.$defs).toHaveProperty("EditOp");
  expect(stderr).toBe("");
});
test("checks inline sources and module paths with original diagnostics and repairs", async () => {
  expect(await call("check", { source: "(+ 1 2)" })).toMatchObject({ ok: true, type: "Int", diagnostics: [] });
  expect(await call("check", { path: "main.lisp" })).toMatchObject({ ok: true, type: "Int", diagnostics: [] });
  const source = readFileSync(new URL("../../../conformance/diagnostic-repairs/unbound.lisp", import.meta.url), "utf8");
  const result = await call("check", { source, sourceId: "repair.lisp" });
  expect(result).toMatchObject({ ok: false, diagnostics: [{ span: { sourceId: "repair.lisp", startLine: 2, startColumn: 2 }, fix: [{ newText: "total" }] }] });
  expect(JSON.stringify(result.diagnostics)).not.toMatch(/__forma_|\bt\d+\b/);
});
test("runs only checked programs, enforces step limits and grants no capabilities", async () => {
  expect(await call("run", { source: "(+ 1 2)" })).toMatchObject({ ok: true, printed: "3", type: "Int", diagnostics: [] });
  expect(await call("run", { path: "main.lisp" })).toMatchObject({ ok: true, printed: "42", type: "Int" });
  expect(await call("run", { source: '(if true 1 (+ 1 "bad"))' })).toMatchObject({ ok: false, value: null, printed: null, diagnostics: [expect.any(Object)] });
  expect(await call("run", { source: "(+ 1 2)", stepLimit: 1 })).toMatchObject({ ok: false, diagnostics: [expect.any(Object)] });
  expect(await call("run", { source: '(read-file "secret.lisp")' })).toMatchObject({ ok: false, value: null });
});
test("formats sources and writes only when explicitly requested with a path", async () => {
  const formatted = await call("format", { source: "(+   1  2)" });
  expect(formatted).toMatchObject({ ok: true, source: expect.stringContaining("(+ 1 2)") });
  expect(await call("format", { path: "fmt.lisp" })).toMatchObject({ source: formatted.source });
  expect(readFileSync(join(dir, "fmt.lisp"), "utf8")).toBe("(+   1  2)");
  expect(await call("format", { path: "fmt.lisp", write: true })).toMatchObject({ ok: true });
  expect(readFileSync(join(dir, "fmt.lisp"), "utf8")).toBe(formatted.source);
  expect(await call("format", { source: "1", write: true })).toMatchObject({ ok: false });
  expect(await call("format", { source: "(" })).toMatchObject({ ok: false, diagnostics: [expect.any(Object)] });
});
test("explains catalog codes", async () => {
  const checked = await call("check", { source: "missing" });
  const explained = await call("explain", { code: checked.diagnostics[0].code });
  expect(explained).toMatchObject({ ok: true, code: checked.diagnostics[0].code, summary: expect.any(String), explanation: expect.any(String) });
  expect(await call("explain", { code: "no-such-code" })).toMatchObject({ ok: false });
});
test("describes node ids and renames a binding and its references", async () => {
  const source = "(define total 1)\n(+ total 2)";
  const described = await call("describe_nodes", { source });
  expect(described).toMatchObject({ ok: true, diagnostics: [] });
  const target = described.nodes.find((node: { text: string }) => node.text === "total").id;
  const result = await call("edit", { source, script: { version: 1, ops: [{ op: "rename", target, to: "subtotal" }] } });
  expect(result).toMatchObject({ ok: true, source: "(define subtotal 1)\n(+ subtotal 2)", diagnostics: [] });
  expect(await call("edit", { source, script: { version: 1, ops: [{ op: "replace", target, text: "missing" }] } })).toMatchObject({ ok: false, source: expect.any(String), diagnostics: [expect.any(Object)] });
  expect(await call("edit", { source, script: { version: 1, ops: [{ op: "delete", target: "missing" }] } })).toMatchObject({ ok: false, diagnostics: [expect.any(Object)] });
});
test("confines direct paths, symlinks and imported modules to cwd", async () => {
  for (const name of ["check", "run", "format"]) {
    for (const path of [join(outside, "secret.lisp"), "escape.lisp"]) {
      expect(await call(name, { path, ...(name === "format" ? { write: true } : {}) })).toMatchObject({ ok: false, diagnostics: [expect.any(Object)] });
    }
  }
  writeFileSync(join(dir, "bad-import.lisp"), '(import "./escape.lisp" [answer])\nanswer');
  expect(await call("check", { path: "bad-import.lisp" })).toMatchObject({ ok: false });
  expect(readFileSync(join(outside, "secret.lisp"), "utf8")).toBe("42");
});
test("rejects ambiguous and malformed arguments and keeps serving", async () => {
  for (const args of [{}, { path: "main.lisp", source: "1" }, { source: 1 }, { source: "1", stepLimit: -1 }, { source: "1", hostBuiltins: [] }]) {
    expect(await call("run", args)).toMatchObject({ ok: false });
  }
  expect(await call("check", { source: "1" })).toMatchObject({ ok: true });
});

test("loads offline packages within cwd and rejects package paths outside it", async () => {
  const project = join(dir, "project");
  mkdirSync(join(project, "local"), { recursive: true });
  writeFileSync(join(project, "forma.json"), JSON.stringify({ name: "app", exports: {} }));
  writeFileSync(join(project, "local/forma.json"), JSON.stringify({ name: "local-lib", exports: { ".": "index.lisp" } }));
  writeFileSync(join(project, "local/index.lisp"), "(export answer)\n(define answer 42)");
  writeFileSync(join(project, "main.lisp"), '(import "local-lib" [answer])\nanswer');
  const added = spawnSync(process.execPath, [cli, "add", "local-lib", "./local"], { cwd: project, encoding: "utf8" });
  expect(added.status, added.stderr + added.stdout).toBe(0);
  expect(await call("run", { path: "project/main.lisp" })).toMatchObject({ ok: true, printed: "42" });
  writeFileSync(join(project, "forma.json"), JSON.stringify({ name: "app", exports: {}, dependencies: { "local-lib": relative(project, outside) } }));
  expect(await call("check", { path: "project/main.lisp" })).toMatchObject({ ok: false });
  const vendorProject = join(dir, "vendor-project");
  mkdirSync(vendorProject);
  writeFileSync(join(vendorProject, "forma.json"), JSON.stringify({ name: "app", exports: {} }));
  writeFileSync(join(vendorProject, "main.lisp"), "1");
  symlinkSync(outside, join(vendorProject, "vendor"));
  expect(await call("check", { path: "vendor-project/main.lisp" })).toMatchObject({ ok: false });
}, 30_000);

test("describes the forms and exports a module graph makes available", async () => {
  writeFileSync(join(dir, "rules.lisp"), `(export greeting GreetingIR)
(type GreetingIR {:kind "Greeting" :name Symbol :message String})
(form (greeting name message)
  :types {:name (Declares Greeting) :message String}
  :ir GreetingIR
  {:kind "Greeting" :name name :message message})`);
  const described = await call("describe", { path: "rules.lisp" });
  expect(described.ok).toBe(true);
  expect(JSON.stringify(described)).toContain("greeting");
  const outsideCall = await call("describe", { path: join(outside, "secret.lisp") });
  expect(outsideCall.ok).toBe(false);
});

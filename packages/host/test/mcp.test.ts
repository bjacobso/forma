import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterAll, beforeAll, expect, test } from "vitest";
// @ts-expect-error: a plain Node script without declarations.
import { examplesOutput, renderExamples } from "../scripts/generate-examples.mjs";
import { runGenerated } from "../src/cli/mcp-repl.js";
import { allBundledDocs, builtinDocs, effectKeywordDocs } from "../src/repl-docs.js";
import { effectCombinators, effectCoreFormNames } from "@formalang/ts/mechanics";
import { bundledModuleSources } from "@formalang/ts/modules";
import { preludeSources } from "@formalang/ts/preludes";

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
  expect(tools.map(tool => tool.name)).toEqual(expect.arrayContaining(["check", "run", "format", "explain", "describe_nodes", "edit", "repl"]));
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

test("checks typed goals with details and refuses to run them", async () => {
  const source = '(: repair (-> Int Int)) (define repair [a] ?todo)';
  expect(await call("check", {source})).toMatchObject({ok:false, diagnostics:[{code:"typecheck/hole", details:{name:"?todo",expected:"Int",candidates:["a"]}}]});
  expect(await call("run", {source})).toMatchObject({ok:false, diagnostics:[{code:"typecheck/hole"}]});
});

const repl = async (input: string, session?: string): Promise<Record<string, any>> => {
  const result = await client.callTool({ name: "repl", arguments: { input, ...(session ? { session } : {}) } });
  const text = (result.content as { text: string }[])[0]!.text;
  return { ...(result.structuredContent as Record<string, any>), text, isError: result.isError === true };
};
const users = `(type User {:id String :name String})
(error NotFound {:id String})
(service Users (: find (-> String (Effect (Option User)))))`;
const findUser = (errors: string) => `(import "forma:effect" [do bind pure])
(: find-user (-> String (Effect User [${errors}] [Users.find])))
(define find-user [id]
  (do (bind found (Users.find id))
      (bind _ (log "looked up" id))
      (match found (Some u) (pure u) None (fail (NotFound {:id id})))))`;

test("repl keeps pure definitions per session and grants no capabilities", async () => {
  expect(await repl("(define sq (fn [x] (* x x)))", "pure")).toMatchObject({ ok: true });
  const mapped = await repl("(map sq [1 2 3])", "pure");
  expect(mapped).toMatchObject({ ok: true, printed: "[1 4 9]", type: "List<Int>", text: "[1 4 9] : List<Int>" });
  // The printed value is the value; no second copy as the ABI's JSON tree.
  expect(mapped).not.toHaveProperty("value");
  expect(await repl(":type sq", "pure")).toMatchObject({ ok: true, type: "Int -> Int" });
  expect(await repl("(sq 2)", "other")).toMatchObject({ ok: false, isError: true, diagnostics: [{ code: "typecheck/unbound-symbol" }] });
  expect(await repl('(read-file "secret.lisp")', "pure")).toMatchObject({ ok: false, diagnostics: [{ code: "typecheck/unbound-symbol" }] });
  expect(await repl("(define spin (fn [n] (spin (+ n 1))))\n(spin 0)", "pure")).toMatchObject({ ok: false, diagnostics: [expect.any(Object)] });
  expect(await repl(":reset", "pure")).toMatchObject({ ok: true });
  expect(await repl("(sq 2)", "pure")).toMatchObject({ ok: false });
});

test("repl checks an Effect program cell by cell and reports declared and inferred types", async () => {
  expect(await repl(`:effect ${users}`, "fx")).toMatchObject({ ok: true, kept: true, added: ["declaration User", "declaration NotFound", "declaration Users"] });
  const rejected = await repl(`:effect ${findUser("")}`, "fx");
  // The checker points at the failing call inside the cell, and the cell is not kept.
  expect(rejected).toMatchObject({ ok: false, kept: false, isError: true,
    contracts: [{ name: "find-user", declared: "(-> String (Effect User [] [Users.find]))", inferred: "(Effect User [NotFound] [Users.find])" }],
    diagnostics: [{ code: "mechanics/undeclared-error", span: { sourceId: expect.stringMatching(/^<repl:\d+>$/u), startLine: 6, startColumn: 49 } }] });
  expect(rejected.text).toContain("(fail (NotFound {:id id}))");
  expect((await repl(":program", "fx")).source).not.toContain("find-user");
  expect(await repl(`:effect ${findUser("NotFound")}`, "fx")).toMatchObject({ ok: true, kept: true });
  expect(await repl(':infer (find-user "u-1")', "fx")).toMatchObject({ ok: true, type: "(Effect User [NotFound] [Users.find])" });
  expect(await repl(":expand (do (bind found (Users.find id)) (pure found))", "fx")).toMatchObject({ ok: true, source: expect.stringContaining("(do! [found (Users.find id)] (succeed found))") });
  expect((await repl(":ts", "fx")).code).toContain("export const findUser = (id: string): Effect.Effect<User, NotFound, Users> =>");
});

test("repl repairs edit the cell the diagnostic points into", async () => {
  // A later cell's repair is relocated from the assembled program into that cell.
  expect(await repl(":effect (type UserId (Brand String))\n(service Users (: find (-> UserId (Effect String))))", "fixes")).toMatchObject({ ok: true });
  const layer = await repl(":effect (layer UsersLive Users {:find (fn [id] (succeed \"x\"))})", "fixes");
  expect(layer.diagnostics[0].fix).toEqual(expect.arrayContaining([expect.objectContaining({ newText: ":provides ", span: expect.objectContaining({ sourceId: layer.diagnostics[0].span.sourceId, startOffset: 17 }) })]));
  expect(layer.text).toContain("= fix: replace `:find (fn ` with `(define find `");
  // :infer checks a synthesized definition; its repair still edits the input.
  const brand = await repl(':infer (Users.find "u-1")', "fixes");
  expect(brand.diagnostics[0]).toMatchObject({ help: 'Wrap the value with the brand constructor: (UserId "u-1").',
    fix: [{ newText: "(UserId ", span: { sourceId: brand.diagnostics[0].span.sourceId, startOffset: 12, endOffset: 12 } }, { newText: ")", span: { startOffset: 17, endOffset: 17 } }] });
  // Pure cells label their repairs with the cell, not a placeholder source.
  expect(await repl("(define total 1)", "fixes")).toMatchObject({ ok: true });
  expect((await repl("totl", "fixes")).text).toContain("= fix: replace `totl` with `total`");
});

test("repl reports a runtime error inside an earlier cell's definition in that cell", async () => {
  const defined = await repl("(define spin [n] (if (< n 0) n (spin (+ n 1))))", "cells");
  expect(defined).toMatchObject({ ok: true });
  const ran = await repl("(spin 0)", "cells");
  const span = ran.diagnostics[0].span;
  expect(ran.diagnostics[0]).toMatchObject({ code: "StepLimitExceeded", details: { function: "spin" } });
  // The caret lands in the definition's cell, inside the body that was running.
  expect(span).toMatchObject({ sourceId: expect.stringMatching(/^<repl:\d+>$/u), startLine: 1 });
  expect(span.startOffset).toBeGreaterThan("(spin 0)".length);
  expect(ran.text).toContain("1 | (define spin [n]");
});

test("repl runs effects only once their requirements are provided by session layers", async () => {
  await repl(`:effect ${users}\n${findUser("NotFound")}`, "run");
  const unprovided = await repl(':run (find-user "u-1")', "run");
  expect(unprovided).toMatchObject({ ok: false, diagnostics: [{ code: "repl/unprovided-requirements", message: expect.stringContaining("Users.find") }] });
  expect(unprovided.exit).toBeUndefined();
  await repl(':effect (layer UsersLive :provides Users (define find [id] (succeed (if (= id "u-1") (Some {:id "u-1" :name "Ada"}) None))))', "run");
  expect((await repl(':run (find-user "u-1")', "run")).diagnostics[0].help).toContain("UsersLive");
  expect(await repl(':run (provide (find-user "u-1") UsersLive)', "run")).toMatchObject({
    ok: true, exit: "success", type: "(Effect User [NotFound] [])", value: { id: "u-1", name: "Ada" }, logs: [expect.stringContaining("looked up u-1")] });
  expect(await repl(':run (provide (find-user "ghost") UsersLive)', "run")).toMatchObject({ ok: false, exit: "failure", errors: [{ _tag: "NotFound", id: "ghost" }] });
  expect(await repl(':run (provide (catch (find-user "ghost") (NotFound e) (succeed {:id (get e :id) :name "guest"})) UsersLive)', "run"))
    .toMatchObject({ ok: true, type: "(Effect {:id String :name String} [] [])", value: { id: "ghost", name: "guest" } });
  // A redefinition replaces the earlier layer by name.
  expect(await repl(':effect (layer UsersLive :provides Users (define find [id] (succeed (Some {:id id :name "Any"}))))', "run")).toMatchObject({ kept: true, replaced: ["declaration UsersLive"] });
  expect(await repl(':run (provide (find-user "ghost") UsersLive)', "run")).toMatchObject({ ok: true, value: { id: "ghost", name: "Any" } });
  expect(await repl(':run (config String "HOME")', "run")).toMatchObject({ ok: false, exit: "failure", errors: [{ _tag: "ConfigError" }] });
}, 30_000);

test("the run process reads only the effect package and sees no environment", async () => {
  const probe = (expression: string) => `import { Effect } from "effect";\nexport const __repl = Effect.sync(() => ${expression});\n`;
  expect(await runGenerated(probe("Object.keys(process.env).length"))).toMatchObject({ exit: "success", value: 0 });
  for (const attempt of [
    `process.getBuiltinModule("node:fs").readFileSync(${JSON.stringify(join(dir, "main.lisp"))}, "utf8")`,
    `process.getBuiltinModule("node:fs").writeFileSync(${JSON.stringify(join(dir, "written"))}, "x")`,
    `process.getBuiltinModule("node:child_process").execSync("true")`,
  ]) expect(await runGenerated(probe(attempt))).toMatchObject({ exit: "failure", defects: [expect.stringContaining("Access to this API has been restricted")] });
}, 30_000);

test("repl evolves the language through session preludes", async () => {
  const greeting = (extra = "", field = "") => `:prelude lang (type GreetingIR {:kind "Greeting" :name Symbol :message String${field}})
(form (greeting name message)
  :types {:name (Declares Greeting) :message String}
  :ir GreetingIR
  {:kind "Greeting" :name name :message message${extra}})
(macro (twice x) \`(+ ~x ~x))`;
  expect(await repl(greeting(), "lang")).toMatchObject({ ok: true, changed: "added" });
  expect(await repl("(define y (twice 5))", "lang")).toMatchObject({ ok: true, printed: "10" });
  expect((await repl(":describe", "lang")).forms).toMatchObject([{ name: "greeting" }]);
  // Input made only of prelude forms is declared: it elaborates to IR and is kept.
  expect(await repl('(greeting welcome "Ada")', "lang")).toMatchObject({ ok: true, declarations: [{ form: "greeting", payload: { kind: "Greeting", name: "welcome", message: "Ada" } }] });
  expect(await repl("(greeting oops 3)", "lang")).toMatchObject({ ok: false, kept: false, diagnostics: [{ code: "elaborate/hole-type", span: { startColumn: 16 } }] });
  // Changing the prelude rebuilds the session: earlier inputs replay against the new definitions.
  expect(await repl(greeting(' :loud (ends-with? message "!")', " :loud Bool").replace("(+ ~x ~x)", "(* 3 ~x)"), "lang")).toMatchObject({ ok: true, changed: "replaced", dropped: [] });
  expect(await repl("y", "lang")).toMatchObject({ printed: "15" });
  expect(await repl('(greeting shout "Hi!")', "lang")).toMatchObject({ declarations: [{ payload: { message: "Hi!", loud: true } }] });
  expect(await repl(":prelude lang (macro (twice", "lang")).toMatchObject({ ok: false, changed: "rejected" });
  expect(await repl("y", "lang")).toMatchObject({ printed: "15" });
  const removed = await repl(":prelude lang (define inc [x] (+ x 1))", "lang");
  expect(removed).toMatchObject({ ok: true, changed: "replaced" });
  expect(removed.diagnostics.map((d: { code: string }) => d.code)).toEqual(expect.arrayContaining(["typecheck/unbound-symbol", "repl/form-removed"]));
  expect(removed.diagnostics.every((d: { severity: string }) => d.severity === "warning")).toBe(true);
  expect(await repl("y", "lang")).toMatchObject({ ok: false });
  expect(await repl("(inc 1)", "lang")).toMatchObject({ printed: "2" });
});

test("repl documents forms and modules, and its examples are the conformance programs", async () => {
  expect(await repl(":doc do")).toMatchObject({ ok: true, docs: [{ kind: "macro", source: "forma:effect", summary: "run steps in order and return the last form" }, { kind: "effect", name: "do" }] });
  expect(await repl(":doc mechanics/undeclared-error")).toMatchObject({ ok: true, docs: [{ kind: "diagnostic", code: "mechanics/undeclared-error" }] });
  expect((await repl(":modules")).modules).toEqual(expect.arrayContaining([expect.objectContaining({ name: "forma:effect", exports: ["do", "bind", "pure"] })]));
  expect((await repl(":source forma:effect")).source).toContain("(macro (pure value)");
  expect(readFileSync(examplesOutput, "utf8"), "run pnpm --filter @formalang/host examples:generate").toBe(renderExamples());
  const { examples } = await repl(":examples");
  expect(examples.length).toBeGreaterThan(20);
  for (const { name, outcome } of examples) {
    const example = await repl(`:example ${name}`);
    const loaded = await repl(`:effect ${example.program}`, `example-${name}`);
    if (outcome === "runs") expect(loaded.diagnostics, name).toEqual([]);
    else expect(loaded.diagnostics.map((d: { code: string }) => d.code), name).toEqual(expect.arrayContaining(example.diagnostics.map((d: { code: string }) => d.code)));
  }
}, 60_000);

test("repl :doc covers prelude forms, Effect keywords and builtins, and points to related names", async () => {
  // Forms are documented without loading their prelude, from their :examples.
  const entity = await repl(":doc entity", "docs");
  expect(entity.docs).toEqual(expect.arrayContaining([expect.objectContaining({
    kind: "form", source: "ontology.lisp", use: ":load ontology.lisp", signature: "(entity name fields {:keys [doc role id-pattern tier]})",
    arguments: [{ name: "name", type: "(Declares SchemaDecl)" }, { name: "fields", type: "(Record Type)" }],
    options: expect.arrayContaining([{ name: "tier", type: "(Option (Union :user :meta))" }]),
    ir: "EntityDeclarationIR", examples: ["(entity Person {:name String :age (Option Int)})"] })]));
  expect(entity.text).toContain("Option keys: :doc (Option String), :role (Option String)");
  const layer = await repl(":doc layer", "docs");
  expect(layer).toMatchObject({ ok: true, docs: [{ kind: "effect", options: { ":provides": expect.any(String), ":setup": expect.any(String) }, try: ":effect" }] });
  expect(layer.text).toContain("(layer UsersLive :provides Users");
  const map = await repl(":doc map", "docs");
  expect(map).toMatchObject({ ok: true, docs: [{ kind: "builtin", usage: "(map f xs)", type: "(t0 -> t1) -> List<t0> -> List<t1>", effect: ["(-> (-> a b) (Array a) (Array b))"] }] });
  expect(map.text).toContain("(map (fn [x] (* x 2)) [1 2 3])");
  // No form is called policy; the one whose doc says policy is suggested.
  const policy = await repl(":doc policy", "docs");
  expect(policy).toMatchObject({ ok: false, related: expect.arrayContaining([expect.objectContaining({ name: "permission", source: "ontology.lisp" })]), diagnostics: [{ code: "repl/no-docs" }] });
  expect(policy.text).toContain("permission (form, ontology.lisp)");
});

test("every Effect keyword, builtin and bundled macro has a :doc example that checks", async () => {
  const keywords = new Map(effectKeywordDocs.map(doc => [doc.name, doc]));
  for (const name of [...effectCombinators.keys(), ...effectCoreFormNames]) expect(keywords.has(name), `:doc ${name}`).toBe(true);
  for (const [name, spec] of effectCombinators)
    expect(Object.keys(keywords.get(name)!.options ?? {}).sort(), `${name} option keys`).toEqual((spec.options ?? []).map(key => `:${key}`).sort());
  for (const doc of effectKeywordDocs) {
    const [shown] = (await repl(`:doc ${doc.name}`, "keyword-docs")).docs.filter((d: { kind: string }) => d.kind === "effect");
    const checked = await repl(`${shown.try} ${doc.example}`, `keyword-${doc.name}`);
    expect(checked.diagnostics, `:doc ${doc.name} example`).toEqual([]);
    expect(checked.ok, `:doc ${doc.name} example`).toBe(true);
  }
  for (const doc of builtinDocs) {
    if (doc.example.startsWith("(: ")) expect(await repl(`:effect ${doc.example}`, `builtin-${doc.name}`), `:doc ${doc.name} example`).toMatchObject({ ok: true, diagnostics: [] });
    else if (!(await repl(doc.example, "builtin-docs")).ok)
      expect(await repl(`:infer ${doc.example}`, "builtin-docs"), `:doc ${doc.name} example`).toMatchObject({ ok: true, diagnostics: [] });
  }
  // Macros: kernel and compiler.lisp examples evaluate, forma:effect examples check
  // as Effect code, and file-module library examples check as a file that imports them.
  await repl(":load compiler.lisp", "macro-docs");
  await repl(':effect (import "forma:effect" [do bind pure])', "macro-docs");
  const macros = allBundledDocs().filter(doc => doc.kind === "macro");
  expect(macros.length).toBeGreaterThan(25);
  for (const doc of macros) {
    const [example] = doc.examples;
    expect(example, `${doc.source} ${doc.name} has an example`).toBeDefined();
    if (!doc.source.startsWith("forma:")) {
      expect(await repl(example!, "macro-docs"), `${doc.name} example`).toMatchObject({ ok: true });
    } else if (doc.source === "forma:effect") {
      const declaration = /^\((service|error)\s/u.test(example!);
      expect(await repl(`${declaration ? ":effect" : ":infer"} ${example}`, "macro-docs"), `${doc.name} example`).toMatchObject({ ok: true, diagnostics: [] });
    } else {
      const exports = /^\(export ([^)]*)\)/mu.exec((bundledModuleSources as Record<string, string>)[doc.source.slice("forma:".length)]!)![1];
      writeFileSync(join(dir, "macro-example.lisp"), `(import "${doc.source}" [${exports}])\n${example}`);
      expect(await call("check", { path: "macro-example.lisp" }), `${doc.name} example`).toMatchObject({ ok: true });
    }
  }
}, 120_000);

test("repl pages long results and outlines large sources", async () => {
  const ontology = preludeSources["ontology.lisp"];
  const first = await repl(":source ontology.lisp", "pages");
  expect(first).toMatchObject({ ok: true, kind: "source", name: "ontology.lisp", page: { page: 1, more: ":more", omitted: ["source"] } });
  expect(first.source).toBeUndefined();
  expect(first.text.length).toBeLessThan(8_400);
  expect(first.text).toMatch(/\[:source ontology\.lisp: page 1 of \d+, lines 1-\d+ of \d+\. :more shows the next page/u);
  // Following :more to the end returns every line exactly once.
  const pages = [first];
  while (pages.at(-1)!.page?.more) pages.push(await repl(":more", "pages"));
  expect(pages.length).toBe(first.page.pages);
  expect(pages.map(p => p.text.slice(0, p.text.lastIndexOf("\n["))).join("\n")).toBe(ontology);
  expect(await repl(":more", "pages")).toMatchObject({ ok: false, diagnostics: [{ code: "repl/no-more" }] });
  await repl(":source ontology.lisp", "pages");
  await repl(":more", "pages");
  const rest = await repl(":more all", "pages");
  expect(rest).toMatchObject({ ok: true, source: ontology });
  expect(ontology.endsWith(rest.text)).toBe(true);

  const outline = await repl(":outline ontology.lisp", "pages");
  expect(outline.page).toBeUndefined();
  expect(outline.text).toMatch(/^ {2}108 form {2}entity — A named record of attributes\.$/mu);
  expect(outline.text).toMatch(/^ {4}8 ── ENTITY SCHEMAS AND SEED DATA$/mu);
  expect(await repl(":source ontology.lisp 108-109", "pages")).toMatchObject({ lines: [108, 109], source: ontology.split("\n").slice(107, 109).join("\n") });

  await repl(":load ontology.lisp", "pages");
  expect((await repl(":outline", "pages")).text).toMatch(/^Forms from ontology\.lisp \(\d+\):\n {2}entity relation seed/mu);
  const entity = await repl(":describe entity", "pages");
  expect(entity).toMatchObject({ ok: true, forms: [{ name: "entity", examples: [expect.stringContaining("(entity Person")] }], functions: [], types: [] });
  expect(entity.text).toContain("Optional: doc (Option String)");
  expect(await repl(":describe nothing-here", "pages")).toMatchObject({ ok: false, diagnostics: [{ code: "repl/unknown-name" }] });
}, 30_000);

test("repl :ir exports every declaration in the session as one document", async () => {
  expect(await repl(":ir", "ir")).toMatchObject({ ok: true, ir: { preludes: [], declarations: [], effect: [] } });
  await repl(":load ontology.lisp", "ir");
  await repl("(entity Person {:name String})", "ir");
  await repl("(entity Team {})\n(relation Member Person Team {})", "ir");
  // Redeclaring a name replaces it in place.
  await repl("(entity Person {:name String :age Int})", "ir");
  await repl(":effect (error NotFound {:id String})", "ir");
  const { ir, text } = await repl(":export", "ir");
  expect(ir.preludes).toEqual(["ontology.lisp"]);
  expect(ir.declarations.map((d: { id: string }) => d.id)).toEqual(["Entity:Person", "Entity:Team", "Relation:Member"]);
  expect(ir.declarations[0]).toMatchObject({ form: "entity", payload: { fields: [{ name: "person/name" }, { name: "person/age", type: "Int" }] } });
  expect(ir.effect).toMatchObject([{ id: "ErrorDef:NotFound", payload: { kind: "ErrorDef", name: "NotFound" } }]);
  expect(JSON.stringify(ir)).not.toContain('"span"');
  expect(JSON.parse(text)).toEqual(ir);
}, 30_000);

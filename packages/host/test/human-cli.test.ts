import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const cli = resolve(import.meta.dirname, "../dist/cli.mjs");
const dirs: string[] = [];
function workspace(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "forma-human-"));
  dirs.push(dir);
  for (const [name, source] of Object.entries(files)) writeFileSync(join(dir, name), source);
  return dir;
}
const run = (cwd: string, args: string[], input?: string) => spawnSync(process.execPath, [cli, ...args], {
  cwd, input, encoding: "utf8", env: { ...process.env, NO_COLOR: "1" },
});
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe("human CLI", { timeout: 30_000 }, () => {
  it("preserves the exact machine file responses", () => {
    const dir = workspace({ "main.lisp": "(+ 1 2)", "bad.lisp": '(+ 1 "nope")' });
    for (const args of [["typecheck", "main.lisp"], ["evaluate", "main.lisp"], ["evaluate", "--unchecked", "main.lisp"], ["declarations", "main.lisp"], ["interface", "main.lisp"], ["typecheck", "bad.lisp"]]) {
      const result = run(dir, ["file", ...args]);
      expect(result.status).toBe(args.at(-1) === "bad.lisp" ? 1 : 0);
      expect(result.stderr).toBe("");
      // Only the temporary directory is normalized; whitespace and key order are pinned.
      expect(result.stdout.replaceAll(realpathSync(dir), "<cwd>").replaceAll(dir, "<cwd>")).toMatchSnapshot(args.join(" "));
    }
  }, 30_000);
  for (const [name, files] of Object.entries({
    unbound: { "main.lisp": "missing" },
    mismatch: { "main.lisp": '(+ 1 "nope")' },
    syntax: { "main.lisp": "(+ 1" },
    modules: { "main.lisp": '(import "./dep.lisp" [answer])\nanswer', "dep.lisp": '(export answer)\n(define answer (+ 1 "nope"))' },
  })) {
    it(`renders ${name} diagnostics`, () => {
      const dir = workspace(files);
      const result = run(dir, ["check", "main.lisp"]);
      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("1 errors, 0 warnings");
      expect(result.stderr).toMatchSnapshot();
      expect(result.stderr).not.toMatch(/__forma_|\bt\d+\b|\(at line/);
    });
  }
  it("checks import-selected Effect contracts without host flags", () => {
    const dir = workspace({
      "domain.lisp": '(export Greeting) (type Greeting {:message String})',
      "rpc.lisp": '(import "./domain.lisp" [Greeting])\n(import "forma:effect/rpc" [rpc-group rpc])\n(rpc-group Greetings (rpc "Greet" :payload String :success Greeting))',
      "missing.lisp": '(rpc-group Greetings (rpc "Greet" :payload String :success String))',
    });
    expect(run(dir, ["check", "rpc.lisp"])).toMatchObject({ status: 0, stdout: "", stderr: "0 errors, 0 warnings\n" });
    const missing = run(dir, ["check", "missing.lisp"]);
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain('add (import "forma:effect/rpc" [rpc-group rpc])');
    expect(missing.stderr).toContain("missing.lisp:1:1");
    expect(missing.stderr).not.toMatch(/__forma_|\bt\d+\b/);
  });

  it("runs checked and unchecked programs and supports JSON", () => {
    const dir = workspace({ "main.lisp": "(+ 1 2)", "bad.lisp": '(+ 1 "nope")', "unchecked.lisp": '(upper "yes")' });
    expect(run(dir, ["run", "main.lisp"])).toMatchObject({ status: 0, stdout: "3\n" });
    expect(run(dir, ["run", "bad.lisp"])).toMatchObject({ status: 1, stdout: "" });
    expect(run(dir, ["run", "unchecked.lisp", "--unchecked"])).toMatchObject({ status: 0, stdout: '"YES"\n' });
    for (const command of ["check", "run"]) {
      const result = run(dir, [command, "main.lisp", "--json"]);
      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, diagnostics: [] });
      expect(result.stderr).toBe("");
    }
    expect(run(dir, ["run", "--bogus", "main.lisp"]).status).toBe(64);
  });
  it("describes modules and ordered legacy preludes in Markdown or JSON", () => {
    const dir = workspace({ "policy.lisp": '; Double an integer.\n(export double)\n(: double (-> Int Int))\n(define double [x] (* x 2))', "prelude.lisp": '(type Label String)\n(: label (-> String String))\n(define label [x] x)' });
    const markdown = run(dir, ["describe", "policy.lisp"]);
    expect(markdown).toMatchObject({ status: 0, stderr: "" });
    expect(markdown.stdout).toContain("## Functions");
    expect(markdown.stdout).toContain("(-> Int Int)");
    const json = run(dir, ["describe", "policy.lisp", "--format", "json"]);
    expect(json.status).toBe(0);
    expect(JSON.parse(json.stdout)).toMatchObject({ functions: [{ name: "double" }], diagnostics: [] });
    const legacy = run(dir, ["describe", "--prelude", "prelude.lisp", "--format", "json"]);
    expect(legacy.status).toBe(0);
    expect(JSON.parse(legacy.stdout)).toMatchObject({ types: [{ name: "Label" }], functions: [{ name: "label" }] });
    expect(run(dir, ["describe", "policy.lisp", "--format", "xml"]).status).toBe(64);
  });

  it("formats in place and checks without writing", () => {
    const dir = workspace({ "main.lisp": "(+   1  2)" });
    expect(run(dir, ["fmt", "main.lisp", "--check"])).toMatchObject({ status: 1, stdout: "main.lisp\n" });
    expect(readFileSync(join(dir, "main.lisp"), "utf8")).toBe("(+   1  2)");
    expect(run(dir, ["fmt", "main.lisp"]).status).toBe(0);
    expect(run(dir, ["fmt", "--check", "main.lisp"]).status).toBe(0);
    expect(JSON.parse(run(dir, ["fmt", "main.lisp", "--json"]).stdout)).toMatchObject({ ok: true });
  });
  it("checks module conformance files without modifying them", () => {
    const root = resolve(import.meta.dirname, "../../../conformance/modules");
    const files = readdirSync(root).filter(name => /\.(lisp|forma)$/.test(name));
    const before = files.map(name => readFileSync(join(root, name), "utf8"));
    const result = run(root, ["fmt", ...files, "--check", "--json"]);
    expect([0, 1]).toContain(result.status);
    expect(JSON.parse(result.stdout)).toMatchObject({ value: { files: expect.any(Array) } });
    expect(files.map(name => readFileSync(join(root, name), "utf8"))).toEqual(before);
  });
  it("supports state, type queries, reset, preludes and quit through stdin", () => {
    const dir = workspace({ "prelude.lisp": "(define seed 40)" });
    const result = run(dir, ["repl", "--prelude", "prelude.lisp"], "(+ seed 2)\n(define answer 7)\n:type answer\n:reset\n(+ seed 1)\n:quit\nmissing\n");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("42 : Int\n");
    expect(result.stdout).toContain("Int\n");
    expect(result.stdout).toContain("41 : Int\n");
    expect(result.stderr).toBe("");
  });
  it("explains diagnostics in text or JSON and orders help", () => {
    const dir = workspace({});
    const result = run(dir, ["explain", "typecheck/type-mismatch"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("typecheck/type-mismatch");
    expect(result.stdout).not.toContain('"ok"');
    expect(JSON.parse(run(dir, ["explain", "typecheck/type-mismatch", "--json"]).stdout)).toMatchObject({ ok: true });
    expect(run(dir, ["explain", "unknown"]).status).toBe(1);
    const help = run(dir, ["help"]).stdout;
    expect(help.indexOf("check <")).toBeLessThan(help.indexOf("file typecheck"));
  });
});

it("checks holes before running and locates unchecked runtime holes", () => {
  const dir = workspace({"main.lisp": '(: repair (-> Int Int)) (define repair [a] ?todo) (repair 1)'});
  for (const command of ["check", "run"]) {
    const result = run(dir, [command, "main.lisp"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("typecheck/hole");
    expect(result.stderr).toContain("Hole ?todo needs Int; candidates: a");
  }
  const unchecked = run(dir, ["run", "--unchecked", "main.lisp"]);
  expect(unchecked.status).toBe(1);
  expect(unchecked.stderr).toContain("Cannot evaluate hole ?todo");
});

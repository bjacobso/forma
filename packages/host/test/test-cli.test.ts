import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 30_000 });

const cli = resolve(import.meta.dirname, "../dist/cli.mjs");
const dirs: string[] = [];

function workspace(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "forma-test-"));
  dirs.push(dir);
  for (const [name, source] of Object.entries(files)) {
    mkdirSync(resolve(dir, name, ".."), { recursive: true });
    const imports = '(import "forma:test" [test is is=])\n';
    writeFileSync(join(dir, name), imports + source);
  }
  return dir;
}
const run = (cwd: string, ...args: string[]) => spawnSync(process.execPath, [cli, "test", ...args], { cwd, encoding: "utf8", timeout: 30_000 });
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

it("checks and evaluates a file graph using the bundled kernel", () => {
  const entry = resolve(import.meta.dirname, "../../../conformance/modules/bundled/main.lisp");
  const invoke = (...args: string[]) => spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
  const checked = invoke("check", entry);
  expect(checked.status, checked.stdout + checked.stderr).toBe(0);
  const evaluated = invoke("run", entry);
  expect(evaluated.status, evaluated.stdout + evaluated.stderr).toBe(0);
  expect(evaluated.stdout.trim()).toBe("true");
});

it("runs independent tests, reports assertion values and locations, and filters", () => {
  const dir = workspace({ "suite-test.lisp": '(test "bad" (is= (+ 1 1) 3))\n(test "good" (is true))' });
  const result = run(dir, "--json");
  expect(result.status).toBe(1);
  expect(result.stderr).toBe("");
  const data = JSON.parse(result.stdout);
  expect(data.results.map((r: { name: string; status: string }) => [r.name, r.status])).toEqual([["bad", "failed"], ["good", "passed"]]);
  expect(data.results[0].diagnostics[0]).toMatchObject({ message: expect.stringContaining("expected 3, actual 2"), span: { startLine: 2, startColumn: 13 } });
  expect(run(dir, "--filter", "good")).toMatchObject({ status: 0, stdout: expect.stringContaining("PASS good") });
  expect(run(dir).stdout).toContain("FAIL bad");
});

it("checks all bodies before running, continues after a broken file and a loop", () => {
  const dir = workspace({
    "a-test.lisp": '(test "bad type" (+ 1 "no"))',
    "b-test.lisp": '(: loop (-> Int Int))\n(define loop [n] (loop n))\n(test "loop" (loop 0))\n(test "later" (is= [1 2] [1 2]))',
  });
  const result = run(dir, "--json");
  expect(result.status).toBe(1);
  const data = JSON.parse(result.stdout);
  expect(data.files[0].status).toBe("failed");
  expect(data.files[0].diagnostics.length).toBeGreaterThan(0);
  expect(data.results.map((r: { status: string }) => r.status)).toEqual(["failed", "passed"]);
  expect(JSON.stringify(data)).toMatch(/step.limit/i);
  expect(JSON.stringify(data)).not.toMatch(/__forma_|\bt\d+\b/);
}, 30_000);

it("discovers only test paths, deduplicates, accepts explicit files and rejects bad flags", () => {
  const dir = workspace({ "test/nested/cases.lisp": '(test "nested" (is true))', "ordinary.lisp": '(test "explicit" (is true))', "node_modules/ignored-test.lisp": 'broken' });
  expect(JSON.parse(run(dir, ".", "test", "--json").stdout).results.map((r: { name: string }) => r.name)).toEqual(["nested"]);
  expect(run(dir, "ordinary.lisp")).toMatchObject({ status: 0, stdout: expect.stringContaining("PASS explicit") });
  expect(run(dir, "--filter").status).toBe(64);
  expect(run(dir, "--unknown").status).toBe(64);
});

it("runs the checked-in assertion conformance suite", () => {
  const root = resolve(import.meta.dirname, "../../../");
  const result = run(root, "conformance/tests", "--json");
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout).results).toHaveLength(3);
});

it("keeps imported tests dormant and stops only the failing test at its first assertion", () => {
  const dir = workspace({
    "library.lisp": '(export answer)\n(define answer 42)\n(test "dormant" (is false))',
    "suite-test.lisp": '(import "./library.lisp" [answer])\n(test "sequence"\n  (is= answer 42)\n  (is= answer 0)\n  (is= answer 1))\n(test "after" (is= answer 42))',
  });
  const result = run(dir, "--json");
  expect(result.status).toBe(1);
  const data = JSON.parse(result.stdout);
  expect(data.results.map((r: { name: string; status: string }) => [r.name, r.status])).toEqual([["sequence", "failed"], ["after", "passed"]]);
  expect(data.results[0].diagnostics[0]).toMatchObject({ message: "expected 0, actual 42", span: { startLine: 5, startColumn: 3 } });
});

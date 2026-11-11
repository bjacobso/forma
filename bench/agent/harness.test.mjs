import assert from "node:assert/strict";
import test from "node:test";
import { metrics, parseOptions } from "./harness.mjs";

test("repair rounds count only failures for the final entry before its first success", () => {
  const call = (mode, entry, exitCode) => ({ argv: ["file", mode, entry], exitCode });
  assert.deepEqual(metrics([
    call("typecheck", "scratch.lisp", 1),
    call("typecheck", "main.lisp", 1),
    call("evaluate", "./main.lisp", 1),
    call("interface", "main.lisp", 1),
    call("declarations", "main.lisp", 0),
    call("evaluate", "main.lisp", 1),
  ], "/tmp/task", "main.lisp"), { repairRounds: 2, cliCallCount: 6, firstPassingCall: 5 });
});
test("no passing call remains observable", () => {
  assert.deepEqual(metrics([{ argv: ["file", "evaluate", "main.lisp"], exitCode: 1 }], "/tmp/task", "main.lisp"),
    { repairRounds: 1, cliCallCount: 1, firstPassingCall: null });
});
test("options reject unknown flags, missing values and duplicate task IDs", () => {
  assert.throws(() => parseOptions(["--wat", "x"]));
  assert.throws(() => parseOptions(["--agent-cmd"]));
  assert.throws(() => parseOptions(["--agent-cmd", "true", "--tasks", "a,a"]));
  assert.equal(parseOptions(["--agent-cmd", "true"]).out, "results.json");
});

test("sandbox paths match the physical cwd logged by Node", async () => {
  const { realpath, rm } = await import("node:fs/promises");
  const { prepare } = await import("./harness.mjs");
  const { dir } = await prepare("tiered-price");
  try { assert.equal(dir, await realpath(dir)); }
  finally { await rm(dir, { recursive: true, force: true }); }
});

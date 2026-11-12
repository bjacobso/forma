import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { checkDefineForm } from "./check-define-form.mjs";

test("legacy occurrences may shrink, but cannot grow or appear in another tracked file", () => {
  const root = mkdtempSync(join(tmpdir(), "forma-legacy-guard-"));
  try {
    execFileSync("git", ["init", "--quiet", root]);
    mkdirSync(join(root, "scripts"));
    writeFileSync(join(root, "scripts/legacy-forms-allowlist.json"), JSON.stringify({ "old.lisp": 2 }));
    writeFileSync(join(root, "old.lisp"), "define-form\ndefine-form\n");
    execFileSync("git", ["add", "."], { cwd: root });
    assert.deepEqual(checkDefineForm(root), []);
    writeFileSync(join(root, "old.lisp"), "define-form\n");
    assert.deepEqual(checkDefineForm(root), []);
    writeFileSync(join(root, "old.lisp"), "define-form\ndefine-form\ndefine-form\n");
    assert.deepEqual(checkDefineForm(root), ["old.lisp: 3 occurrences exceed allowance 2"]);
    writeFileSync(join(root, "old.lisp"), "");
    writeFileSync(join(root, "new.lisp"), "define-form\n");
    assert.deepEqual(checkDefineForm(root), []); // Untracked files are outside the policy.
    execFileSync("git", ["add", "new.lisp"], { cwd: root });
    assert.deepEqual(checkDefineForm(root), ["new.lisp: 1 occurrences exceed allowance 0"]);
    rmSync(join(root, "old.lisp"));
    assert.deepEqual(checkDefineForm(root), ["new.lisp: 1 occurrences exceed allowance 0"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

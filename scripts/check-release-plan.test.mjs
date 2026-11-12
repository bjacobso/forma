import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

async function fixture(t, { changelog = "# Forma\n\n## 0.5.0\n", extraPublic = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), "forma-release-plan-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const directory of ["scripts", ".changeset", "packages/forma", "packages/ts"]) {
    await mkdir(join(root, directory), { recursive: true });
  }
  await cp(new URL("./check-release-plan.mjs", import.meta.url), join(root, "scripts/check-release-plan.mjs"));
  await writeFile(join(root, ".changeset/config.json"), JSON.stringify({ privatePackages: { version: false, tag: false }, ignore: [] }));
  await writeFile(join(root, ".changeset/README.md"), "Changesets\n");
  await writeFile(join(root, "packages/forma/package.json"), JSON.stringify({ name: "@forma-language/forma", version: "0.5.0" }));
  await writeFile(join(root, "packages/ts/package.json"), JSON.stringify({ name: "@formalang/ts", private: !extraPublic }));
  await writeFile(join(root, "packages/forma/CHANGELOG.md"), changelog);
  return spawnSync(process.execPath, ["scripts/check-release-plan.mjs"], { cwd: root, encoding: "utf8" });
}

test("accepts consumed changesets with a matching release changelog", async t => {
  const result = await fixture(t);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /0.5.0 prepared/);
});

test("rejects consumed changesets without the manifest version in the changelog", async t => {
  const result = await fixture(t, { changelog: "# Forma\n\n## 0.4.0\n" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /versioned release must have a changelog entry/);
});

test("still rejects a public implementation workspace after versioning", async t => {
  const result = await fixture(t, { extraPublic: true });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /@formalang\/ts/);
});

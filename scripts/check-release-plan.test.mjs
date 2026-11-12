import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const docs = version => ({
  "README.md": `The public distribution is \`@forma-language/forma\` ${version}, with Effect.\n`,
  "packages/forma/README.md": `Prepared pre-alpha distribution, version ${version}.\n`,
  "docs/publishing.md": `\`@forma-language/forma\` **${version}** is next.\n\nnpm install ../forma/forma-language-forma-${version}.tgz\n`,
});

async function fixture(t, { changelog = "# Forma\n\n## 0.5.0\n", extraPublic = false, docsVersion = "0.5.0", script = "scripts/check-release-plan.mjs" } = {}) {
  const root = await mkdtemp(join(tmpdir(), "forma-release-plan-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const directory of ["scripts", ".changeset", "packages/forma", "packages/ts", "docs"]) {
    await mkdir(join(root, directory), { recursive: true });
  }
  await cp(new URL("./check-release-plan.mjs", import.meta.url), join(root, "scripts/check-release-plan.mjs"));
  await cp(new URL("./sync-release-version.mjs", import.meta.url), join(root, "scripts/sync-release-version.mjs"));
  for (const [file, text] of Object.entries(docs(docsVersion))) await writeFile(join(root, file), text);
  await writeFile(join(root, ".changeset/config.json"), JSON.stringify({ privatePackages: { version: false, tag: false }, ignore: [] }));
  await writeFile(join(root, ".changeset/README.md"), "Changesets\n");
  await writeFile(join(root, "packages/forma/package.json"), JSON.stringify({ name: "@forma-language/forma", version: "0.5.0" }));
  await writeFile(join(root, "packages/ts/package.json"), JSON.stringify({ name: "@formalang/ts", private: !extraPublic }));
  await writeFile(join(root, "packages/forma/CHANGELOG.md"), changelog);
  const result = spawnSync(process.execPath, [script], { cwd: root, encoding: "utf8" });
  return Object.assign(result, { root });
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

test("rejects a prepared release whose docs name another version", async t => {
  const result = await fixture(t, { docsVersion: "0.4.0" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /names 0\.4\.0, manifest is 0\.5\.0/);
});

test("sync rewrites every documented version to the manifest", async t => {
  const result = await fixture(t, { docsVersion: "0.4.0", script: "scripts/sync-release-version.mjs" });
  assert.equal(result.status, 0, result.stderr);
  for (const [file, text] of Object.entries(docs("0.5.0"))) assert.equal(await readFile(join(result.root, file), "utf8"), text);
  const checked = spawnSync(process.execPath, ["scripts/check-release-plan.mjs"], { cwd: result.root, encoding: "utf8" });
  assert.equal(checked.status, 0, checked.stderr);
});

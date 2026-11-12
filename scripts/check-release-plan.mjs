import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, readdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const expected = "@forma-language/forma";
const publicNames = [];
for (const directory of await readdir(join(root, "packages"))) {
  const pkg = JSON.parse(await readFile(join(root, "packages", directory, "package.json"), "utf8"));
  if (!pkg.private) publicNames.push(pkg.name);
}
assert.deepEqual(publicNames, [expected]);
const config = JSON.parse(await readFile(join(root, ".changeset/config.json"), "utf8"));
assert.deepEqual(config.privatePackages, { version: false, tag: false });
assert.deepEqual(config.ignore, []);
const notes = (await readdir(join(root, ".changeset"))).filter(name => name.endsWith(".md") && name !== "README.md");
if (notes.length === 0) {
  // A prepared release has consumed its notes. Changesets status rejects this
  // legitimate state while files differ from main, before writing its plan.
  const manifest = JSON.parse(await readFile(join(root, "packages/forma/package.json"), "utf8"));
  const changelog = await readFile(join(root, "packages/forma/CHANGELOG.md"), "utf8");
  assert(changelog.includes(`\n## ${manifest.version}\n`), "versioned release must have a changelog entry");
  console.log(`Changesets: ${manifest.version} prepared in changelog; only the public facade is eligible`);
} else {
  const temporary = await mkdtemp(join(tmpdir(), "forma-plan-"));
  try {
    const output = join(temporary, "status.json");
    execFileSync("pnpm", ["exec", "changeset", "status", `--output=${output}`], { cwd: root, stdio: "pipe" });
    const plan = JSON.parse(await readFile(output, "utf8"));
    for (const release of plan.releases) assert.equal(release.name, expected);
    for (const changeset of plan.changesets) {
      for (const release of changeset.releases) assert.equal(release.name, expected);
    }
    console.log("Changesets: only the public facade is eligible; private versioning and tags disabled");
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

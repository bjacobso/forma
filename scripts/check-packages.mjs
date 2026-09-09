import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const temporary = await mkdtemp(join(tmpdir(), "forma-release-check-"));
const run = (command, args, cwd = root) => execFileSync(command, args, {
  cwd, encoding: "utf8", timeout: 120_000, stdio: ["ignore", "pipe", "pipe"],
});
const targets = (value) => typeof value === "string" ? [value]
  : value && typeof value === "object" ? Object.values(value).flatMap(targets) : [];

try {
  const packages = [];
  for (const directory of await readdir(join(root, "packages"))) {
    const cwd = join(root, "packages", directory);
    const manifest = JSON.parse(await readFile(join(cwd, "package.json"), "utf8"));
    if (manifest.private) continue;
    const archive = join(temporary, `${directory}.tgz`);
    run("pnpm", ["pack", "--out", archive], cwd);
    const entries = new Set(run("tar", ["-tzf", archive]).trim().split("\n"));
    const packed = JSON.parse(run("tar", ["-xOzf", archive, "package/package.json"]));
    assert(entries.has("package/README.md"), `${manifest.name}: missing README`);
    assert(entries.has("package/LICENSE"), `${manifest.name}: missing license`);
    for (const target of [manifest.main, manifest.types, ...targets(manifest.exports), ...targets(manifest.bin)]) {
      assert(entries.has(`package/${target.replace(/^\.\//, "")}`), `${manifest.name}: missing ${target}`);
    }
    for (const spec of Object.values({ ...packed.dependencies, ...packed.optionalDependencies, ...packed.peerDependencies })) {
      assert(!/^(workspace|catalog):/.test(spec), `${manifest.name}: unresolved dependency ${spec}`);
    }
    assert.equal(packed.publishConfig.access, "public");
    assert.equal(packed.repository.url, "git+https://github.com/bjacobso/forma.git");
    for (const entry of entries) {
      assert(!/^package\/(src|test|node_modules)\//.test(entry), `${manifest.name}: unexpected ${entry}`);
    }
    if (directory === "language-server") {
      assert(entries.has("package/dist/runtime/jsoo_entry.cjs"), "Language server is missing its portable engine");
    }
    packages.push({ directory, manifest, archive });
    console.log(`Packed ${manifest.name}: exports and dependencies verified`);
  }
  assert.equal(packages.length, 4, "Expected four public packages; update the smoke check when adding packages");
  const consumer = join(temporary, "consumer");
  await mkdir(consumer);
  await writeFile(join(consumer, "package.json"), JSON.stringify({ private: true, type: "module" }));
  run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", ...packages.map(p => p.archive)], consumer);
  const byDirectory = Object.fromEntries(packages.map(p => [p.directory, p.manifest.name]));
  const smoke = `
    import assert from 'node:assert/strict';
    for (const name of ${JSON.stringify(packages.flatMap(p => Object.keys(p.manifest.exports).filter(e => e !== './server').map(e => p.manifest.name + (e === '.' ? '' : e.slice(1)))) )}) await import(name);
    const { createDefaultLanguageHost } = await import(${JSON.stringify(byDirectory.host)});
    assert.equal(typeof createDefaultLanguageHost().parseSync, 'function');
    const { OcamlAbiClient } = await import(${JSON.stringify(byDirectory['language-server'])});
    assert.equal((await OcamlAbiClient.inspectArtifact()).status, 'ready');
    const client = await OcamlAbiClient.create();
    try {
      const parsed = await client.request({ op: 'parse', sourceId: 'package-smoke', source: '(+ 1 2)' });
      assert.equal(parsed.ok, true);
    }
    finally { await client.close(); }
    console.log('Installed tarballs: all library exports and bundled OCaml engine work');
  `;
  await writeFile(join(consumer, "smoke.mjs"), smoke);
  console.log(run(process.execPath, ["smoke.mjs"], consumer).trim());
} finally {
  await rm(temporary, { recursive: true, force: true });
}

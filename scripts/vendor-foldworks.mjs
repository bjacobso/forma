#!/usr/bin/env node
// Refresh committed packages from a clean, installed Foldworks checkout.
// FOLDWORKS_DIR=../foldworks pnpm vendor:foldworks
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const packages = ["agent", "code-editor", "history", "keyboard", "outliner", "text-intelligence", "ui"];
const run = (command, args, cwd) => execFileSync(command, args, { cwd, encoding: "utf8" });
const targets = (value) => typeof value === "string" ? [value]
  : value && typeof value === "object" ? Object.values(value).flatMap(targets) : [];

assert(process.env.FOLDWORKS_DIR, "Set FOLDWORKS_DIR to a clean Foldworks checkout with a frozen install.");
const foldworks = resolve(process.env.FOLDWORKS_DIR);
const revision = run("git", ["rev-parse", "HEAD"], foldworks).trim();
assert.equal(run("git", ["status", "--porcelain"], foldworks).trim(), "", "Foldworks must be clean so its revision identifies the packed source.");
const workspacePath = join(root, "pnpm-workspace.yaml");
const workspace = readFileSync(workspacePath, "utf8");
const marker = /  # BEGIN vendored Foldworks\n[\s\S]*?  # END vendored Foldworks/;
assert(marker.test(workspace), "Missing Foldworks overrides block in pnpm-workspace.yaml.");
const staging = mkdtempSync(join(tmpdir(), "forma-foldworks-"));

try {
  // Turbo builds the primitives and their dependencies in dependency order.
  execFileSync("pnpm", ["exec", "turbo", "run", "build", ...packages.map(name => `--filter=@foldworks/${name}`)], {
    cwd: foldworks, stdio: "inherit",
  });
  const manifest = [];
  for (const name of packages) {
    const cwd = join(foldworks, "packages", name);
    const metadata = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"));
    assert.equal(metadata.name, `@foldworks/${name}`);
    const file = `foldworks-${name}-${metadata.version}.tgz`;
    const archive = join(staging, file);
    execFileSync("pnpm", ["pack", "--out", archive], { cwd, stdio: "inherit" });
    const entries = new Set(run("tar", ["-tzf", archive], root).trim().split("\n"));
    const packed = JSON.parse(run("tar", ["-xOzf", archive, "package/package.json"], root));
    for (const target of [...targets(packed.exports), "LICENSE", "README.md"]) {
      assert(entries.has(`package/${target.replace(/^\.\//, "")}`), `${metadata.name}: missing ${target}`);
    }
    for (const section of ["dependencies", "optionalDependencies", "peerDependencies"]) {
      for (const [dependency, spec] of Object.entries(packed[section] ?? {})) {
        assert(!/^(workspace|catalog|file|link):/.test(spec), `${metadata.name}: unresolved dependency ${dependency}: ${spec}`);
        assert(!dependency.startsWith("@foldworks/") || packages.includes(dependency.slice("@foldworks/".length)),
          `${metadata.name}: vendor the new Foldworks dependency ${dependency} too`);
      }
    }
    manifest.push({
      name: metadata.name,
      version: metadata.version,
      source: `foldworks/packages/${name}`,
      revision,
      dirty: false,
      file,
      sha256: createHash("sha256").update(readFileSync(archive)).digest("hex"),
    });
  }
  assert.equal(run("git", ["rev-parse", "HEAD"], foldworks).trim(), revision, "Foldworks revision changed while packing.");
  assert.equal(run("git", ["status", "--porcelain"], foldworks).trim(), "", "Packing changed Foldworks source.");
  // Only replace the committed artifacts after every package packs successfully.
  const vendor = join(root, "vendor");
  mkdirSync(vendor, { recursive: true });
  for (const file of readdirSync(vendor)) {
    if (/^foldworks-.*\.tgz$/.test(file)) rmSync(join(vendor, file));
  }
  for (const entry of manifest) copyFileSync(join(staging, entry.file), join(vendor, entry.file));
  writeFileSync(join(vendor, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  const overrides = manifest.map(entry => `  "${entry.name}": file:./vendor/${entry.file}`).join("\n");
  writeFileSync(workspacePath, workspace.replace(marker, `  # BEGIN vendored Foldworks\n${overrides}\n  # END vendored Foldworks`));
  console.log(`Vendored ${manifest.length} Foldworks packages at ${revision}. Run pnpm install --no-frozen-lockfile, then review the artifacts and lockfile.`);
} finally {
  rmSync(staging, { recursive: true, force: true });
}

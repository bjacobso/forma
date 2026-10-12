#!/usr/bin/env node
// Validate the committed registry lock before adding the workbench's
// unpublished dependencies. Release metadata jobs need only this install.
// --lockfile-only regenerates the registry lock after Changesets versions
// packages, without recording local Foldworks tarballs in the release PR.
// Keep the workbench's published dependencies locked; omit only unpublished
// @foldworks/* dependencies from its two manifests during the registry install.
// The original manifests are restored even when install fails.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const manifest = new URL("../packages/workbench/package.json", import.meta.url);
const unpublished = existsSync(manifest) && JSON.parse(readFileSync(manifest, "utf8")).private === true;
const lockfileOnly = process.argv.includes("--lockfile-only");
const originals = new Map();

try {
  if (unpublished) {
    for (const path of [manifest, new URL("../apps/workbench/package.json", import.meta.url)]) {
      const original = readFileSync(path, "utf8");
      originals.set(path, original);
      const pkg = JSON.parse(original);
      for (const section of ["dependencies", "devDependencies", "optionalDependencies"]) {
        for (const name of Object.keys(pkg[section] ?? {})) {
          if (name.startsWith("@foldworks/")) delete pkg[section][name];
        }
      }
      writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`);
    }
  }
  const args = lockfileOnly ? ["--lockfile-only", "--no-frozen-lockfile"] : ["--frozen-lockfile"];
  execFileSync("pnpm", ["install", "--ignore-pnpmfile", ...args], { cwd: root, stdio: "inherit" });
} finally {
  for (const [path, original] of originals) writeFileSync(path, original);
}

#!/usr/bin/env node
// Validate the committed registry lock before adding the workbench's
// unpublished dependencies. Release metadata jobs need only this install.
// --lockfile-only regenerates the registry lock after Changesets versions
// packages, without recording local Foldworks tarballs in the release PR.
// The original workspace is restored even when install fails.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const workspace = new URL("../pnpm-workspace.yaml", import.meta.url);
const original = readFileSync(workspace, "utf8");
const manifest = new URL("../packages/workbench/package.json", import.meta.url);
const unpublished = existsSync(manifest) && JSON.parse(readFileSync(manifest, "utf8")).private === true;
const lockfileOnly = process.argv.includes("--lockfile-only");

try {
  if (unpublished) {
    writeFileSync(workspace, `${original}\n  - "!packages/workbench"\n  - "!apps/workbench"\n`);
  }
  const args = lockfileOnly ? ["--lockfile-only", "--no-frozen-lockfile"] : ["--frozen-lockfile"];
  execFileSync("pnpm", ["install", "--ignore-pnpmfile", ...args], { cwd: root, stdio: "inherit" });
} finally {
  writeFileSync(workspace, original);
}

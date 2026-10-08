#!/usr/bin/env node
// Use the same frozen registry install and pinned package tarballs as CI.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const run = (command, args, cwd = root, env = process.env) =>
  execFileSync(command, args, { cwd, env, stdio: "inherit" });

run("node", ["scripts/ci-install-registry.mjs"]);
const manifest = JSON.parse(readFileSync(resolve(root, "packages/workbench/package.json"), "utf8"));
if (manifest.private === true) {
  // Keep this revision in sync with .github/actions/install/action.yml.
  const revision = "695695e48f39df3df4a588c319269eedafb3886b";
  const foldworks = resolve(root, ".context/foldworks-setup");
  if (!existsSync(foldworks)) {
    run("git", ["clone", "--no-checkout", "https://github.com/bjacobso/foldworks.git", foldworks]);
    run("git", ["checkout", "--detach", revision], foldworks);
  }
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: foldworks, encoding: "utf8" }).trim();
  if (head !== revision) throw new Error(`Expected Foldworks ${revision} in ${foldworks}, found ${head}.`);
  run("pnpm", ["install", "--frozen-lockfile"], foldworks);
  run("pnpm", ["build:packages"], foldworks);
  const lockfile = resolve(root, "pnpm-lock.yaml");
  const original = readFileSync(lockfile);
  try {
    run("node", ["scripts/foldworks-link.mjs"], root, { ...process.env, FOLDWORKS_DIR: foldworks });
    run("pnpm", ["install", "--no-frozen-lockfile"]);
  } finally {
    // The local tarball resolution belongs to this workspace, not the PR.
    writeFileSync(lockfile, original);
  }
}

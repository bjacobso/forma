#!/usr/bin/env node
// PR CI validates the committed registry lock before adding the workbench's
// unpublished dependencies. Both new projects are excluded only for this
// frozen install; the original workspace is restored even when install fails.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const workspace = new URL("../pnpm-workspace.yaml", import.meta.url);
const original = readFileSync(workspace, "utf8");

try {
  writeFileSync(workspace, `${original}\n  - "!packages/workbench"\n  - "!apps/workbench"\n`);
  execFileSync("pnpm", ["install", "--frozen-lockfile"], { cwd: root, stdio: "inherit" });
} finally {
  writeFileSync(workspace, original);
}

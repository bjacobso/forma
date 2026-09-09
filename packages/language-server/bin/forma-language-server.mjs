#!/usr/bin/env node
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const serverPath = resolve(packageRoot, "dist/server.js");

if (!existsSync(serverPath)) {
  console.error(
    [
      "forma-language-server has not been built yet.",
      "Run `pnpm --filter @formalang/language-server build` from the repository root, then retry.",
    ].join("\n"),
  );
  process.exit(1);
}

await import(pathToFileURL(serverPath).href);

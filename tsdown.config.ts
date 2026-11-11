import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, resolve } from "node:path";
import { defineConfig, type UserConfig } from "tsdown";

type PackageJson = {
  name?: string;
};

const cwd = process.cwd();
const pkg = JSON.parse(readFileSync(resolve(cwd, "package.json"), "utf8")) as PackageJson;
const packageName = pkg.name ?? basename(cwd);

// Content identity, not the npm version: local edits also invalidate snapshots.
function sourceIdentity(directory: string): string {
  const hash = createHash("sha256");
  const visit = (path: string): void => {
    for (const entry of readdirSync(path,{withFileTypes:true}).sort((a,b) => a.name.localeCompare(b.name))) {
      const file = resolve(path,entry.name);
      if (entry.isDirectory()) visit(file);
      else { hash.update(file.slice(directory.length)); hash.update(readFileSync(file)); }
    }
  };
  visit(directory);
  hash.update(readFileSync(resolve(cwd,"../../pnpm-lock.yaml")));
  hash.update(readFileSync(resolve(cwd,"../../tsdown.config.ts")));
  return hash.digest("hex");
}

const packageEntries: Record<string, UserConfig["entry"]> = {
  "@formalang/ts": ["src/*.ts"],
  "@formalang/host": ["src/*.ts"],
};

export default defineConfig({
  name: packageName,
  cwd,
  entry: packageEntries[packageName] ?? ["src/index.ts"],
  root: "src",
  format: "esm",
  dts: true,
  clean: true,
  platform: "node",
  target: "esnext",
  define: packageName === "@formalang/ts" ? {__FORMA_BUILD_ID__:JSON.stringify(sourceIdentity(resolve(cwd,"src")))} : {},
  fixedExtension: packageName === "@formalang/ts" || packageName === "@formalang/host",
  unbundle: true,
});

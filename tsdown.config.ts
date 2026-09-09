import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { defineConfig, type UserConfig } from "tsdown";

type PackageJson = {
  name?: string;
};

const cwd = process.cwd();
const pkg = JSON.parse(readFileSync(resolve(cwd, "package.json"), "utf8")) as PackageJson;
const packageName = pkg.name ?? basename(cwd);

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
  fixedExtension: packageName === "@formalang/ts" || packageName === "@formalang/host",
  unbundle: true,
});

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "tsdown";

const version = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")).version;

export default defineConfig({
  entry: ["src/**/*.ts"],
  root: "src",
  format: "esm",
  fixedExtension: true,
  target: "es2022",
  define: { __FORMA_DISTRIBUTION_VERSION__: JSON.stringify(version) },
  platform: "node",
  dts: { compilerOptions: { removeComments: true } },
  minify: true,
  failOnWarn: true,
  clean: true,
  deps: {
    alwaysBundle: [/^@formalang\//],
    neverBundle: [/^(effect|react|react-dom)(\/|$)/, /^@codemirror\//, /^@lezer\//, /^vscode-/],
  },
  alias: { "@formalang/host/cli": resolve("../host/dist/cli.mjs") },
  plugins: [{
    name: "distribution-version",
    transform(code, id) {
      if (id.endsWith("/packages/ts/dist/package.mjs")) {
        return code.replace(/(?:const|var) version = "[^"]+"/, `var version = ${JSON.stringify(version)}`);
      }
    },
  }],
});

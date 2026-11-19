import { defineConfig } from "tsdown";

// VS Code loads one CommonJS file; bundle the language client into it.
export default defineConfig({
  entry: { extension: "src/extension.ts" },
  format: "cjs",
  platform: "node",
  target: "node20",
  dts: false,
  minify: true,
  clean: true,
  deps: { alwaysBundle: [/^vscode-languageclient/], neverBundle: ["vscode"] },
});

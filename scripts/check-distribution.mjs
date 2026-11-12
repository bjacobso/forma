import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { build } from "tsdown";

const root = new URL("../", import.meta.url);
// tsdown resolves entries against the working directory; package scripts run from packages/forma.
process.chdir(root.pathname);
const manifest = JSON.parse(await readFile(new URL("packages/forma/package.json", root), "utf8"));
assert.equal(manifest.name, "@forma-language/forma");
assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
assert.deepEqual(Object.keys(manifest.exports).sort(), [
  ".", "engine", "reader", "modules", "diagnostic", "formatter",
  "editor-services", "descriptor", "preludes", "mechanics", "http-api", "rpc",
  "type", "email", "elm", "expander", "node", "host", "host/types",
  "editor", "editor/codemirror", "editor/react", "language-server",
].map(key => key === "." ? key : `./${key}`).sort());
const neutral = Object.keys(manifest.exports).filter(key => !["./node", "./language-server", "./editor/react", "./editor/codemirror"].includes(key));
await build({
  config: false, dts: false,
  entry: Object.fromEntries(neutral.map(key => [
    key === "." ? "index" : key.slice(2),
    new URL(`packages/forma/${manifest.exports[key].import}`, root).pathname,
  ])),
  outDir: new URL(".context/distribution-browser", root).pathname,
  platform: "browser", target: "es2022", write: false, logLevel: "silent",
  deps: { alwaysBundle: [/.*/] },
  plugins: [{ name: "browser-boundary", resolveId(id) {
    assert(!/^(node:|react(?:\/|$)|react-dom(?:\/|$)|@codemirror\/|@lezer\/|@modelcontextprotocol\/|vscode-)/.test(id), `runtime-neutral entry imports ${id}`);
    return null;
  } }],
});
for (const key of ["./node", "./language-server"]) {
  assert(manifest.exports[key].node);
  assert(!manifest.exports[key].import);
}
// Resolve the package's own export map under browser conditions, including
// a positive control so a missing package cannot make rejection tests pass.
const browserResolution = fixture => build({
  config: false, dts: false,
  root: new URL("packages/forma/test", root).pathname,
  entry: new URL(`packages/forma/test/browser-${fixture}.ts`, root).pathname,
  platform: "browser", target: "es2022", write: false, logLevel: "silent",
  failOnWarn: true,
  deps: { alwaysBundle: [/.*/] },
});
await browserResolution("root");
for (const entry of ["node", "language-server"]) {
  await assert.rejects(browserResolution(entry), /resolve|export|condition/i);
}
console.log(`Browser bundles: ${neutral.length} runtime-neutral exports passed; Node exports are conditional`);

import { createRequire } from "node:module";
import { createInterface } from "node:readline";

const artifactPath = process.argv[2];
if (!artifactPath) {
  throw new Error("jsoo-bridge requires the path to dist/js/jsoo_entry.cjs");
}

const require = createRequire(import.meta.url);
process.argv = process.argv.slice(0, 2);
const artifact = require(artifactPath) as { formaOcaml?: { handleJson: (request: string) => string } };

const handleJson = artifact.formaOcaml?.handleJson;
if (typeof handleJson !== "function") {
  throw new Error(`Could not locate formaOcaml.handleJson in ${artifactPath}`);
}

process.stdout.write(`${JSON.stringify({ bridge: "ready" })}\n`);

const lines = createInterface({ input: process.stdin });
lines.on("line", (line) => {
  const trimmed = line.trim();
  if (trimmed.length === 0) return;
  const response = handleJson(trimmed);
  process.stdout.write(`${response}\n`);
});

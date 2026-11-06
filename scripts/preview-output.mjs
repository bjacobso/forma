import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export function parsePreviewOutput(text) {
  // Alchemy's state-store refresh prints progress to stdout even at log level
  // "none". Its final JSON object starts at column zero; nested objects do not.
  const start = text.lastIndexOf("\n{");
  const output = JSON.parse(start === -1 ? text : text.slice(start + 1));
  const url = new URL(output.url);
  if (url.protocol !== "https:" || !url.hostname.endsWith(".workers.dev") || url.username || url.password) {
    throw new Error("Expected a workers.dev preview URL in Alchemy stack outputs");
  }
  return { url: url.href };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const text = await readFile(process.argv[2], "utf8");
  process.stdout.write(`${JSON.stringify(parsePreviewOutput(text))}\n`);
}

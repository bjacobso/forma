import { readFileSync, readdirSync } from "node:fs";
import { relative, resolve } from "node:path";

export const packageDir = resolve(import.meta.dirname, "..");
export const repoRoot = resolve(packageDir, "../..");
const sharedFormsPrefix = "examples/shared/@forms/";
export const preludeNames = [
  "kernel.lisp",
  "compiler.lisp",
  "ontology.lisp",
  "viewspec-protocol.lisp",
  "ui.lisp",
  "viewspec.lisp",
];

export const walk = (dir, predicate) => {
  const results = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".turbo") continue;
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walk(path, predicate));
    } else if (predicate(path)) {
      results.push(path);
    }
  }
  return results.sort();
};

export const formNameCounts = (source) => {
  const counts = new Map();
  const formPattern = /\(\s*(entity|relation|seed|link|attribute|query|view|workspace|constraint|process|document|document-locale|document-localized|pdf-mapping|task|api|define-[^\s()]+)/g;
  let match;
  while ((match = formPattern.exec(source)) !== null) {
    counts.set(match[1], (counts.get(match[1]) ?? 0) + 1);
  }
  return counts;
};

const isOntologyManifestBlock = (source) => /^\s*\(ontology(?:\s|[\r\n)])/.test(source);
const isCanonicalExamplePath = (path) => !relative(repoRoot, path).startsWith(sharedFormsPrefix);

export const extractLispBlocks = (path, options = {}) => {
  const content = readFileSync(path, "utf8");
  const fileSourceId = relative(repoRoot, path);
  const blocks = [];
  const fence = /```([^\n`]*)\n([\s\S]*?)```/g;
  let match;
  while ((match = fence.exec(content)) !== null) {
    const language = match[1].trim().toLowerCase();
    if (language === "lisp" || language === "clojure" || language === "clj") {
      blocks.push(match[2]);
    }
  }
  if (blocks.length === 0) return [];

  const sourceBlocks = options.dropOntologyManifest
    ? blocks.filter((block) => !isOntologyManifestBlock(block.trimStart()))
    : blocks;
  if (sourceBlocks.length === 0) return [];

  const source = sourceBlocks.join("\n");
  const result = {
    sourceId: `${fileSourceId}#lisp-blocks`,
    source,
  };
  if (options.includeForms) {
    result.forms = formNameCounts(source);
  }
  return [result];
};

export const readPreludes = (options = {}) =>
  (options.names ?? preludeNames).map((name) => ({
    ...(options.kind ? { kind: options.kind } : {}),
    sourceId: `preludes/${name}`,
    source: readFileSync(resolve(repoRoot, "preludes", name), "utf8"),
  }));

export const readMarkdownLispSource = (path) =>
  extractLispBlocks(path, { dropOntologyManifest: true })[0]?.source ?? "";

export const readExampleSources = (options = {}) =>
  walk(resolve(repoRoot, "examples"), (path) => path.endsWith(".md"))
    .filter((path) => !options.canonicalOnly || isCanonicalExamplePath(path))
    .flatMap((path) => extractLispBlocks(path, options))
    .map((source) => ({
      ...(options.kind ? { kind: options.kind } : {}),
      ...source,
    }));

export const readParseCorpusSources = () => [
  ...walk(resolve(repoRoot, "preludes"), (path) => path.endsWith(".lisp")).map((path) => ({
    sourceId: relative(repoRoot, path),
    source: readFileSync(path, "utf8"),
  })),
  ...readExampleSources(),
];

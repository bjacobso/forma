import { emitExampleModules } from "./corpus-emission.mjs";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { corpusGoldenPath } from "./gates.mjs";

const printActual = process.argv.includes("--print");

const stableJson = (value) => {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

const increment = (counts, key, amount = 1) => {
  counts.set(key, (counts.get(key) ?? 0) + amount);
};

const objectFromCounts = (counts) =>
  Object.fromEntries([...counts.entries()].sort((left, right) => left[0].localeCompare(right[0])));

const declarationKindCounts = (declarations) => {
  const counts = new Map();
  for (const declaration of Array.isArray(declarations) ? declarations : []) {
    const kind = declaration?.kind;
    if (typeof kind === "string") increment(counts, kind);
  }
  return counts;
};

const summaryMetadataPaths = (value, path = "$") => {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => summaryMetadataPaths(item, `${path}[${index}]`));
  }
  if (!value || typeof value !== "object") return [];

  const paths = [];
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (key === "$summary") paths.push(childPath);
    paths.push(...summaryMetadataPaths(child, childPath));
  }
  return paths;
};

const results=await emitExampleModules();
const sources=results.map(result=>({sourceId:result.sourceId}));
{
  const perSource = [];
  const corpusKindCounts = new Map();
  let declarationCount = 0;

  for (const result of results) {
    if (result?.ok !== true) {
      throw new Error(
        `Corpus emit failure for ${result?.sourceId ?? "unknown"}: ${diagnosticsSummary(result)}`,
      );
    }

    const content = result.artifact?.content;
    if (
      content?.irVersion !== "1" ||
      content?.hashAlgorithm !== "md5" ||
      typeof content?.declarationsHash !== "string" ||
      typeof content?.declarationCount !== "number" ||
      !Array.isArray(content?.declarations)
    ) {
      throw new Error(
        `Unexpected canonical IR artifact for ${result.sourceId}:\n${JSON.stringify(result, null, 2)}`,
      );
    }

    const kindCounts = declarationKindCounts(content.declarations);
    for (const [kind, count] of kindCounts) increment(corpusKindCounts, kind, count);

    const leakedSummaryPaths = summaryMetadataPaths(content);
    if (leakedSummaryPaths.length > 0) {
      throw new Error(
        `Canonical IR artifact for ${result.sourceId} leaked declaration summary metadata: ${leakedSummaryPaths.join(", ")}`,
      );
    }

    declarationCount += content.declarationCount;
    perSource.push({
      sourceId: result.sourceId,
      declarationCount: content.declarationCount,
      declarationsHash: content.declarationsHash,
      kindCounts: objectFromCounts(kindCounts),
    });
  }

  perSource.sort((left, right) => left.sourceId.localeCompare(right.sourceId));

  const moduleCounts={};
  for (const source of perSource) {
    const name=source.sourceId.split("/")[1];
    const module=moduleCounts[name] ??= {sourceCount:0,declarationCount:0};
    module.sourceCount++; module.declarationCount+=source.declarationCount;
  }
  const actual = {
    moduleCounts,
    sourceCount: sources.length,
    emittedCount: results.length,
    declarationCount,
    kindCounts: objectFromCounts(corpusKindCounts),
    manifestHash: sha256(stableJson(perSource)),
  };

  if (process.env.FORMA_UPDATE_GOLDEN === "1") {
    writeFileSync(corpusGoldenPath, `${JSON.stringify(actual, null, 2)}\n`);
  }
  const expected = JSON.parse(readFileSync(corpusGoldenPath, "utf8"));
  if (printActual) {
    console.log(JSON.stringify(actual, null, 2));
  } else if (stableJson(actual) !== stableJson(expected)) {
    throw new Error(
      `Corpus golden mismatch.\nExpected:\n${JSON.stringify(expected, null, 2)}\nActual:\n${JSON.stringify(actual, null, 2)}`,
    );
  } else {
    console.log(
      `forma-ocaml corpus golden ok (${actual.sourceCount} sources, ${actual.declarationCount} declarations)`,
    );
  }
}

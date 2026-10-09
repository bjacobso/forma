import { readFileSync } from "node:fs";

export const corpusGoldenPath = new URL("../../../conformance/corpus-emission/expected.json", import.meta.url);
export const corpusGolden = JSON.parse(readFileSync(corpusGoldenPath, "utf8"));

export const architectureThresholds = {
  expectedSourceCount: corpusGolden.moduleCounts.staffing.sourceCount + 1,
  expectedDeclarationCount: corpusGolden.moduleCounts.staffing.declarationCount + 33,
  maxDiagnosticCount: 0,
  maxWasmBrotliBytes: 8 * 1024 * 1024,
  maxJsGzipBytes: 600_000,
  maxWasmGzipBytes: 750_000,
  maxNativeStartupMs: 2_000,
  maxJsStartupMs: 2_000,
  maxWasmStartupMs: 500,
  maxNativeEvalLatencyAvgMs: 50,
  maxJsEvalLatencyAvgMs: 250,
  maxWasmEvalLatencyAvgMs: 250,
  maxCorpusLoadAndSummarizeMs: 15_000,
};

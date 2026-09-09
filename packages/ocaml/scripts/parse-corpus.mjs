import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { packageDir, readParseCorpusSources } from "./corpus.mjs";

const nativeCli = resolve(packageDir, "dist/native/forma_cli.exe");
const readerFixturesDir = resolve(packageDir, "../../conformance/fixtures/reader");

if (!existsSync(nativeCli)) {
  throw new Error(
    "Missing dist/native/forma_cli.exe. Run through Turbo so @formalang/ocaml#build completes first.",
  );
}

const sources = readParseCorpusSources();
const negativeFixtures = readReaderNegativeFixtures();

if (sources.length === 0) {
  throw new Error("No Lisp corpus sources found in preludes/ or examples/.");
}

const daemon = spawn(nativeCli, ["daemon"], {
  cwd: packageDir,
  stdio: ["pipe", "pipe", "pipe"],
});

let stdout = "";
let stderr = "";
daemon.stdout.on("data", (chunk) => {
  stdout += chunk;
});
daemon.stderr.on("data", (chunk) => {
  stderr += chunk;
});

for (const source of sources) {
  daemon.stdin.write(`${JSON.stringify({ op: "parseSummary", ...source })}\n`);
}
for (const fixture of negativeFixtures) {
  daemon.stdin.write(
    `${JSON.stringify({
      op: "parseSummary",
      sourceId: fixture.sourceId,
      source: fixture.source,
    })}\n`,
  );
}
daemon.stdin.end();

const exitCode = await new Promise((resolve) => daemon.on("close", resolve));
if (exitCode !== 0) {
  throw new Error(`Corpus parser daemon exited with ${exitCode}: ${stderr}`);
}

const lines = stdout.trim().split("\n").filter(Boolean);
const expectedResponseCount = sources.length + negativeFixtures.length;
if (lines.length !== expectedResponseCount) {
  throw new Error(`Expected ${expectedResponseCount} parser responses, received ${lines.length}.`);
}

const failures = [];
for (let i = 0; i < lines.length; i += 1) {
  const positiveSource = sources[i];
  const negativeFixture = negativeFixtures[i - sources.length];
  let response;
  try {
    response = JSON.parse(lines[i]);
  } catch (error) {
    failures.push({
      sourceId: positiveSource?.sourceId ?? negativeFixture?.sourceId ?? `response:${i}`,
      response: { ok: false, parseError: String(error), raw: lines[i].slice(0, 500) },
    });
    continue;
  }

  if (positiveSource) {
    if (response.ok !== true) {
      failures.push({ sourceId: positiveSource.sourceId, response });
    }
    continue;
  }

  const diagnosticFailure = validateNegativeFixtureResponse(negativeFixture, response);
  if (diagnosticFailure) {
    failures.push(diagnosticFailure);
  }
}

if (failures.length > 0) {
  console.error(`Corpus parse failures: ${failures.length}/${sources.length}`);
  for (const failure of failures.slice(0, 20)) {
    console.error(`${failure.sourceId}: ${JSON.stringify(failure.response)}`);
  }
  process.exit(1);
}

console.log(
  `forma-ocaml corpus parse ok (${sources.length} source blocks, ${negativeFixtures.length} negative fixtures)`,
);

function readReaderNegativeFixtures() {
  if (!existsSync(readerFixturesDir)) {
    return [];
  }

  return readdirSync(readerFixturesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.endsWith("-error"))
    .map((entry) => readReaderNegativeFixture(entry.name))
    .sort((left, right) => left.sourceId.localeCompare(right.sourceId));
}

function readReaderNegativeFixture(fixtureId) {
  const fixtureDir = join(readerFixturesDir, fixtureId);
  const manifest = JSON.parse(readFileSync(join(fixtureDir, "fixture.json"), "utf8"));
  const source = readReaderFixtureSource(fixtureId, fixtureDir, manifest);
  return {
    fixtureId,
    source,
    sourceId: manifest.sourceId ?? `parity/reader-${fixtureId}`,
    expected: expectedReaderDiagnostic(fixtureId, source),
  };
}

function readReaderFixtureSource(fixtureId, fixtureDir, manifest) {
  if (typeof manifest.source?.inline === "string") {
    return manifest.source.inline;
  }

  const sourceFile = manifest.source?.file;
  if (typeof sourceFile !== "string") {
    throw new Error(
      `Reader negative fixture ${fixtureId} must use a source file or inline source.`,
    );
  }

  return readFileSync(join(fixtureDir, sourceFile), "utf8");
}

function expectedReaderDiagnostic(fixtureId, source) {
  switch (fixtureId) {
    case "map-entry-missing-value-error":
      return { code: "reader/map-entry-missing-value", span: { start: 0, end: 1 } };
    case "quote-missing-form-error":
      return { code: "reader/unexpected-eof", span: { start: 0, end: 1 } };
    case "stray-closing-paren-error":
      return { code: "reader/unexpected-close", span: { start: 0, end: 1 } };
    case "unexpected-eof-error":
      return { code: "reader/unexpected-eof", span: { start: 0, end: source.trimEnd().length } };
    case "unbalanced-brackets-error": {
      const start = source.indexOf("]");
      return { code: "reader/unexpected-close", span: { start, end: start + 1 } };
    }
    case "unclosed-list-error":
    case "unterminated-vector-error":
      return { code: "reader/unclosed-sequence", span: { start: 0, end: 1 } };
    case "unterminated-map-error":
      return { code: "reader/unclosed-map", span: { start: 0, end: 1 } };
    case "unterminated-string-error":
      return { code: "reader/unterminated-string", span: { start: 0, end: source.length } };
    case "bad-string-escape-error":
      return {
        code: "reader/unterminated-string-escape",
        span: { start: 0, end: source.length },
      };
    case "invalid-number-literal-error":
      return { code: "reader/invalid-number", span: { start: 0, end: source.trimEnd().length } };
    case "unexpected-character-error":
      return { code: "reader/unexpected-character", span: { start: 0, end: 1 } };
    default:
      throw new Error(`No expected reader diagnostic registered for ${fixtureId}.`);
  }
}

function validateNegativeFixtureResponse(fixture, response) {
  if (response?.ok !== false) {
    return {
      sourceId: fixture.sourceId,
      response: { expected: fixture.expected, actual: response },
    };
  }

  const diagnostic = response.diagnostics?.[0];
  const actual = {
    code: diagnostic?.code,
    span: {
      start: diagnostic?.span?.startOffset,
      end: diagnostic?.span?.endOffset,
    },
  };

  if (
    actual.code !== fixture.expected.code ||
    actual.span.start !== fixture.expected.span.start ||
    actual.span.end !== fixture.expected.span.end
  ) {
    return {
      sourceId: fixture.sourceId,
      response: { expected: fixture.expected, actual, raw: response },
    };
  }

  return null;
}

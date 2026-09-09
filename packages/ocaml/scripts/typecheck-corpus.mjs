import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { packageDir } from "./corpus.mjs";

const nativeCli = resolve(packageDir, "dist/native/forma_cli.exe");
const typecheckFixturesDir = resolve(packageDir, "../../conformance/fixtures/typecheck");

if (!existsSync(nativeCli)) {
  throw new Error(
    "Missing dist/native/forma_cli.exe. Run through Turbo so @formalang/ocaml#build completes first.",
  );
}

const fixtures = readTypecheckFixtures();

if (fixtures.length === 0) {
  throw new Error("No shared Forma typecheck fixtures found.");
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

for (const fixture of fixtures) {
  daemon.stdin.write(
    `${JSON.stringify({
      op: "typecheck",
      sourceId: fixture.sourceId,
      source: fixture.source,
    })}\n`,
  );
}
daemon.stdin.end();

const exitCode = await new Promise((resolve) => daemon.on("close", resolve));
if (exitCode !== 0) {
  throw new Error(`Typecheck corpus daemon exited with ${exitCode}: ${stderr}`);
}

const lines = stdout.trim().split("\n").filter(Boolean);
if (lines.length !== fixtures.length) {
  throw new Error(`Expected ${fixtures.length} typecheck responses, received ${lines.length}.`);
}

const failures = [];
for (let i = 0; i < lines.length; i += 1) {
  const fixture = fixtures[i];
  let response;
  try {
    response = JSON.parse(lines[i]);
  } catch (error) {
    failures.push({
      fixtureId: fixture.fixtureId,
      sourceId: fixture.sourceId,
      response: { ok: false, parseError: String(error), raw: lines[i].slice(0, 500) },
    });
    continue;
  }

  const failure =
    fixture.expectation.kind === "success"
      ? validateSuccessFixtureResponse(fixture, response)
      : fixture.expectation.kind === "warning"
        ? validateWarningFixtureResponse(fixture, response)
        : validateErrorFixtureResponse(fixture, response);
  if (failure) {
    failures.push(failure);
  }
}

if (failures.length > 0) {
  console.error(`Typecheck corpus failures: ${failures.length}/${fixtures.length}`);
  for (const failure of failures.slice(0, 20)) {
    console.error(`${failure.sourceId}: ${JSON.stringify(failure.response)}`);
  }
  process.exit(1);
}

const successCount = fixtures.filter((fixture) => fixture.expectation.kind === "success").length;
const warningCount = fixtures.filter((fixture) => fixture.expectation.kind === "warning").length;
const errorCount = fixtures.filter((fixture) => fixture.expectation.kind === "error").length;
console.log(
  `forma-ocaml typecheck corpus ok (${successCount} success fixtures, ${warningCount} warning fixtures, ${errorCount} error fixtures)`,
);

function readTypecheckFixtures() {
  if (!existsSync(typecheckFixturesDir)) {
    return [];
  }

  return readdirSync(typecheckFixturesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .filter((entry) =>
      existsSync(join(typecheckFixturesDir, entry.name, "fixture.json")),
    )
    .map((entry) => readTypecheckFixture(entry.name))
    .sort((left, right) => left.sourceId.localeCompare(right.sourceId));
}

function readTypecheckFixture(fixtureId) {
  const fixtureDir = join(typecheckFixturesDir, fixtureId);
  const manifest = JSON.parse(readFileSync(join(fixtureDir, "fixture.json"), "utf8"));
  const sourceFile = manifest.source?.file;
  if (typeof sourceFile !== "string") {
    throw new Error(`Typecheck fixture ${fixtureId} must use a source file.`);
  }

  const mode = manifest.comparison?.mode;
  if (mode !== "type" && mode !== "diagnostics" && mode !== "typeDiagnostics") {
    throw new Error(`Typecheck fixture ${fixtureId} uses unsupported comparison mode ${mode}.`);
  }

  const source = readFileSync(join(fixtureDir, sourceFile), "utf8");
  return {
    fixtureId,
    source,
    sourceId: manifest.sourceId ?? `parity/typecheck-${fixtureId}`,
    expectation: expectedFixtureOutcome(fixtureId, mode, source),
  };
}

function expectedFixtureOutcome(fixtureId, mode, source) {
  if (mode === "type") {
    return { kind: "success", allowDiagnostics: true };
  }

  if (mode === "diagnostics") {
    return {
      kind: "error",
      diagnostic: expectedTypecheckDiagnostic(fixtureId, source),
    };
  }

  if (fixtureId.endsWith("-error")) {
    return {
      kind: "error",
      diagnostic: expectedTypecheckDiagnostic(fixtureId, source),
    };
  }

  if (fixtureId.endsWith("-warning")) {
    return {
      kind: "warning",
      diagnostic: expectedTypecheckDiagnostic(fixtureId, source),
    };
  }

  return { kind: "success", allowDiagnostics: false };
}

function validateSuccessFixtureResponse(fixture, response) {
  const diagnostics = Array.isArray(response?.diagnostics) ? response.diagnostics : [];
  if (
    response?.ok === true &&
    typeof response.type === "string" &&
    response.type.length > 0 &&
    (fixture.expectation.allowDiagnostics || diagnostics.length === 0)
  ) {
    return null;
  }

  return {
    fixtureId: fixture.fixtureId,
    sourceId: fixture.sourceId,
    response: {
      expected: fixture.expectation.allowDiagnostics
        ? { ok: true, type: "non-empty string" }
        : { ok: true, type: "non-empty string", diagnostics: [] },
      actual: response,
    },
  };
}

function validateWarningFixtureResponse(fixture, response) {
  if (response?.ok !== true || typeof response.type !== "string" || response.type.length === 0) {
    return {
      fixtureId: fixture.fixtureId,
      sourceId: fixture.sourceId,
      response: {
        expected: {
          ok: true,
          type: "non-empty string",
          diagnostic: fixture.expectation.diagnostic,
        },
        actual: response,
      },
    };
  }

  const diagnostics = Array.isArray(response.diagnostics) ? response.diagnostics : [];
  if (diagnostics.length !== 1) {
    return {
      fixtureId: fixture.fixtureId,
      sourceId: fixture.sourceId,
      response: {
        expected: { ok: true, diagnosticCount: 1, diagnostic: fixture.expectation.diagnostic },
        actual: response,
      },
    };
  }

  const actual = actualTypecheckDiagnostic(diagnostics[0]);
  if (!matchesExpectedDiagnostic(fixture.expectation.diagnostic, actual)) {
    return {
      fixtureId: fixture.fixtureId,
      sourceId: fixture.sourceId,
      response: { expected: fixture.expectation.diagnostic, actual, raw: response },
    };
  }

  return null;
}

function validateErrorFixtureResponse(fixture, response) {
  if (response?.ok !== false) {
    return {
      fixtureId: fixture.fixtureId,
      sourceId: fixture.sourceId,
      response: { expected: fixture.expectation.diagnostic, actual: response },
    };
  }

  const diagnostic = response.diagnostics?.[0];
  const actual = actualTypecheckDiagnostic(diagnostic);

  if (!matchesExpectedDiagnostic(fixture.expectation.diagnostic, actual)) {
    return {
      fixtureId: fixture.fixtureId,
      sourceId: fixture.sourceId,
      response: { expected: fixture.expectation.diagnostic, actual, raw: response },
    };
  }

  return null;
}

function actualTypecheckDiagnostic(diagnostic) {
  return {
    ...(diagnostic?.code ? { code: diagnostic.code } : {}),
    ...(diagnostic?.severity ? { severity: diagnostic.severity } : {}),
    ...(diagnostic?.message ? { message: diagnostic.message } : {}),
    span: {
      start: diagnostic?.span?.startOffset,
      end: diagnostic?.span?.endOffset,
    },
  };
}

function matchesExpectedDiagnostic(expected, actual) {
  if (!expected || !actual) {
    return false;
  }

  if (expected.code !== undefined && actual.code !== expected.code) {
    return false;
  }

  if (expected.severity !== undefined && actual.severity !== expected.severity) {
    return false;
  }

  if (expected.message !== undefined && actual.message !== expected.message) {
    return false;
  }

  return actual.span.start === expected.span.start && actual.span.end === expected.span.end;
}

function expectedTypecheckDiagnostic(fixtureId, source) {
  const end = source.trimEnd().length;
  switch (fixtureId) {
    case "effect-unknown-handler-warning":
      return {
        severity: "warning",
        message: "Unknown effect: UnknownEffect",
        span: { start: 0, end },
      };
    case "keyword-literal-warning":
      return {
        severity: "warning",
        message:
          "Keyword :foo used as a value. Keywords are self-evaluating literals, not variable references.",
        span: { start: 0, end },
      };
    case "arity-mismatch-curried-error":
    case "arity-mismatch-saturated-error":
    case "count-arity-error":
      return { code: "typecheck/arity", span: { start: 0, end } };
    case "count-type-error":
      return { code: "typecheck/type-mismatch", span: { start: 0, end } };
    case "typeclass-instance-method-type-error": {
      const start = source.indexOf("(instance");
      return { code: "typecheck/type-mismatch", span: { start, end } };
    }
    case "typeclass-missing-instance-error": {
      const start = source.lastIndexOf("(eq");
      return { code: "typecheck/missing-instance", span: { start: start + 1, end: start + 3 } };
    }
    case "typeclass-aliased-missing-instance-error": {
      const start = source.lastIndexOf("(same");
      return { code: "typecheck/missing-instance", span: { start: start + 1, end: start + 5 } };
    }
    case "typeclass-generalized-missing-instance-error": {
      const start = source.lastIndexOf("(equals");
      return {
        code: "typecheck/missing-instance",
        span: { start: start + 1, end: start + 7 },
      };
    }
    case "typeclass-higher-order-missing-instance-error": {
      const start = source.lastIndexOf("(invoke eq") + "(invoke ".length;
      return { code: "typecheck/missing-instance", span: { start, end: start + 2 } };
    }
    case "unknown-typeclass-instance-error":
      return { code: "typecheck/unknown-typeclass", span: { start: 0, end } };
    case "generic-adt-match-type-error": {
      const start = source.indexOf("(match");
      return { code: "typecheck/type-mismatch", span: { start, end } };
    }
    case "heterogeneous-vector-error":
    case "list-expected-error":
    case "map-expected-error":
    case "nth-index-type-error":
    case "type-error":
      return { code: "typecheck/type-mismatch", span: { start: 0, end } };
    case "first-arity-error":
    case "function-overapplication-error":
      return { code: "typecheck/arity", span: { start: 0, end } };
    case "missing-record-field-error":
      return { code: "typecheck/missing-field", span: { start: 0, end } };
    case "if-arity-error":
      return { code: "lower/if", span: { start: 0, end } };
    case "fn-arity-error":
      return { code: "lower/lambda", span: { start: 0, end } };
    case "function-type-arity-error": {
      const start = source.indexOf("(->");
      return {
        code: "lower/type-expression",
        span: { start, end: source.indexOf(")", start) + 1 },
      };
    }
    case "kind-mismatch-error": {
      const start = source.indexOf("(List");
      return {
        code: "typecheck/kind-mismatch",
        span: { start, end: source.indexOf(")", start) + 1 },
      };
    }
    case "match-define-alias-chain-duplicate-constructor-warning":
      return {
        severity: "warning",
        message: "Duplicate match arm for constructor 'Some'",
        span: { start: 88, end: 139 },
      };
    case "match-define-bound-duplicate-constructor-warning":
      return {
        severity: "warning",
        message: "Duplicate match arm for constructor 'Some'",
        span: { start: 66, end: 116 },
      };
    case "match-duplicate-constructor-warning":
      return {
        severity: "warning",
        message: "Duplicate match arm for constructor 'Some'",
        span: { start: 41, end: 95 },
      };
    case "match-let-alias-chain-non-exhaustive-warning":
      return {
        severity: "warning",
        message: "Non-exhaustive match: missing constructor(s) None",
        span: { start: 85, end: 114 },
      };
    case "match-let-bound-non-exhaustive-warning":
      return {
        severity: "warning",
        message: "Non-exhaustive match: missing constructor(s) None",
        span: { start: 66, end: 94 },
      };
    case "match-non-exhaustive-warning":
      return {
        severity: "warning",
        message: "Non-exhaustive match: missing constructor(s) None",
        span: { start: 41, end: 71 },
      };
    case "match-redundant-after-wildcard-warning":
      return {
        severity: "warning",
        message: "Unreachable match arm(s) after wildcard pattern",
        span: { start: 41, end: 88 },
      };
    case "effect-unknown-operation-error":
      return { code: "typecheck/effect", span: { start: 0, end } };
    case "effect-not-handled-error":
      return { code: "typecheck/effect", span: { start: 79, end: 122 } };
    case "effect-row-mismatch-error":
      return { code: "typecheck/effect", span: { start: 90, end: 190 } };
    case "effect-missing-annotation-ascribe-error":
      return { code: "typecheck/effect", span: { start: 54, end } };
    case "effect-missing-annotation-signature-error":
      return { code: "typecheck/effect", span: { start: 79, end: 122 } };
    case "effect-missing-annotation-shorthand-signature-error":
      return { code: "typecheck/effect", span: { start: 79, end: 117 } };
    case "effect-canonical-ascribe-mismatch-error":
      return { code: "typecheck/effect", span: { start: 110, end: 211 } };
    case "effect-canonical-signature-mismatch-error":
      return { code: "typecheck/effect", span: { start: 148, end: 222 } };
    case "effect-canonical-handled-signature-mismatch-error":
      return { code: "typecheck/effect", span: { start: 90, end: 190 } };
    case "let-binding-vector-error":
      return { code: "lower/let", span: { start: 0, end } };
    case "non-callable-error":
      return { code: "typecheck/type-mismatch", span: { start: 0, end } };
    case "occurs-check-error": {
      const start = source.indexOf("(x x)");
      return { code: "typecheck/occurs-check", span: { start, end: start + 5 } };
    }
    case "unbound-symbol-error":
      return { code: "typecheck/unbound-symbol", span: { start: 0, end } };
    default:
      throw new Error(`No expected typecheck diagnostic registered for ${fixtureId}.`);
  }
}

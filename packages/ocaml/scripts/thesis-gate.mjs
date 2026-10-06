import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { packageDir, readPreludes } from "./corpus.mjs";

const nativeCli = resolve(packageDir, "dist/native/forma_cli.exe");
const fixtureDir = resolve(packageDir, "test/fixtures/thesis-gate");
const thesisPrelude = resolve(packageDir, "preludes/thesis-gate.lisp");

const daemon = spawn(nativeCli, ["daemon"], {
  cwd: packageDir,
  stdio: ["pipe", "pipe", "pipe"],
});

const daemonExit = new Promise((resolveExit) => daemon.on("close", resolveExit));

let stderr = "";
daemon.stderr.on("data", (chunk) => {
  stderr += chunk;
});

const responses = [];
const waiters = [];
const lines = createInterface({ input: daemon.stdout });

lines.on("line", (line) => {
  responses.push(line);
  const waiter = waiters.shift();
  if (waiter) waiter();
});

const waitForLine = async () => {
  if (responses.length > 0) return responses.shift();
  return new Promise((resolveLine, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for daemon response. stderr: ${stderr}`));
    }, 5000);
    waiters.push(() => {
      clearTimeout(timeout);
      resolveLine(responses.shift());
    });
  });
};

const request = async (payload) => {
  daemon.stdin.write(`${JSON.stringify(payload)}\n`);
  const line = await waitForLine();
  try {
    return JSON.parse(line);
  } catch (error) {
    throw new Error(`Could not parse daemon response ${JSON.stringify(line)}: ${error}`);
  }
};

const expectOk = (label, response) => {
  if (response?.ok !== true) {
    throw new Error(`${label} failed:\n${JSON.stringify(response, null, 2)}`);
  }
};

const expectResultType = (label, response, type) => {
  if (
    response?.type !== type ||
    response?.typedCore?.resultType !== type ||
    response?.typedCore?.resultTypeExpr?.display !== type
  ) {
    throw new Error(`${label} expected result type ${type}:\n${JSON.stringify(response, null, 2)}`);
  }
};

const expectDescriptorAnnotation = (label, response, formName, type) => {
  const annotation = response?.typedCore?.annotations?.find(
    (annotation) => annotation?.expr?.callee?.name === formName,
  );
  if (annotation?.type !== type || annotation?.typeExpr?.display !== type) {
    throw new Error(
      `${label} expected ${formName} annotation ${type}:\n${JSON.stringify(response, null, 2)}`,
    );
  }
};

const readFixture = (name) => readFileSync(resolve(fixtureDir, name), "utf8");
const readGolden = (name) => JSON.parse(readFileSync(resolve(fixtureDir, "goldens", name), "utf8"));
const typedSource = readFixture("typed.lisp");
const mismatchSource = readFixture("mismatch.lisp");
const expectedEchoSource = readFixture("expected-echo.lisp");
const checkedBoolSource = readFixture("checked-bool.lisp");
const checkedStringSource = readFixture("checked-string.lisp");
const inferredBoolSource = readFixture("inferred-bool.lisp");
const inferredStringSource = readFixture("inferred-string.lisp");
const expandedBoolSource = readFixture("expanded-bool.lisp");
const expandedStringSource = readFixture("expanded-string.lisp");
const repeatedBoolSource = readFixture("repeated-bool.lisp");
const repeatedErrorsSource = readFixture("repeated-errors.lisp");
const repeatedStringSource = readFixture("repeated-string.lisp");
const typedFieldBoolSource = readFixture("typed-field-bool.lisp");
const typedFieldStringSource = readFixture("typed-field-string.lisp");
const nestedFieldBoolSource = readFixture("nested-field-bool.lisp");
const nestedFieldStringSource = readFixture("nested-field-string.lisp");
const queryBoolSource = readFixture("query-bool.lisp");
const queryStringSource = readFixture("query-string.lisp");
const queryScopeBoolSource = readFixture("query-scope-bool.lisp");
const queryScopeGlobalSource = readFixture("query-scope-global.lisp");
const recordBoolSource = readFixture("record-bool.lisp");
const recordStringSource = readFixture("record-string.lisp");

const diagnosticSnapshot = ({ response, source }) => {
  const diagnostic = response?.diagnostics?.[0];
  const span = diagnostic?.span;
  const spannedText =
    typeof span?.startOffset === "number" && typeof span?.endOffset === "number"
      ? source.slice(span.startOffset, span.endOffset)
      : "";
  return { diagnostic, spannedText };
};

const diagnosticsSnapshot = ({ response, source }) =>
  (response?.diagnostics ?? []).map((diagnostic) => {
    const span = diagnostic?.span;
    const spannedText =
      typeof span?.startOffset === "number" && typeof span?.endOffset === "number"
        ? source.slice(span.startOffset, span.endOffset)
        : "";
    return { diagnostic, spannedText };
  });

const expectDiagnosticGolden = ({ label, response, source, goldenName }) => {
  if (response?.ok !== false) {
    throw new Error(`Unexpected ${label} response: ${JSON.stringify(response, null, 2)}`);
  }

  const actual = diagnosticSnapshot({ response, source });
  if (process.env.FORMA_UPDATE_GOLDEN === "1") writeFileSync(resolve(fixtureDir, "goldens", goldenName), `${JSON.stringify(actual, null, 2)}\n`);
  const expected = readGolden(goldenName);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Unexpected ${label} diagnostic golden:\nexpected ${JSON.stringify(
        expected,
        null,
        2,
      )}\nactual ${JSON.stringify(actual, null, 2)}`,
    );
  }
};

const expectDiagnosticsGolden = ({ label, response, source, goldenName }) => {
  if (response?.ok !== false) {
    throw new Error(`Unexpected ${label} response: ${JSON.stringify(response, null, 2)}`);
  }

  const actual = diagnosticsSnapshot({ response, source });
  if (process.env.FORMA_UPDATE_GOLDEN === "1") writeFileSync(resolve(fixtureDir, "goldens", goldenName), `${JSON.stringify(actual, null, 2)}\n`);
  const expected = readGolden(goldenName);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Unexpected ${label} diagnostics golden:\nexpected ${JSON.stringify(
        expected,
        null,
        2,
      )}\nactual ${JSON.stringify(actual, null, 2)}`,
    );
  }
};

const expectMismatch = ({ label, response, source, sourceId, spanText, goldenName }) => {
  const { diagnostic, spannedText } = diagnosticSnapshot({ response, source });

  if (
    response?.ok !== false ||
    diagnostic?.code !== "typecheck/type-mismatch" ||
    diagnostic?.span?.sourceId !== sourceId ||
    typeof diagnostic?.span?.startOffset !== "number" ||
    diagnostic.span.endOffset <= diagnostic.span.startOffset ||
    !diagnostic.message?.includes("String") ||
    !diagnostic.message?.includes("Bool") ||
    /\bStr\b/.test(diagnostic.message) ||
    !spannedText.includes(spanText)
  ) {
    throw new Error(`Unexpected ${label} response: ${JSON.stringify(response, null, 2)}`);
  }

  if (goldenName) {
    expectDiagnosticGolden({ label, response, source, goldenName });
  }
};

let sessionId;
let hardFailure;

try {
  const opened = await request({ op: "openSession" });
  expectOk("openSession", opened);
  sessionId = opened.value.sessionId;

  const loaded = await request({
    op: "loadPrelude",
    sessionId,
    sourceId: "preludes/thesis-gate.lisp",
    source: readFileSync(thesisPrelude, "utf8"),
  });
  expectOk("loadPrelude thesis-gate", loaded);

  const typed = await request({
    op: "typecheckCoreTyped",
    sessionId,
    sourceId: "thesis-gate/typed.lisp",
    source: typedSource,
  });
  expectOk("typecheckCoreTyped typed thesis gate", typed);

  if (typed.type !== "String" || typed.typedCore?.resultType !== "String") {
    throw new Error(`Unexpected typed thesis gate response: ${JSON.stringify(typed, null, 2)}`);
  }

  const mismatch = await request({
    op: "typecheckCoreTyped",
    sessionId,
    sourceId: "thesis-gate/mismatch.lisp",
    source: mismatchSource,
  });

  expectMismatch({
    label: "mismatch thesis gate",
    response: mismatch,
    source: mismatchSource,
    sourceId: "thesis-gate/mismatch.lisp",
    spanText: "literal-type true",
    goldenName: "mismatch.diagnostic.json",
  });

  const expectedEcho = await request({
    op: "typecheckCoreTyped",
    sessionId,
    sourceId: "thesis-gate/expected-echo.lisp",
    source: expectedEchoSource,
  });
  expectOk("typecheckCoreTyped expected echo thesis gate", expectedEcho);
  expectResultType("typecheckCoreTyped expected echo thesis gate", expectedEcho, "Bool");
  expectDescriptorAnnotation(
    "typecheckCoreTyped expected echo thesis gate",
    expectedEcho,
    "expected-echo",
    "Bool",
  );

  const checkedBool = await request({
    op: "typecheckCoreTyped",
    sessionId,
    sourceId: "thesis-gate/checked-bool.lisp",
    source: checkedBoolSource,
  });
  expectOk("typecheckCoreTyped checked bool thesis gate", checkedBool);
  expectResultType("typecheckCoreTyped checked bool thesis gate", checkedBool, "Bool");
  expectDescriptorAnnotation(
    "typecheckCoreTyped checked bool thesis gate",
    checkedBool,
    "checked-bool",
    "Bool",
  );

  const checkedString = await request({
    op: "typecheckCoreTyped",
    sessionId,
    sourceId: "thesis-gate/checked-string.lisp",
    source: checkedStringSource,
  });
  expectMismatch({
    label: "checked string thesis gate",
    response: checkedString,
    source: checkedStringSource,
    sourceId: "thesis-gate/checked-string.lisp",
    spanText: '"not-bool"',
  });

  const inferredBool = await request({
    op: "typecheckCoreTyped",
    sessionId,
    sourceId: "thesis-gate/inferred-bool.lisp",
    source: inferredBoolSource,
  });
  expectOk("typecheckCoreTyped inferred bool thesis gate", inferredBool);
  expectResultType("typecheckCoreTyped inferred bool thesis gate", inferredBool, "Bool");
  expectDescriptorAnnotation(
    "typecheckCoreTyped inferred bool thesis gate",
    inferredBool,
    "inferred-type",
    "Bool",
  );

  const inferredString = await request({
    op: "typecheckCoreTyped",
    sessionId,
    sourceId: "thesis-gate/inferred-string.lisp",
    source: inferredStringSource,
  });
  expectOk("typecheckCoreTyped inferred string thesis gate", inferredString);
  expectResultType("typecheckCoreTyped inferred string thesis gate", inferredString, "String");
  expectDescriptorAnnotation(
    "typecheckCoreTyped inferred string thesis gate",
    inferredString,
    "inferred-type",
    "String",
  );

  const expandedBool = await request({
    op: "typecheckCoreTyped",
    sessionId,
    sourceId: "thesis-gate/expanded-bool.lisp",
    source: expandedBoolSource,
  });
  expectOk("typecheckCoreTyped expanded bool thesis gate", expandedBool);

  const expandedString = await request({
    op: "typecheckCoreTyped",
    sessionId,
    sourceId: "thesis-gate/expanded-string.lisp",
    source: expandedStringSource,
  });
  expectMismatch({
    label: "expanded string thesis gate",
    response: expandedString,
    source: expandedStringSource,
    sourceId: "thesis-gate/expanded-string.lisp",
    spanText: 'bool-wrapper "not-bool"',
    goldenName: "expanded-string.diagnostic.json",
  });

  const repeatedBool = await request({
    op: "typecheckCoreTyped",
    sessionId,
    sourceId: "thesis-gate/repeated-bool.lisp",
    source: repeatedBoolSource,
  });
  expectOk("typecheckCoreTyped repeated bool thesis gate", repeatedBool);

  const repeatedString = await request({
    op: "typecheckCoreTyped",
    sessionId,
    sourceId: "thesis-gate/repeated-string.lisp",
    source: repeatedStringSource,
  });
  expectMismatch({
    label: "repeated string thesis gate",
    response: repeatedString,
    source: repeatedStringSource,
    sourceId: "thesis-gate/repeated-string.lisp",
    spanText: ':item "not-bool"',
    goldenName: "repeated-string.diagnostic.json",
  });

  const repeatedErrors = await request({
    op: "typecheckCoreTyped",
    sessionId,
    sourceId: "thesis-gate/repeated-errors.lisp",
    source: repeatedErrorsSource,
  });
  expectDiagnosticsGolden({
    label: "repeated errors thesis gate",
    response: repeatedErrors,
    source: repeatedErrorsSource,
    goldenName: "repeated-errors.diagnostics.json",
  });

  const typedFieldBool = await request({
    op: "typecheckCoreTyped",
    sessionId,
    sourceId: "thesis-gate/typed-field-bool.lisp",
    source: typedFieldBoolSource,
  });
  expectOk("typecheckCoreTyped typed field bool thesis gate", typedFieldBool);

  const typedFieldString = await request({
    op: "typecheckCoreTyped",
    sessionId,
    sourceId: "thesis-gate/typed-field-string.lisp",
    source: typedFieldStringSource,
  });
  expectMismatch({
    label: "typed field string thesis gate",
    response: typedFieldString,
    source: typedFieldStringSource,
    sourceId: "thesis-gate/typed-field-string.lisp",
    spanText: '"not-bool"',
    goldenName: "typed-field-string.diagnostic.json",
  });

  const nestedFieldBool = await request({
    op: "typecheckCoreTyped",
    sessionId,
    sourceId: "thesis-gate/nested-field-bool.lisp",
    source: nestedFieldBoolSource,
  });
  expectOk("typecheckCoreTyped nested field bool thesis gate", nestedFieldBool);

  const nestedFieldString = await request({
    op: "typecheckCoreTyped",
    sessionId,
    sourceId: "thesis-gate/nested-field-string.lisp",
    source: nestedFieldStringSource,
  });
  expectMismatch({
    label: "nested field string thesis gate",
    response: nestedFieldString,
    source: nestedFieldStringSource,
    sourceId: "thesis-gate/nested-field-string.lisp",
    spanText: '"not-bool"',
    goldenName: "nested-field-string.diagnostic.json",
  });

  for (const prelude of readPreludes({
  })) {
    const response = await request({
      op: "loadPrelude",
      sessionId,
      ...prelude,
    });
    expectOk(`loadPrelude ${prelude.sourceId}`, response);
  }

  const queryBool = await request({
    op: "typecheckCoreTyped",
    sessionId,
    sourceId: "thesis-gate/query-bool.lisp",
    source: queryBoolSource,
  });
  expectOk("typecheckCoreTyped query bool thesis gate", queryBool);
  expectResultType("typecheckCoreTyped query bool thesis gate", queryBool, "List<{:name String}>");
  expectDescriptorAnnotation(
    "typecheckCoreTyped query bool thesis gate",
    queryBool,
    "entity",
    "SchemaDecl",
  );
  expectDescriptorAnnotation(
    "typecheckCoreTyped query bool thesis gate",
    queryBool,
    "query",
    "List<{:name String}>",
  );

  const queryString = await request({
    op: "typecheckCoreTyped",
    sessionId,
    sourceId: "thesis-gate/query-string.lisp",
    source: queryStringSource,
  });
  expectMismatch({
    label: "query string thesis gate",
    response: queryString,
    source: queryStringSource,
    sourceId: "thesis-gate/query-string.lisp",
    spanText: "name",
    goldenName: "query-string.diagnostic.json",
  });

  const queryScopeBool = await request({
    op: "typecheckCoreTyped",
    sessionId,
    sourceId: "thesis-gate/query-scope-bool.lisp",
    source: queryScopeBoolSource,
  });
  expectOk("typecheckCoreTyped query scope bool thesis gate", queryScopeBool);

  const queryScopeGlobal = await request({
    op: "typecheckCoreTyped",
    sessionId,
    sourceId: "thesis-gate/query-scope-global.lisp",
    source: queryScopeGlobalSource,
  });
  expectDiagnosticGolden({
    label: "query scope global thesis gate",
    response: queryScopeGlobal,
    source: queryScopeGlobalSource,
    goldenName: "query-scope-global.diagnostic.json",
  });

  const recordBool = await request({
    op: "typecheckCoreTyped",
    sessionId,
    sourceId: "thesis-gate/record-bool.lisp",
    source: recordBoolSource,
  });
  expectOk("typecheckCoreTyped record bool thesis gate", recordBool);
  expectResultType("typecheckCoreTyped record bool thesis gate", recordBool, "RecordDef");
  expectDescriptorAnnotation(
    "typecheckCoreTyped record bool thesis gate",
    recordBool,
    "entity",
    "SchemaDecl",
  );
  expectDescriptorAnnotation(
    "typecheckCoreTyped record bool thesis gate",
    recordBool,
    "seed",
    "RecordDef",
  );

  const recordString = await request({
    op: "typecheckCoreTyped",
    sessionId,
    sourceId: "thesis-gate/record-string.lisp",
    source: recordStringSource,
  });
  const recordDiagnostic = diagnosticSnapshot({ response: recordString, source: recordStringSource });
  if (recordDiagnostic.diagnostic?.code !== "elaborate/form-check" || !recordDiagnostic.diagnostic.message.includes("Bool") || !recordDiagnostic.spannedText.includes('"yes"')) throw new Error(`Unexpected record validation: ${JSON.stringify(recordString)}`);
  expectDiagnosticGolden({
    label: "record string thesis gate",
    response: recordString,
    source: recordStringSource,
    sourceId: "thesis-gate/record-string.lisp",
    spanText: '"yes"',
    goldenName: "record-string.diagnostic.json",
  });
} catch (error) {
  hardFailure = error;
} finally {
  if (sessionId) {
    try {
      await request({ op: "closeSession", sessionId });
    } catch {
      // The daemon may already be closing after an earlier hard failure.
    }
  }
  daemon.stdin.end();
}

const exitCode = await daemonExit;
if (exitCode !== 0) {
  throw new Error(`Daemon exited with ${exitCode}: ${stderr}`);
}

if (hardFailure) {
  console.error(`forma-ocaml thesis gate failed: ${hardFailure.message}`);
  process.exit(1);
}

console.log("forma-ocaml thesis gate ok");

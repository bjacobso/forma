import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { packageDir, readPreludes } from "./corpus.mjs";

const nativeCli = resolve(packageDir, "dist/native/forma_cli.exe");

if (!existsSync(nativeCli)) {
  throw new Error(
    "Missing dist/native/forma_cli.exe. Run through Turbo so @formalang/ocaml#build completes first.",
  );
}

const daemon = spawn(nativeCli, ["daemon"], {
  cwd: packageDir,
  stdio: ["pipe", "pipe", "pipe"],
});

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
    }, 10000);
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

const expectNoErrorDiagnostics = (label, response) => {
  const diagnostics = Array.isArray(response?.diagnostics) ? response.diagnostics : [];
  const errors = diagnostics.filter((diagnostic) => diagnostic?.severity === "error");
  if (errors.length > 0) {
    throw new Error(`${label} returned error diagnostics:\n${JSON.stringify(errors, null, 2)}`);
  }
};

const findDeclaration = (declarations, kind, name) => {
  const declaration = declarations.find(
    (candidate) => candidate?.kind === kind && candidate?.name === name,
  );
  if (!declaration) {
    throw new Error(`Missing ${kind} declaration ${name}`);
  }
  return declaration;
};

const findTypeSummary = (summaries, kind, name) => {
  const summary = summaries.find(
    (candidate) => candidate?.kind === kind && candidate?.name === name,
  );
  if (!summary) {
    throw new Error(`Missing ${kind} type summary ${name}`);
  }
  return summary;
};

const fieldSchema = (schema, fieldName) =>
  schema?.fields?.find((field) => field?.name === fieldName)?.schema;

const effectContractSourceId = "golden-vertical/effect-contract";
const effectFixtureDir = resolve(packageDir, "../../conformance/operational-effects");
const effectContractSource = readFileSync(resolve(effectFixtureDir, "program.lisp"), "utf8");
const effectGolden = JSON.parse(
  readFileSync(resolve(effectFixtureDir, "expected.json"), "utf8"),
);

const sourceId = "golden-vertical/agent-tool-slice";
const source = `
(define-schema FindEmployeeInput
  (:kind struct)
  (:fields
    (field id String)
    (field includeInactive Bool)))

(define-error EmployeeNotFound
  (:fields (field id String))
  (:status 404))

(define-api-group employee-tools
  (:path-params)
  (endpoint find-employee
    (:method POST)
    (:path "/agent-tools/find-employee")
    (:payload FindEmployeeInput)
    (:success FindEmployeeInput)
    (:errors EmployeeNotFound InternalError)))

(define-action find-employee
  (:input [id String])
  (:returns Bool)
  (:do (= id "employee:ada")))
`;

let sessionId;
let hardFailure;

try {
  const effectTypecheck = await request({
    op: "typecheck",
    sourceId: effectContractSourceId,
    source: effectContractSource,
  });
  expectOk("effect contract typecheck", effectTypecheck);
  expectNoErrorDiagnostics("effect contract typecheck", effectTypecheck);
  if (
    effectTypecheck.type !== effectGolden.types.ocaml
  ) {
    throw new Error(
      `Unexpected effect contract type ${JSON.stringify(effectTypecheck.type)}:\n${JSON.stringify(
        effectTypecheck,
        null,
        2,
      )}`,
    );
  }

  const opened = await request({ op: "openSession" });
  expectOk("openSession", opened);
  sessionId = opened.value.sessionId;

  const effectLoaded = await request({
    op: "loadSource",
    sessionId,
    sourceId: effectContractSourceId,
    source: effectContractSource,
  });
  expectOk("loadSource effect contract", effectLoaded);

  const effectEmitted = await request({
    op: "emit",
    sessionId,
    backend: "canonical-ir",
    sourceId: effectContractSourceId,
  });
  expectOk("emit effect contract", effectEmitted);
  const effectDeclarations = effectEmitted.value?.artifacts?.[0]?.content?.declarations;
  const service = effectDeclarations?.find(
    (declaration) => declaration?.kind === "ServiceDef" && declaration?.name === "Console",
  );
  const failed = effectDeclarations?.find(
    (declaration) => declaration?.kind === "EffectDef" && declaration?.name === "always-fail",
  );
  const recovered = effectDeclarations?.find(
    (declaration) => declaration?.kind === "EffectDef" && declaration?.name === "recover",
  );
  const logged = effectDeclarations?.find(
    (declaration) => declaration?.kind === "EffectDef" && declaration?.name === "log",
  );
  if (
    service?.methods?.[0]?.effect?.requirements?.join(",") !== effectGolden.serviceCapability ||
    failed?.body?.kind !== "Fail" ||
    failed?.body?.error?.kind !== "Error" ||
    failed?.body?.error?.errorType !== effectGolden.failedErrorType ||
    recovered?.body?.kind !== "Catch" ||
    recovered?.body?.errorType !== effectGolden.caughtErrorType ||
    logged?.authority?.capabilities?.join(",") !== effectGolden.authorityCapabilities.join(",")
  ) {
    throw new Error(
      `Unexpected operational effect IR:\n${JSON.stringify(effectEmitted, null, 2)}`,
    );
  }

  for (const prelude of readPreludes()) {
    const response = await request({
      op: "loadPrelude",
      sessionId,
      ...prelude,
    });
    expectOk(`loadPrelude ${prelude.sourceId}`, response);
  }

  const loaded = await request({ op: "loadSource", sessionId, sourceId, source });
  expectOk("loadSource golden vertical", loaded);
  if (loaded.value?.formCount !== 4) {
    throw new Error(`Expected four forms, got:\n${JSON.stringify(loaded, null, 2)}`);
  }

  const typechecked = await request({ op: "typecheck", sessionId, sourceId });
  expectOk("typecheck golden vertical", typechecked);
  expectNoErrorDiagnostics("typecheck golden vertical", typechecked);
  if (typechecked.type !== "Declaration") {
    throw new Error(`Expected Declaration type, got:\n${JSON.stringify(typechecked, null, 2)}`);
  }

  const emitted = await request({
    op: "emit",
    sessionId,
    backend: "canonical-ir",
    sourceId,
  });
  expectOk("emit golden vertical", emitted);

  const value = emitted.value;
  const artifact = value?.artifacts?.[0];
  const content = artifact?.content;
  if (
    value?.backend !== "canonical-ir" ||
    value?.artifactCount !== 1 ||
    artifact?.name !== "ir.json" ||
    artifact?.mediaType !== "application/vnd.forma.ir+json" ||
    content?.kind !== "CanonicalIr" ||
    content?.irVersion !== "1" ||
    content?.sourceIds?.join(",") !== sourceId ||
    content?.declarationCount !== 4 ||
    content?.typeSummary?.declarationCount !== 4 ||
    content?.typeSummary?.resultTypes?.SchemaDecl !== 2 ||
    content?.typeSummary?.resultTypes?.HttpApiDecl !== 1 ||
    content?.typeSummary?.resultTypes?.ActionDef !== 1 ||
    !Array.isArray(content?.declarations) ||
    content.declarations.length !== 4 ||
    !Array.isArray(content?.declarationTypeSummaries) ||
    content.declarationTypeSummaries.length !== 4 ||
    !Array.isArray(content?.derivedArtifacts) ||
    content.derivedArtifacts[0]?.kind !== "DerivedManifest"
  ) {
    throw new Error(`Unexpected golden vertical IR envelope:\n${JSON.stringify(emitted, null, 2)}`);
  }

  const inputSchema = findDeclaration(content.declarations, "Schema", "FindEmployeeInput");
  if (
    inputSchema.schema?.kind !== "Struct" ||
    fieldSchema(inputSchema.schema, "id")?.prim !== "String" ||
    fieldSchema(inputSchema.schema, "includeInactive")?.prim !== "Bool"
  ) {
    throw new Error(`Unexpected input schema IR:\n${JSON.stringify(inputSchema, null, 2)}`);
  }

  const notFound = findDeclaration(content.declarations, "Schema", "EmployeeNotFound");
  if (
    notFound.schemaKind !== "Error" ||
    notFound.schema?.kind !== "Annotated" ||
    notFound.schema.annotations?.status !== 404 ||
    notFound.schema.schema?.brand !== "EmployeeNotFound"
  ) {
    throw new Error(`Unexpected error schema IR:\n${JSON.stringify(notFound, null, 2)}`);
  }

  const api = findDeclaration(content.declarations, "HttpApi", "employee-tools");
  const endpoint = api.groups?.[0]?.endpoints?.[0];
  if (
    endpoint?.name !== "find-employee" ||
    endpoint?.method !== "POST" ||
    endpoint?.path !== "/agent-tools/find-employee" ||
    endpoint?.payload?.target !== "FindEmployeeInput" ||
    endpoint?.success?.target !== "FindEmployeeInput" ||
    endpoint?.errors?.map((error) => error.target).join(",") !== "EmployeeNotFound,InternalError"
  ) {
    throw new Error(`Unexpected HTTP/tool endpoint IR:\n${JSON.stringify(api, null, 2)}`);
  }

  const action = findDeclaration(content.declarations, "Action", "find-employee");
  if (
    action.inputs?.[0]?.name !== "id" ||
    action.inputs?.[0]?.type !== "String" ||
    action.do?.join(" ") !== "= id employee:ada"
  ) {
    throw new Error(`Unexpected action logic IR payload:\n${JSON.stringify(action, null, 2)}`);
  }

  if (
    findTypeSummary(content.declarationTypeSummaries, "Schema", "FindEmployeeInput").resultType !==
      "SchemaDecl" ||
    findTypeSummary(content.declarationTypeSummaries, "HttpApi", "employee-tools").resultType !==
      "HttpApiDecl" ||
    findTypeSummary(content.declarationTypeSummaries, "Action", "find-employee").resultType !==
      "ActionDef"
  ) {
    throw new Error(
      `Unexpected declaration type summaries:\n${JSON.stringify(
        content.declarationTypeSummaries,
        null,
        2,
      )}`,
    );
  }
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

const exitCode = await new Promise((resolveExit) => daemon.on("close", resolveExit));
if (exitCode !== 0) {
  throw new Error(`Daemon exited with ${exitCode}: ${stderr}`);
}

if (hardFailure) {
  console.error(`forma-ocaml golden vertical failed: ${hardFailure.message}`);
  process.exit(1);
}

console.log("forma-ocaml golden vertical ok (effect typecheck + schema/api/action IR emission)");

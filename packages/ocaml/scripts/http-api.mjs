import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { packageDir, readPreludes } from "./corpus.mjs";
import { requireNativeCli } from "./require-build.mjs";

const nativeCli = requireNativeCli();

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

const findDeclaration = (declarations, kind, name) => {
  const declaration = declarations.find(
    (candidate) => candidate?.kind === kind && candidate?.name === name,
  );
  if (!declaration) {
    throw new Error(`Missing ${kind} declaration ${name}`);
  }
  return declaration;
};

const findField = (fields, name) => {
  const field = fields.find((candidate) => candidate?.name === name);
  if (!field) {
    throw new Error(`Missing field ${name}`);
  }
  return field;
};

const validSourceId = "http-api/basic";
const validSource = `
(type BlobHash (Brand String))
(type BlobUploadResponse {:hash BlobHash :size Int :filename (Option String) :content-type String :created-at DateTime :derived-from (Option BlobHash)})
(error DatabaseNotFound {:database String} :status 404)
(error BlobUploadError {:reason String} :status 400)
(error InternalError :status 500)
(api blobs :path-params {:database String :hash BlobHash}
  (endpoint upload :method :post :path "/db/{database}/blobs"
    :payload Bytes :query {:filename (Option String) :derived-from (Option String)}
    :success BlobUploadResponse :errors [DatabaseNotFound BlobUploadError InternalError])
  (endpoint metadata :method :get :path "/db/{database}/blobs/{hash}/metadata"
    :success BlobUploadResponse :errors [DatabaseNotFound InternalError]))
`;

const invalidSourceId = "http-api/invalid-path";
const invalidSource = `
(api broken :path-params {:database String}
  (endpoint metadata :method :get :path "/db/{database}/blobs/{hash}/metadata"
    :success BlobUploadResponse :errors [InternalError]))
`;

const unknownSchemaSourceId = "http-api/unknown-schema";
const unknownSchemaSource = `
(api broken (endpoint list :method :get :path "/broken" :success MissingResponse :errors [InternalError]))
`;

const undeclaredErrorSourceId = "http-api/undeclared-error";
const undeclaredErrorSource = `
(type PlainProblem {})
(api broken (endpoint list :method :get :path "/broken" :success BlobUploadResponse :errors [PlainProblem]))
`;

let sessionId;
let hardFailure;

try {
  const opened = await request({ op: "openSession" });
  expectOk("openSession", opened);
  sessionId = opened.value.sessionId;

  for (const prelude of readPreludes()) {
    const response = await request({
      op: "loadPrelude",
      sessionId,
      ...prelude,
    });
    expectOk(`loadPrelude ${prelude.sourceId}`, response);
  }

  expectOk(
    `loadSource ${validSourceId}`,
    await request({ op: "loadSource", sessionId, sourceId: validSourceId, source: validSource }),
  );

  const emitted = await request({
    op: "emit",
    sessionId,
    backend: "canonical-ir",
    sourceId: validSourceId,
  });
  expectOk("emit valid HTTP API", emitted);

  const content = emitted.value?.artifacts?.[0]?.content;
  if (content?.kind !== "CanonicalIr" || content.declarationCount !== 6 ||
      content.typeSummary?.resultTypes?.SchemaDef !== 2 || content.typeSummary?.resultTypes?.ErrorDef !== 3 ||
      content.typeSummary?.resultTypes?.HttpApiDecl !== 1 || content.declarations.some(d => "$summary" in d) ||
      content.declarationTypeSummaries.some(d => !d.resultType)) {
    throw new Error(`Unexpected HTTP API IR envelope:\n${JSON.stringify(emitted, null, 2)}`);
  }
  const blobHash = findDeclaration(content.declarations, "SchemaDef", "BlobHash");
  if (blobHash.schema?.kind !== "Brand" || blobHash.schema.schema?.name !== "String") {
    throw new Error(`Unexpected BlobHash schema: ${JSON.stringify(blobHash)}`);
  }
  const uploadResponse = findDeclaration(content.declarations, "SchemaDef", "BlobUploadResponse");
  if (uploadResponse.schema?.fields?.length !== 6 || findField(uploadResponse.schema.fields, "filename").schema?.kind !== "Optional") {
    throw new Error(`Unexpected response fields: ${JSON.stringify(uploadResponse)}`);
  }
  const notFound = findDeclaration(content.declarations, "ErrorDef", "DatabaseNotFound");
  if (notFound.status !== 404 || findField(notFound.schema.fields, "database").schema.name !== "String") {
    throw new Error(`Unexpected error schema: ${JSON.stringify(notFound)}`);
  }
  const httpApi = findDeclaration(content.declarations, "HttpApi", "blobs");
  const upload = httpApi.endpoints?.find(endpoint => endpoint.name === "upload");
  const metadata = httpApi.endpoints?.find(endpoint => endpoint.name === "metadata");
  if (Object.keys(httpApi.pathParams).length !== 2 || httpApi.pathParams.hash !== "BlobHash" ||
      upload?.method !== "POST" || upload?.payload !== "Bytes" || Object.keys(upload?.query ?? {}).length !== 2 ||
      upload?.success !== "BlobUploadResponse" || upload?.errors?.length !== 3 ||
      metadata?.path !== "/db/{database}/blobs/{hash}/metadata") {
    throw new Error(`Unexpected HttpApi IR: ${JSON.stringify(httpApi)}`);
  }

  expectOk(
    `loadSource ${invalidSourceId}`,
    await request({
      op: "loadSource",
      sessionId,
      sourceId: invalidSourceId,
      source: invalidSource,
    }),
  );

  const invalid = await request({
    op: "emit",
    sessionId,
    backend: "canonical-ir",
    sourceId: invalidSourceId,
  });

  if (
    invalid?.ok !== false ||
    invalid.diagnostics?.[0]?.code !== "http/undeclared-path-param" ||
    !invalid.diagnostics[0]?.message?.includes("hash")
  ) {
    throw new Error(
      `Expected undeclared path-param diagnostic:\n${JSON.stringify(invalid, null, 2)}`,
    );
  }

  expectOk(
    `loadSource ${unknownSchemaSourceId}`,
    await request({
      op: "loadSource",
      sessionId,
      sourceId: unknownSchemaSourceId,
      source: unknownSchemaSource,
    }),
  );

  const unknownSchema = await request({
    op: "emit",
    sessionId,
    backend: "canonical-ir",
    sourceId: unknownSchemaSourceId,
  });

  if (
    unknownSchema?.ok !== false ||
    unknownSchema.diagnostics?.[0]?.code !== "http/unknown-schema-ref" ||
    !unknownSchema.diagnostics[0]?.message?.includes("MissingResponse")
  ) {
    throw new Error(
      `Expected unknown schema diagnostic:\n${JSON.stringify(unknownSchema, null, 2)}`,
    );
  }

  expectOk(
    `loadSource ${undeclaredErrorSourceId}`,
    await request({
      op: "loadSource",
      sessionId,
      sourceId: undeclaredErrorSourceId,
      source: undeclaredErrorSource,
    }),
  );

  const undeclaredError = await request({
    op: "emit",
    sessionId,
    backend: "canonical-ir",
    sourceId: undeclaredErrorSourceId,
  });

  if (
    undeclaredError?.ok !== false ||
    undeclaredError.diagnostics?.[0]?.code !== "http/undeclared-error" ||
    !undeclaredError.diagnostics[0]?.message?.includes("PlainProblem")
  ) {
    throw new Error(
      `Expected undeclared endpoint error diagnostic:\n${JSON.stringify(undeclaredError, null, 2)}`,
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

const exitCode = await daemonExit;
if (exitCode !== 0) {
  throw new Error(`Daemon exited with ${exitCode}: ${stderr}`);
}

if (hardFailure) {
  console.error(`forma-ocaml HTTP API check failed: ${hardFailure.message}`);
  process.exit(1);
}

console.log("forma-ocaml http-api ok (schemas, errors, endpoints, path/ref diagnostics)");

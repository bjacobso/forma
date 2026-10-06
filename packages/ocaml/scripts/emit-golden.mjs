import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { packageDir, readMarkdownLispSource, readPreludes, readExampleSources, repoRoot } from "./corpus.mjs";
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
    }, 30000);
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

const entryValue = (mapValue, keyValue) => {
  const property = keyValue.startsWith(":") ? keyValue.slice(1) : keyValue;
  if (mapValue && Object.hasOwn(mapValue, property)) {
    return mapValue[property];
  }
  const entry = mapValue?.entries?.find((candidate) => candidate.key?.value === keyValue);
  return entry?.value;
};

const textValue = (value) => (typeof value === "string" ? value : value?.value);

const rawOf = (declaration) => declaration?.raw ?? declaration;

const kindOf = (declaration) =>
  declaration?.kind ?? textValue(entryValue(rawOf(declaration), ":kind"));

const nameOf = (declaration) =>
  declaration?.name ??
  declaration?.id ??
  textValue(entryValue(rawOf(declaration), ":name")) ??
  textValue(entryValue(rawOf(declaration), ":id")) ??
  textValue(entryValue(rawOf(declaration), ":documentName"));

const itemsOf = (value) =>
  Array.isArray(value)
    ? value
    : value?.kind === "list" || value?.kind === "vector"
      ? (value.items ?? [])
      : [];

const declarationKindCounts = (declarations) => {
  const counts = new Map();
  for (const declaration of declarations) {
    const kind = kindOf(declaration);
    if (kind) counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  return counts;
};

const expectKindCounts = (label, declarations, expected) => {
  const counts = declarationKindCounts(declarations);
  for (const [kind, count] of Object.entries(expected)) {
    if (counts.get(kind) !== count) {
      throw new Error(`${label}: expected ${kind}:${count}, got ${kind}:${counts.get(kind) ?? 0}`);
    }
  }
};

const findDeclaration = (declarations, kind, name) => {
  const declaration = declarations.find(
    (candidate) => kindOf(candidate) === kind && nameOf(candidate) === name,
  );
  if (!declaration) {
    throw new Error(`Missing ${kind} declaration ${name}`);
  }
  return declaration;
};

const findField = (fields, name) => {
  const field = itemsOf(fields).find(
    (candidate) => candidate?.name === name || textValue(entryValue(candidate, ":name")) === name,
  );
  if (!field) {
    throw new Error(`Missing field ${name}`);
  }
  return field;
};

const expectCanonicalIr = (label, response, sourceIds, declarationCount) => {
  expectOk(label, response);
  const value = response.value;
  const artifact = value?.artifacts?.[0];
  const content = artifact?.content;
  if (
    value?.backend !== "canonical-ir" ||
    value?.artifactCount !== 1 ||
    artifact?.name !== "ir.json" ||
    artifact?.mediaType !== "application/vnd.forma.ir+json" ||
    content?.irVersion !== "1" ||
    content?.kind !== "CanonicalIr" ||
    content?.engine?.name !== "forma-ocaml" ||
    content?.hashAlgorithm !== "md5" ||
    content?.sourceIds?.join(",") !== sourceIds.join(",") ||
    sourceIds.some((sourceId) => typeof content?.sourceHashes?.[sourceId] !== "string") ||
    !content?.preludeIds?.includes("preludes/ontology.lisp") ||
    typeof content?.preludeHashes?.["preludes/ontology.lisp"] !== "string" ||
    content?.declarationCount !== declarationCount ||
    typeof content?.declarationsHash !== "string" ||
    !Array.isArray(content?.declarationProvenance) ||
    content.declarationProvenance.length !== declarationCount ||
    content.declarationProvenance.some(
      (item, index) =>
        item?.declarationIndex !== index ||
        !sourceIds.includes(item?.sourceId) ||
        typeof item?.formIndex !== "number" ||
        typeof item?.span?.startOffset !== "number" ||
        typeof item?.span?.endOffset !== "number" ||
        typeof item?.span?.startLine !== "number" ||
        typeof item?.span?.startColumn !== "number" ||
        typeof item?.span?.endLine !== "number" ||
        typeof item?.span?.endColumn !== "number" ||
        item.span.endOffset <= item.span.startOffset,
    ) ||
    !Array.isArray(content?.declarations) ||
    content.declarations.length !== declarationCount
  ) {
    throw new Error(
      `${label}: unexpected canonical IR envelope:\n${JSON.stringify(response, null, 2)}`,
    );
  }
  return content;
};

const preludes = readPreludes();

const exampleSources = [
  "examples/company/README.md",
].map((sourceId) => ({
  sourceId,
  source: readMarkdownLispSource(resolve(repoRoot, sourceId)),
}));

let sessionId;
let hardFailure;

try {
  const opened = await request({ op: "openSession" });
  expectOk("openSession", opened);
  sessionId = opened.value.sessionId;

  for (const prelude of preludes) {
    const response = await request({
      op: "loadPrelude",
      sessionId,
      ...prelude,
    });
    expectOk(`loadPrelude ${prelude.sourceId}`, response);
  }

  for (const source of exampleSources) {
    expectOk(
      `loadSource ${source.sourceId}`,
      await request({
        op: "loadSource",
        sessionId,
        ...source,
      }),
    );
  }

  const company = expectCanonicalIr(
    "emit company ontology",
    await request({
      op: "emit",
      sessionId,
      backend: "canonical-ir",
      sourceId: "examples/company/README.md",
    }),
    ["examples/company/README.md"],
    7,
  );
  expectKindCounts("company ontology", company.declarations, {
    Entity: 2,
    Record: 4,
    Query: 1,
  });

  const employee = findDeclaration(company.declarations, "Entity", "Employee");
  const employeeFields = employee.fields;
  if (itemsOf(employeeFields).length !== 3) {
    throw new Error(`Employee should have three fields:\n${JSON.stringify(employee, null, 2)}`);
  }
  const departmentField = findField(employeeFields, "employee/department");
  const departmentFieldType = departmentField.type ?? entryValue(departmentField, ":type");
  if (
    !Array.isArray(departmentFieldType) ||
    departmentFieldType[0] !== "Id" ||
    departmentFieldType[1] !== "Department"
  ) {
    throw new Error(
      `Employee department field should preserve Id type:\n${JSON.stringify(departmentField, null, 2)}`,
    );
  }

  const employeeDirectory = findDeclaration(company.declarations, "Query", "employee-directory");
  if (employeeDirectory.from !== "Employee" || itemsOf(employeeDirectory.select).length !== 3) {
    throw new Error(
      `Unexpected employee-directory query:\n${JSON.stringify(employeeDirectory, null, 2)}`,
    );
  }

  const staffingSources=readExampleSources({canonicalOnly:true,dropOntologyManifest:true})
    .filter(source=>source.sourceId.startsWith("examples/staffing/"))
    .map(source=>({kind:"source",...source,sourceId:source.sourceId.replace("#lisp-blocks","")}));
  const staffingLoaded=await request({op:"loadSourceBundle",sessionId,sources:[
    {kind:"source",sourceId:"system",source:readFileSync(resolve(repoRoot,"preludes/system.lisp"),"utf8")},...staffingSources]});
  expectOk("staffing dependencies",staffingLoaded);
  if (staffingLoaded.value.results.some(result=>!result.ok)) throw new Error(JSON.stringify(staffingLoaded));
  const documents = expectCanonicalIr(
    "emit staffing documents",
    await request({
      op: "emit",
      sessionId,
      backend: "canonical-ir",
      sourceId: "examples/staffing/documents.md",
    }),
    ["examples/staffing/documents.md"],
    22,
  );
  expectKindCounts("staffing documents", documents.declarations, {
    Document: 7,
    DocumentLocale: 8,
    DocumentLocalized: 7,
  });

  const i9Document = findDeclaration(
    documents.declarations,
    "Document",
    "i-9-employment-eligibility",
  );
  const i9Pages = i9Document.pages;
  const firstI9Page = itemsOf(i9Pages)[0];
  if (
    itemsOf(i9Pages).length < 2 ||
    textValue(entryValue(firstI9Page, ":sectionId")) !== "employee-information" ||
    itemsOf(entryValue(firstI9Page, ":fields")).length < 10
  ) {
    throw new Error(
      `Unexpected I-9 document page structure:\n${JSON.stringify(i9Document, null, 2)}`,
    );
  }

  const i9Locale = findDeclaration(
    documents.declarations,
    "DocumentLocale",
    "i-9-employment-eligibility",
  );
  if (i9Locale.locale !== "en" || itemsOf(i9Locale.fields).length < 10) {
    throw new Error(`Unexpected I-9 locale structure:\n${JSON.stringify(i9Locale, null, 2)}`);
  }

  const views = expectCanonicalIr(
    "emit staffing views",
    await request({
      op: "emit",
      sessionId,
      backend: "canonical-ir",
      sourceId: "examples/staffing/views.md",
    }),
    ["examples/staffing/views.md"],
    19,
  );
  expectKindCounts("staffing views", views.declarations, {
    View: 19,
  });

  const onboardingWorkersView = findDeclaration(
    views.declarations,
    "View",
    "onboarding-workers-view",
  );
  if (
    onboardingWorkersView.query !== "onboarding-employees" ||
    onboardingWorkersView.mode !== "table" ||
    itemsOf(onboardingWorkersView.columns).length !== 3
  ) {
    throw new Error(
      `Unexpected onboarding-workers-view shape:\n${JSON.stringify(onboardingWorkersView, null, 2)}`,
    );
  }

  const dashboard = findDeclaration(views.declarations, "View", "onboarding-dashboard");
  const root = dashboard.root;
  const dashboardRaw = rawOf(dashboard);
  if (
    dashboard.title !== "Onboarding Dashboard" ||
    root?.type !== "rows" ||
    !Array.isArray(root?.children) ||
    typeof entryValue(dashboardRaw, ":queries") !== "object" ||
    typeof entryValue(dashboardRaw, ":state") !== "object"
  ) {
    throw new Error(
      `Unexpected onboarding-dashboard ViewSpec shape:\n${JSON.stringify(dashboard, null, 2)}`,
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
  console.error(`forma-ocaml emit golden check failed: ${hardFailure.message}`);
  process.exit(1);
}

console.log("forma-ocaml emit golden ok (3 sources)");

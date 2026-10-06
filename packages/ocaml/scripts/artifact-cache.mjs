import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { packageDir, readPreludes, repoRoot } from "./corpus.mjs";
import { requireNativeCli } from "./require-build.mjs";

const nativeCli = requireNativeCli();
const fixtureDir = resolve(repoRoot, "conformance/fixtures/canonical-ir");
const sourceIds = [
  "emit/canonical-schema",
  "emit/canonical-data",
  "emit/canonical-referral",
  "emit/standalone",
];
const moduleSourceIds = ["cache/people.md", "cache/hiring.md"];

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
  return JSON.parse(await waitForLine());
};

const expectOk = (label, response) => {
  if (response?.ok !== true) {
    throw new Error(`${label} failed:\n${JSON.stringify(response, null, 2)}`);
  }
  return response.value;
};

const cacheHitForSource = (summary, sourceId) => {
  const entry = summary.sourceCache?.find((candidate) => candidate.sourceId === sourceId);
  if (!entry) {
    throw new Error(
      `Missing sourceCache entry for ${sourceId}:\n${JSON.stringify(summary, null, 2)}`,
    );
  }
  return entry.cacheHit;
};

try {
  const opened = expectOk("openSession", await request({ op: "openSession" }));
  const sessionId = opened.sessionId;

  const sources = [
    ...readPreludes({
      kind: "prelude",
    }),
    {
      kind: "source",
      sourceId: sourceIds[0],
      source: readFileSync(resolve(fixtureDir, "schema.lisp"), "utf8"),
    },
    {
      kind: "source",
      sourceId: sourceIds[1],
      source: readFileSync(resolve(fixtureDir, "data.lisp"), "utf8"),
    },
    {
      kind: "source",
      sourceId: sourceIds[2],
      source: [
        '(seed Employee "employee:grace" {:name "Grace Hopper" :department "department:platform" :active true})',
      ].join("\n"),
    },
    {
      kind: "source",
      sourceId: sourceIds[3],
      source: "(+ 1 2)",
    },
  ];

  expectOk("loadSourceBundle", await request({ op: "loadSourceBundle", sessionId, sources }));

  const cold = expectOk(
    "cold artifactSummary",
    await request({ op: "artifactSummary", sessionId, sourceIds }),
  );
  const warm = expectOk(
    "warm artifactSummary",
    await request({ op: "artifactSummary", sessionId, sourceIds }),
  );

  expectOk(
    "reload data source",
    await request({
      op: "loadSource",
      sessionId,
      sourceId: sourceIds[1],
      source: readFileSync(resolve(fixtureDir, "data.lisp"), "utf8").replace(
        "Ada Lovelace",
        "Ada Byron",
      ),
    }),
  );

  const edited = expectOk(
    "edited artifactSummary",
    await request({ op: "artifactSummary", sessionId, sourceIds }),
  );
  const editedWarm = expectOk(
    "edited warm artifactSummary",
    await request({ op: "artifactSummary", sessionId, sourceIds }),
  );

  expectOk(
    "reload schema source",
    await request({
      op: "loadSource",
      sessionId,
      sourceId: sourceIds[0],
      source: `${readFileSync(resolve(fixtureDir, "schema.lisp"), "utf8")}\n`,
    }),
  );

  const schemaEdited = expectOk(
    "schema edited artifactSummary",
    await request({ op: "artifactSummary", sessionId, sourceIds }),
  );

  expectOk(
    "reload schema source without exports",
    await request({
      op: "loadSource",
      sessionId,
      sourceId: sourceIds[0],
      source: "(+ 1 2)",
    }),
  );

  const schemaRemoved = expectOk(
    "schema removed artifactSummary",
    await request({ op: "artifactSummary", sessionId, sourceIds }),
  );
  const emitted = expectOk("emitMany", await request({ op: "emitMany", sessionId, sourceIds }));
  const combinedEmit = await request({ op: "emit", sessionId, sourceIds });

  const modulePeopleSource = `
(export Person)

(entity Person {:name (Option String)})

(entity InternalNote {:body (Option String)})
`;
  const moduleHiringSource = `
(import "./people.md" :as people)
(export Candidate)

(entity Candidate {:person (Option (Id people/Person))})
`;

  expectOk(
    "load module people",
    await request({
      op: "loadSource",
      sessionId,
      sourceId: moduleSourceIds[0],
      source: modulePeopleSource,
    }),
  );
  expectOk(
    "load module hiring",
    await request({
      op: "loadSource",
      sessionId,
      sourceId: moduleSourceIds[1],
      source: moduleHiringSource,
    }),
  );
  const moduleWarm = expectOk(
    "module warm artifactSummary",
    await request({ op: "artifactSummary", sessionId, sourceIds: moduleSourceIds }),
  );
  expectOk(
    "reload module private change",
    await request({
      op: "loadSource",
      sessionId,
      sourceId: moduleSourceIds[0],
      source: modulePeopleSource.replace("internal-note/body", "internal-note/text"),
    }),
  );
  const modulePrivateEdited = expectOk(
    "module private edited artifactSummary",
    await request({ op: "artifactSummary", sessionId, sourceIds: moduleSourceIds }),
  );
  expectOk(
    "reload module public export change",
    await request({
      op: "loadSource",
      sessionId,
      sourceId: moduleSourceIds[0],
      source: `${modulePeopleSource}\n(export Employee)\n(entity Employee {:name String})\n`,
    }),
  );
  const modulePublicEdited = expectOk(
    "module public edited artifactSummary",
    await request({ op: "artifactSummary", sessionId, sourceIds: moduleSourceIds }),
  );

  await request({ op: "closeSession", sessionId });
  daemon.stdin.end();

  if (
    cold.declarationCount !== 6 ||
    cold.diagnosticCount !== 0 ||
    cold.cacheHitCount !== sourceIds.length ||
    cold.cacheMissCount !== 0 ||
    !sourceIds.every((sourceId) => cacheHitForSource(cold, sourceId) === true)
  ) {
    throw new Error(`Unexpected cold artifact cache summary:\n${JSON.stringify(cold, null, 2)}`);
  }

  if (
    warm.declarationCount !== cold.declarationCount ||
    warm.diagnosticCount !== 0 ||
    warm.cacheHitCount !== sourceIds.length ||
    warm.cacheMissCount !== 0
  ) {
    throw new Error(`Unexpected warm artifact cache summary:\n${JSON.stringify(warm, null, 2)}`);
  }

  if (
    edited.declarationCount !== cold.declarationCount ||
    edited.diagnosticCount !== 0 ||
    edited.cacheHitCount !== 4 ||
    edited.cacheMissCount !== 0 ||
    cacheHitForSource(edited, sourceIds[1]) !== true
  ) {
    throw new Error(
      `Unexpected edited artifact cache summary:\n${JSON.stringify(edited, null, 2)}`,
    );
  }

  if (
    editedWarm.declarationCount !== cold.declarationCount ||
    editedWarm.diagnosticCount !== 0 ||
    editedWarm.cacheHitCount !== sourceIds.length ||
    editedWarm.cacheMissCount !== 0
  ) {
    throw new Error(
      `Unexpected edited warm artifact cache summary:\n${JSON.stringify(editedWarm, null, 2)}`,
    );
  }

  if (
    schemaEdited.declarationCount !== cold.declarationCount ||
    schemaEdited.diagnosticCount !== 0 ||
    schemaEdited.cacheHitCount !== 2 ||
    schemaEdited.cacheMissCount !== 2 ||
    cacheHitForSource(schemaEdited, sourceIds[0]) !== true
  ) {
    throw new Error(
      `Unexpected schema edited artifact cache summary:\n${JSON.stringify(schemaEdited, null, 2)}`,
    );
  }

  // Removing a schema invalidates its dependents rather than emitting stale IR.
  if (combinedEmit.ok !== false || !combinedEmit.diagnostics?.some(diagnostic =>
    diagnostic.code === "elaborate/unknown-reference" && diagnostic.message.includes("Department"))) {
    throw new Error(`Expected missing Department after schema removal: ${JSON.stringify(combinedEmit)}`);
  }
  if (!emitted.results?.some(result => result.ok === false) && emitted.diagnosticCount === 0) {
    throw new Error(`Expected emitMany to report the invalid dependent query: ${JSON.stringify(emitted)}`);
  }

  if (
    moduleWarm.cacheHitCount !== moduleSourceIds.length ||
    moduleWarm.cacheMissCount !== 0 ||
    !moduleSourceIds.every((sourceId) => cacheHitForSource(moduleWarm, sourceId) === true)
  ) {
    throw new Error(
      `Unexpected warm module artifact cache summary:\n${JSON.stringify(moduleWarm, null, 2)}`,
    );
  }

  if (
    modulePrivateEdited.cacheHitCount !== moduleSourceIds.length ||
    modulePrivateEdited.cacheMissCount !== 0 ||
    cacheHitForSource(modulePrivateEdited, moduleSourceIds[1]) !== true
  ) {
    throw new Error(
      `Unexpected private module edit cache summary:\n${JSON.stringify(
        modulePrivateEdited,
        null,
        2,
      )}`,
    );
  }

  if (
    modulePublicEdited.cacheHitCount !== 1 ||
    modulePublicEdited.cacheMissCount !== 1 ||
    cacheHitForSource(modulePublicEdited, moduleSourceIds[0]) !== true ||
    cacheHitForSource(modulePublicEdited, moduleSourceIds[1]) !== false
  ) {
    throw new Error(
      `Unexpected public module edit cache summary:\n${JSON.stringify(
        modulePublicEdited,
        null,
        2,
      )}`,
    );
  }
} finally {
  if (!daemon.killed) {
    daemon.stdin.end();
  }
}

const exitCode = await daemonExit;
if (exitCode !== 0) {
  throw new Error(`Daemon exited with ${exitCode}: ${stderr}`);
}

console.log("forma-ocaml artifact cache ok (source load warms artifact declarations)");

import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { packageDir, readMarkdownLispSource, readPreludes, repoRoot } from "./corpus.mjs";

const nativeCli = resolve(packageDir, "dist/native/forma_cli.exe");

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
  if (waiter) {
    waiter();
  }
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

const expectDiagnostic = (label, response, { code, includes }) => {
  const diagnostic = response?.diagnostics?.[0];
  if (
    response?.ok !== false ||
    diagnostic?.code !== code ||
    diagnostic?.span == null ||
    !diagnostic.message?.includes(includes)
  ) {
    throw new Error(`${label} expected ${code}:\n${JSON.stringify(response, null, 2)}`);
  }
};

const preludes = readPreludes({ names: ["kernel.lisp", "compiler.lisp", "ontology.lisp"] });

const examples = [
  "examples/compiler-debug/schema.md",
  "examples/compiler-debug/query-basic.md",
  "examples/compiler-debug/query-filtered.md",
  "examples/compiler-debug/action-basic.md",
].map((sourceId) => ({
  sourceId,
  source: readMarkdownLispSource(resolve(repoRoot, sourceId)),
}));

const invalidPreludes = [
  {
    label: "unknown artifact validator",
    code: "artifact/unknown-validator",
    includes: "missing-validator",
    sourceId: "descriptor-metacheck/unknown-validator",
    source: `
(__form-descriptor define-unknown-validator
  (:identifier name)
  (:extensions
    (:artifact
      (:validators [missing-validator])))
  (:construct-fn missing-validator/construct)
  (:result-type (constant UnknownValidatorDef)))
`,
  },
  {
    label: "unknown payload contract",
    code: "artifact/descriptor-payload",
    includes: "MissingPayloadContract",
    sourceId: "descriptor-metacheck/unknown-payload-contract",
    source: `
(__form-descriptor define-unknown-payload-contract
  (:identifier name)
  (:extensions
    (:artifact
      (:payload (:contract MissingPayloadContract))))
  (:construct-fn unknown-payload-contract/construct)
  (:result-type (constant UnknownPayloadContractDef)))
`,
  },
  {
    label: "malformed standalone payload contract",
    code: "artifact/descriptor-payload",
    includes: "payload clauses with textual clause names",
    sourceId: "descriptor-metacheck/malformed-payload-contract",
    source: `
(__payload-contract MalformedPayloadContract
  not-a-payload-clause)
`,
  },
  {
    label: "malformed extensions block",
    code: "descriptor/extensions",
    includes: "Descriptor :extensions entries",
    sourceId: "descriptor-metacheck/malformed-extensions",
    source: `
(__form-descriptor define-malformed-extensions
  (:identifier name)
  (:extensions not-an-extension-entry))
`,
  },
  {
    label: "malformed artifact payload block",
    code: "artifact/descriptor-payload",
    includes: "must be a map of clauses",
    sourceId: "descriptor-metacheck/malformed-artifact-payload",
    source: `
(__form-descriptor define-malformed-artifact-payload
  (:identifier name)
  (:extensions
    (:artifact
      (:payload "not-a-map")))
  (:construct-fn malformed-artifact-payload/construct)
  (:result-type (constant MalformedArtifactPayloadDef)))
`,
  },
  {
    label: "missing artifact summary requirements",
    code: "artifact/descriptor-summary",
    includes: "must declare :construct-fn",
    sourceId: "descriptor-metacheck/missing-artifact-summary",
    source: `
(__form-descriptor define-missing-artifact-summary
  (:identifier name)
  (:extensions
    (:artifact
      (:validators [http]))))
`,
  },
];

const invalidSources = [
  {
    label: "unknown descriptor slot",
    code: "surface/invalid-form",
    includes: "Available options: :doc",
    sourceId: "descriptor-metacheck/unknown-slot",
    source: `
(entity Employee {:name (Option String)}
  :dco "Employee record")
`,
  },
];

const unresolvedHookPrelude = {
  sourceId: "descriptor-metacheck/unresolved-artifact-hook-prelude",
  source: `
(__form-descriptor define-unresolved-artifact-hook
  (:identifier name)
  (:extensions
    (:artifact
      (:payload (:required-fields [kind name]))))
  (:construct-fn missing-artifact-hook/construct)
  (:result-type (constant UnresolvedArtifactHookDef)))
`,
};

const unresolvedHookSource = {
  sourceId: "descriptor-metacheck/unresolved-artifact-hook-source",
  source: `(define-unresolved-artifact-hook bad-hook)`,
};

let sessionId;
let hardFailure;
const failures = [];

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

  for (const invalidPrelude of invalidPreludes) {
    const response = await request({
      op: "loadPrelude",
      sessionId,
      sourceId: invalidPrelude.sourceId,
      source: invalidPrelude.source,
    });
    expectDiagnostic(`loadPrelude rejects ${invalidPrelude.label}`, response, invalidPrelude);
  }

  for (const example of examples) {
    const loaded = await request({
      op: "loadSource",
      sessionId,
      ...example,
    });
    expectOk(`loadSource ${example.sourceId}`, loaded);

    const evaluated = await request({
      op: "evaluate",
      sessionId,
      sourceId: example.sourceId,
    });

    if (evaluated?.ok !== true || evaluated.value?.kind !== "map") {
      failures.push({
        sourceId: example.sourceId,
        response: evaluated,
      });
    }
  }

  for (const invalidSource of invalidSources) {
    const response = await request({
      op: "loadSource",
      sessionId,
      sourceId: invalidSource.sourceId,
      source: invalidSource.source,
    });
    expectDiagnostic(`loadSource rejects ${invalidSource.label}`, response, invalidSource);
  }

  const hookSession = await request({ op: "openSession" });
  expectOk("openSession hook metacheck", hookSession);
  const hookSessionId = hookSession.value.sessionId;
  try {
    for (const prelude of preludes.slice(0, 2)) {
      expectOk(
        `loadPrelude hook metacheck ${prelude.sourceId}`,
        await request({
          op: "loadPrelude",
          sessionId: hookSessionId,
          ...prelude,
        }),
      );
    }
    expectOk(
      "loadPrelude unresolved artifact hook",
      await request({
        op: "loadPrelude",
        sessionId: hookSessionId,
        ...unresolvedHookPrelude,
      }),
    );
    expectOk(
      "loadSource unresolved artifact hook",
      await request({
        op: "loadSource",
        sessionId: hookSessionId,
        ...unresolvedHookSource,
      }),
    );
    expectDiagnostic(
      "emit rejects unresolved artifact hook",
      await request({
        op: "emit",
        sessionId: hookSessionId,
        backend: "canonical-ir",
        sourceId: unresolvedHookSource.sourceId,
      }),
      {
        code: "descriptor/unresolved-hook",
        includes: "missing-artifact-hook/construct",
      },
    );
  } finally {
    await request({ op: "closeSession", sessionId: hookSessionId });
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
  console.error(`forma-ocaml descriptor prelude check failed: ${hardFailure.message}`);
  process.exit(1);
}

if (failures.length > 0) {
  console.error(`forma-ocaml descriptor declaration failures: ${failures.length}`);
  for (const failure of failures) {
    console.error(JSON.stringify(failure, null, 2));
  }
  process.exit(1);
}

console.log(
  `forma-ocaml descriptor preludes ok (${preludes.length} preludes, ${examples.length} examples)`,
);

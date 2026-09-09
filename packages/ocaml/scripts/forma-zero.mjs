// Forma Zero conformance suite — runs the shared fixtures in
// packages/conformance/forma-zero against the OCaml engine.
// The same fixtures run against @formalang/ts via
// packages/ts/test/forma-zero.test.ts.
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const packageDir = resolve(import.meta.dirname, "..");
const suiteDir = resolve(packageDir, "../../conformance/forma-zero");
const nativeCli = resolve(packageDir, "dist/native/forma_cli.exe");

if (!existsSync(nativeCli)) {
  console.error(
    `Missing ${nativeCli}. Build @formalang/ocaml first (pnpm --filter @formalang/ocaml build).`,
  );
  process.exit(127);
}

const preludeSource = readFileSync(join(suiteDir, "prelude.lisp"), "utf8");

// Split the prelude into top-level forms. The engine generalizes a define's
// type when it is stored into the session (evaluate per form), but typechecks
// a multi-form program monomorphically — the shared prelude relies on
// let-polymorphism between defines (e.g. the variadic `lst` is used at
// several arities), so it is loaded REPL-style, one form per request.
const topLevelForms = (source) => {
  const forms = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === ";") {
      while (i < source.length && source[i] !== "\n") i++;
      continue;
    }
    if (c === '"') {
      i++;
      while (i < source.length && source[i] !== '"') {
        if (source[i] === "\\") i++;
        i++;
      }
      continue;
    }
    if (c === "(" || c === "[" || c === "{") {
      if (depth === 0) start = i;
      depth++;
    }
    if (c === ")" || c === "]" || c === "}") {
      depth--;
      if (depth === 0) forms.push(source.slice(start, i + 1));
    }
  }
  return forms;
};
const expected = JSON.parse(readFileSync(join(suiteDir, "expected.json"), "utf8"));
const caseFiles = readdirSync(join(suiteDir, "cases"))
  .filter((f) => f.endsWith(".lisp"))
  .sort();

const caseNames = caseFiles.map((f) => basename(f, ".lisp"));
const expectedNames = Object.keys(expected).sort();
if (JSON.stringify(caseNames) !== JSON.stringify(expectedNames)) {
  console.error(
    `Case files and expected.json disagree:\n  cases:    ${caseNames.join(", ")}\n  expected: ${expectedNames.join(", ")}`,
  );
  process.exit(1);
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
  if (waiter) {
    waiter();
  }
});

const waitForLine = async () => {
  if (responses.length > 0) return responses.shift();
  return new Promise((resolvePromise, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for daemon response. stderr: ${stderr}`));
    }, 10_000);
    waiters.push(() => {
      clearTimeout(timeout);
      resolvePromise(responses.shift());
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

let sessionId;
const failures = [];
let hardFailure;

try {
  const opened = await request({ op: "openSession" });
  expectOk("openSession", opened);
  sessionId = opened.value.sessionId;

  const forms = topLevelForms(preludeSource);
  for (const [index, form] of forms.entries()) {
    const loaded = await request({
      op: "loadPrelude",
      sessionId,
      sourceId: `forma-zero/prelude-${index}`,
      source: form,
    });
    expectOk(`prelude form ${index} (${form.slice(0, 40)}…)`, loaded);
  }

  for (const name of caseNames) {
    const source = readFileSync(join(suiteDir, "cases", `${name}.lisp`), "utf8");
    const want = expected[name];
    const response = await request({
      op: "evaluate",
      sessionId,
      sourceId: `forma-zero/${name}`,
      source,
    });

    const got = response?.ok === true ? response.value : undefined;
    if (got?.kind !== want.kind || got?.value !== want.value) {
      failures.push({ name, expected: want, response });
    }
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

const exitCode = await new Promise((resolvePromise) => daemon.on("close", resolvePromise));
if (exitCode !== 0) {
  throw new Error(`Daemon exited with ${exitCode}: ${stderr}`);
}

if (hardFailure) {
  console.error(`forma-ocaml forma-zero failed: ${hardFailure.message}`);
  process.exit(1);
}

if (failures.length > 0) {
  console.error(`forma-ocaml forma-zero failures: ${failures.length}/${caseNames.length}`);
  for (const failure of failures) {
    console.error(JSON.stringify(failure, null, 2));
  }
  process.exit(1);
}

console.log(`forma-ocaml forma-zero ok (${caseNames.length} cases)`);

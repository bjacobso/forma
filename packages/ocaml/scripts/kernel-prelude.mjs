import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const packageDir = resolve(import.meta.dirname, "..");
const repoRoot = resolve(packageDir, "../..");
const nativeCli = resolve(packageDir, "dist/native/forma_cli.exe");
const kernelPrelude = resolve(repoRoot, "preludes/kernel.lisp");

const kernelSource = readFileSync(kernelPrelude, "utf8");

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
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for daemon response. stderr: ${stderr}`));
    }, 5000);
    waiters.push(() => {
      clearTimeout(timeout);
      resolve(responses.shift());
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

const describeResponse = (response) => JSON.stringify(response, null, 2);

const expectOk = (label, response) => {
  if (response?.ok !== true) {
    throw new Error(`${label} failed:\n${describeResponse(response)}`);
  }
};

const expectValue = (label, response, expected) => {
  expectOk(label, response);
  for (const [key, value] of Object.entries(expected)) {
    if (response.value?.[key] !== value) {
      throw new Error(
        `${label} expected value.${key}=${JSON.stringify(value)}:\n${describeResponse(response)}`,
      );
    }
  }
};

const cases = [
  {name:"false boolean fallback",source:"(or false false)",expected:{kind:"bool",value:false}},
  {name:"named recursion",source:"(define length [items] (if (empty? items) 0 (+ 1 (length (rest items))))) (length [1 2 3])",expected:{kind:"int",value:3}},
  {name:"quoted type syntax",source:"(first '(-> String Unit))",expected:{kind:"symbol",value:"->"}},
  {
    name: "not macro",
    source: "(not false)",
    expected: { kind: "bool", value: true },
  },
  {
    name: "when macro",
    source: "(when true 7)",
    expected: { kind: "int", value: 7 },
  },
  {
    name: "cond macro",
    source: "(cond false 1 :else 2)",
    expected: { kind: "int", value: 2 },
  },
  {
    name: "thread-first macro",
    source: '(-> {:status "active"} (get :status))',
    expected: { kind: "string", value: "active" },
  },
];

let sessionId;
const failures = [];
let hardFailure;

try {
  const opened = await request({ op: "openSession" });
  expectOk("openSession", opened);
  sessionId = opened.value.sessionId;

  const loaded = await request({
    op: "loadPrelude",
    sessionId,
    sourceId: "preludes/kernel.lisp",
    source: kernelSource,
  });
  expectOk("loadPrelude preludes/kernel.lisp", loaded);

  for (const testCase of cases) {
    const response = await request({
      op: "evaluate",
      sessionId,
      sourceId: `kernel-prelude/${testCase.name}`,
      source: testCase.source,
    });

    try {
      expectValue(testCase.name, response, testCase.expected);
    } catch (error) {
      failures.push({
        name: testCase.name,
        source: testCase.source,
        expected: testCase.expected,
        response,
        error: String(error),
      });
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

const exitCode = await new Promise((resolve) => daemon.on("close", resolve));
if (exitCode !== 0) {
  throw new Error(`Daemon exited with ${exitCode}: ${stderr}`);
}

if (hardFailure) {
  console.error(`forma-ocaml kernel prelude failed: ${hardFailure.message}`);
  process.exit(1);
}

if (failures.length > 0) {
  console.error(`forma-ocaml kernel prelude failures: ${failures.length}/${cases.length}`);
  for (const failure of failures) {
    console.error(JSON.stringify(failure, null, 2));
  }
  process.exit(1);
}

console.log(`forma-ocaml kernel prelude ok (${cases.length} cases)`);

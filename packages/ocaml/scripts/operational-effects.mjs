import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { packageDir } from "./corpus.mjs";

const nativeCli = resolve(packageDir, "dist/native/forma_cli.exe");
const fixtureDir = resolve(packageDir, "../../conformance/operational-effects");
const source = readFileSync(resolve(fixtureDir, "program.lisp"), "utf8");
const golden = JSON.parse(readFileSync(resolve(fixtureDir, "expected.json"), "utf8"));

if (!existsSync(nativeCli)) {
  throw new Error("Missing native Forma CLI. Build @formalang/ocaml first.");
}

const daemon = spawn(nativeCli, ["daemon"], { cwd: packageDir, stdio: ["pipe", "pipe", "pipe"] });
const lines = createInterface({ input: daemon.stdout });
const responses = [];
const waiters = [];
let stderr = "";

daemon.stderr.on("data", (chunk) => {
  stderr += chunk;
});
lines.on("line", (line) => {
  const waiter = waiters.shift();
  if (waiter) waiter(line);
  else responses.push(line);
});

const nextLine = () => {
  const line = responses.shift();
  if (line !== undefined) return Promise.resolve(line);
  return new Promise((resolveLine, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Timed out waiting for Forma daemon: ${stderr}`)),
      10_000,
    );
    waiters.push((value) => {
      clearTimeout(timeout);
      resolveLine(value);
    });
  });
};

const request = async (payload) => {
  daemon.stdin.write(`${JSON.stringify(payload)}\n`);
  return JSON.parse(await nextLine());
};

const expectOk = (label, response) => {
  if (response?.ok !== true) {
    throw new Error(`${label} failed:\n${JSON.stringify(response, null, 2)}`);
  }
  return response;
};

let sessionId;
let failure;

try {
  const checked = expectOk(
    "operational source typecheck",
    await request({ op: "typecheck", sourceId: "conformance/operational-effects", source }),
  );
  if (checked.type !== golden.types.ocaml) {
    throw new Error(`Unexpected type ${JSON.stringify(checked.type)}.`);
  }

  const legacy = await request({
    op: "typecheck",
    sourceId: "conformance/legacy-effect",
    source: "(perform Console.print \"legacy\")",
  });
  if (legacy.ok !== false || legacy.diagnostics?.[0]?.code !== "lower/legacy-effect") {
    throw new Error(`Legacy effect syntax was not quarantined:\n${JSON.stringify(legacy, null, 2)}`);
  }

  const opened = expectOk("openSession", await request({ op: "openSession" }));
  sessionId = opened.value.sessionId;
  expectOk(
    "loadSource",
    await request({
      op: "loadSource",
      sessionId,
      sourceId: "conformance/operational-effects",
      source,
    }),
  );
  const emitted = expectOk(
    "emit",
    await request({
      op: "emit",
      sessionId,
      backend: "canonical-ir",
      sourceId: "conformance/operational-effects",
    }),
  );

  const declarations = emitted.value?.artifacts?.[0]?.content?.declarations;
  const find = (kind, name) =>
    declarations?.find((item) => item?.kind === kind && item?.name === name);
  const service = find("ServiceDef", "Console");
  const failed = find("EffectDef", "always-fail");
  const recovered = find("EffectDef", "recover");
  const logged = find("EffectDef", "log");

  if (
    service?.methods?.[0]?.effect?.requirements?.join(",") !== golden.serviceCapability ||
    failed?.body?.error?.errorType !== golden.failedErrorType ||
    recovered?.body?.kind !== "Catch" ||
    recovered?.body?.body?.kind !== "OperationCall" ||
    recovered?.body?.errorType !== golden.caughtErrorType ||
    logged?.authority?.capabilities?.join(",") !== golden.authorityCapabilities.join(",")
  ) {
    throw new Error(`Unexpected operational IR:\n${JSON.stringify(emitted, null, 2)}`);
  }
} catch (error) {
  failure = error;
} finally {
  if (sessionId) {
    try {
      await request({ op: "closeSession", sessionId });
    } catch {
      // The daemon may already be closing after an earlier failure.
    }
  }
  daemon.stdin.end();
}

const exitCode = await new Promise((resolveExit) => daemon.on("close", resolveExit));
if (exitCode !== 0) throw new Error(`Forma daemon exited with ${exitCode}: ${stderr}`);
if (failure) throw failure;

console.log("forma-ocaml operational effects conformance ok (source + type + IR)");

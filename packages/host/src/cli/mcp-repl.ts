/** `forma mcp`'s REPL: the shared session plus a Node permission-model process for :run. */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { JsonAbi } from "../json-abi.js";
import { createRepl } from "../repl.js";

const RUN_TIMEOUT_MS = 10_000;
const ENTRY = "__repl";

export const createNodeRepl = (abi: JsonAbi) => createRepl(abi, {
  run: runGenerated,
  runNote: `:run executes generated
Effect code in a separate Node process with the permission model: it can read only
the effect package, has an empty environment, no file writes, child processes or
workers (and no network on Node 25+), and is killed after ${RUN_TIMEOUT_MS / 1000}s.`,
});

function effectPackageRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.resolve("effect")));
  while (!existsSync(join(dir, "package.json")) && dirname(dir) !== dir) dir = dirname(dir);
  return dir;
}

// Runs inside the restricted child: strip types, import the module, run the entry, report the Exit as JSON.
const runner = `
import { stripTypeScriptTypes } from "node:module";
let input = "";
for await (const chunk of process.stdin) input += chunk;
const { code, effectUrl, entry } = JSON.parse(input);
const logs = [];
for (const level of ["log", "info", "warn", "error", "debug", "trace"])
  console[level] = (...args) => logs.push(args.map(a => typeof a === "string" ? a : JSON.stringify(a)).join(" ").replace(/^\\[[\\d:.]+\\] /, ""));
const json = value => JSON.parse(JSON.stringify(value, (_, v) => typeof v === "bigint" ? v.toString() : v === undefined ? null : v) ?? "null");
const report = result => process.stdout.write(JSON.stringify({ ...result, logs }));
try {
  const js = stripTypeScriptTypes(code).replaceAll('from "effect"', "from " + JSON.stringify(effectUrl));
  const { Effect, Exit } = await import(effectUrl);
  const program = await import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));
  const exit = await Effect.runPromiseExit(program[entry]);
  if (Exit.isSuccess(exit)) report({ exit: "success", value: json(exit.value) });
  else report({ exit: "failure",
    errors: exit.cause.reasons.filter(r => r._tag === "Fail").map(r => json(r.error)),
    defects: exit.cause.reasons.filter(r => r._tag === "Die").map(r => String(r.defect)),
    interrupted: exit.cause.reasons.some(r => r._tag === "Interrupt") });
} catch (e) { report({ exit: "crash", defects: [String(e)] }); }
`;

/** Exported for tests of the run boundary; the REPL passes only generated Effect modules. */
export function runGenerated(code: string): Promise<Record<string, unknown>> {
  const root = effectPackageRoot();
  return new Promise(resolve => {
    const child = spawn(process.execPath, ["--permission", `--allow-fs-read=${root}`, "--max-old-space-size=256", "--no-warnings", "--input-type=module", "-e", runner],
      { env: {}, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "", timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, RUN_TIMEOUT_MS);
    child.stdout.on("data", chunk => { if (stdout.length < 1_000_000) stdout += chunk; });
    child.stderr.on("data", chunk => { if (stderr.length < 10_000) stderr += chunk; });
    child.on("close", () => {
      clearTimeout(timer);
      if (timedOut) return resolve({ exit: "timeout", defects: [`Killed after ${RUN_TIMEOUT_MS / 1000}s.`], logs: [] });
      try { resolve(JSON.parse(stdout)); } catch { resolve({ exit: "crash", defects: [stderr.trim() || "The run produced no result."], logs: [] }); }
    });
    child.stdin.end(JSON.stringify({ code, effectUrl: import.meta.resolve("effect"), entry: ENTRY }));
  });
}


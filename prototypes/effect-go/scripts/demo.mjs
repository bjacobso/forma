#!/usr/bin/env node
// Forma source → generated Go → build → run, for RFC 0023.
//
// Generates Go for four Effect conformance programs and the http-api prelude
// program with the built @formalang/ts/effect-go entry point, writes it to a
// temporary directory, and uses `go -overlay` so the Go toolchain builds that
// fresh output in place of the committed goldens. Then it runs the runtime
// tests, the Go twins of the TypeScript harnesses (with the race detector),
// the cross-host http-api check, and the demo command. It installs nothing.
//
//   pnpm effect-go:demo
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const moduleRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(moduleRoot, "../..");
const entry = join(repoRoot, "packages/ts/dist/EffectGo.mjs");
const cases = [
  ["crud-users", "crudusers"],
  ["operational-effects", "operationaleffects"],
  ["concurrent-workflow", "concurrentworkflow"],
  ["resource-scope", "resourcescope"],
  // A prelude program: http-api forms emit Go through their :go hooks.
  ["http-api", "shop", "http-api"],
];

const go = spawnSync("go", ["version"], { encoding: "utf8" });
if (go.error || go.status !== 0) fail("Go 1.25 or later is required on PATH (see prototypes/effect-go/README.md).");
if (!existsSync(entry)) fail("Build @formalang/ts first: pnpm --filter @formalang/ts build");
const { generateEffectGoProgram, generateHttpApiGoProgram } = await import(pathToFileURL(entry).href);

heading(`1. Generate Go from Forma (${go.stdout.trim()})`);
const out = mkdtempSync(join(tmpdir(), "effect-go-demo-"));
const overlay = { Replace: {} };
for (const [name, packageName, linker] of cases) {
  const generate = linker === "http-api" ? generateHttpApiGoProgram : generateEffectGoProgram;
  const sourcePath = join(repoRoot, "conformance/effect-typescript/cases", name, "program.lisp");
  const result = generate(readFileSync(sourcePath, "utf8"), { packageName, sourceId: `${name}/program.lisp` });
  if (!result.ok) fail(`${name}: ${result.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n")}`);
  const generated = join(out, `${name}.go`);
  writeFileSync(generated, result.code);
  const golden = join(moduleRoot, "conformance", name, "program.go");
  overlay.Replace[golden] = generated;
  const same = readFileSync(golden, "utf8") === result.code;
  console.log(`${name.padEnd(20)} ${String(result.code.split("\n").length).padStart(4)} lines of Go, ${same ? "identical to the committed golden" : "DIFFERS from the committed golden"}`);
}
const overlayPath = join(out, "overlay.json");
writeFileSync(overlayPath, JSON.stringify(overlay, null, 2));

heading("2. One operation, before and after");
const crud = readFileSync(join(repoRoot, "conformance/effect-typescript/cases/crud-users/program.lisp"), "utf8");
console.log(topLevelForms(crud).filter((form) => /^\((:|define)\s+get-user\b/.test(form)).join("\n"));
console.log("\n↓\n");
const generatedCrud = readFileSync(overlay.Replace[join(moduleRoot, "conformance/crud-users/program.go")], "utf8");
const start = generatedCrud.indexOf("// GetUser is the operation");
console.log(generatedCrud.slice(start, generatedCrud.indexOf("\n}\n", start) + 2));

heading("3. Vet, then test the runtime and the Go twins of the TypeScript harnesses (-race)");
run("go", ["vet", `-overlay=${overlayPath}`, "./..."]);
run("go", ["test", "-race", "-count=1", `-overlay=${overlayPath}`, "./effect/", "./forma/", "./conformance/..."]);

heading("4. One http-api program on two hosts: TypeScript server vs Go server, TypeScript client → Go server");
run(join(repoRoot, "node_modules/.bin/tsx"), ["conformance/http-api/cross-host.ts"], { GOFLAGS: `-overlay=${overlayPath}` });

heading("5. Run the generated programs");
run("go", ["run", `-overlay=${overlayPath}`, "./cmd/demo"]);

function run(command, args, env = {}) {
  console.log(`$ ${command.replace(`${repoRoot}/`, "")} ${args.map((arg) => (arg.startsWith("-overlay=") ? "-overlay=…" : arg)).join(" ")}`);
  const result = spawnSync(command, args, { cwd: moduleRoot, stdio: "inherit", env: { ...process.env, ...env } });
  if (result.status !== 0) fail(`${command} ${args[0]} failed`);
}

/** Top-level forms: each starts with "(" at the beginning of a line. */
function topLevelForms(source) {
  return source.split(/\n(?=\()/).map((form) => form.trim());
}

function heading(text) {
  console.log(`\n\x1b[1m${text}\x1b[0m`);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

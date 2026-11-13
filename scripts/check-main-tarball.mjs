import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Default to committed source. An explicit archive permits pre-commit checks.
const root = resolve(import.meta.dirname, "..");
const temporary = await mkdtemp(join(tmpdir(), "forma-main-tarball-"));
const run = (command, args, cwd = root) => {
  try {
    return execFileSync(command, args, {
      cwd, encoding: "utf8", timeout: 600_000, maxBuffer: 16 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    console.error(error.stdout?.toString(), error.stderr?.toString());
    throw error;
  }
};
try {
  let archive = process.argv[2] && resolve(process.argv[2]);
  if (!archive) {
    const revision = run("git", ["rev-parse", "HEAD"]).trim();
    const checkout = join(temporary, "source");
    run("git", ["clone", "--shared", "--no-checkout", root, checkout]);
    run("git", ["checkout", "--detach", revision], checkout);
    console.log(`Checking clean committed source ${revision}`);
    run("pnpm", ["install", "--frozen-lockfile", "--prefer-offline"], checkout);
    run("pnpm", ["exec", "turbo", "run", "build", "--filter=@forma-language/forma"], checkout);
    archive = join(temporary, "forma.tgz");
    run("pnpm", ["--filter", "@forma-language/forma", "pack", "--out", archive], checkout);
  }
  const packed = JSON.parse(run("tar", ["-xOzf", archive, "package/package.json"]));
  const consumer = join(temporary, "consumer");
  await mkdir(consumer);
  await writeFile(join(consumer, "package.json"), JSON.stringify({ private: true, type: "module" }));
  // Use npm's ordinary peer resolution: no dependency overrides or workspace links.
  run("npm", ["install", "--prefer-offline", "--ignore-scripts", "--no-audit", "--no-fund", archive, "effect@4.1.1"], consumer);
  const lock = JSON.parse(await readFile(join(consumer, "package-lock.json"), "utf8"));
  const installed = Object.keys(lock.packages).filter(path => path !== "");
  console.log(`Lean install: ${installed.length} packages`);
  for (const name of Object.keys(packed.peerDependenciesMeta)) {
    assert(!installed.some(path => path.endsWith(`node_modules/${name}`)), `optional peer installed: ${name}`);
  }
  await writeFile(join(consumer, "main.lisp"), "(+ 20 22)\n");
  await writeFile(join(consumer, "main-test.lisp"), '(import "forma:test" [test is=]) (test "tarball" (is= (+ 20 22) 42))\n');
  run("npx", ["--no-install", "forma", "check", "main.lisp"], consumer);
  assert.equal(run("npx", ["--no-install", "forma", "run", "main.lisp"], consumer).trim(), "42");
  assert.match(run("npx", ["--no-install", "forma", "test", "main-test.lisp"], consumer), /PASS tarball/);
  run("npx", ["--no-install", "forma", "describe", "main.lisp"], consumer);
  for (const [bin, args, name, range] of [
    ["forma", ["mcp"], "@modelcontextprotocol/sdk", "^1.32.2"],
    ["forma-language-server", ["--stdio"], "vscode-languageserver", "^9.0.1"],
  ]) {
    const result = spawnSync(join(consumer, "node_modules/.bin", bin), args, { cwd: consumer, encoding: "utf8", timeout: 30_000 });
    assert.equal(result.status, 1, result.stderr);
    assert(result.stderr.includes(`${bin === "forma" ? "forma mcp" : bin} needs ${name}`), result.stderr);
    assert(result.stderr.includes(`npm install ${name}@${range}`), result.stderr);
    assert.equal(result.stdout, "");
    if (bin === "forma-language-server") assert(result.stderr.includes("npm install vscode-languageserver-textdocument@^1.0.12"), result.stderr);
  }
  await writeFile(join(consumer, "embed.mjs"), `
    import assert from 'node:assert/strict';
    import { createLanguage } from '@forma-language/forma';
    for (const key of ${JSON.stringify(Object.keys(packed.exports).filter(key => !["./editor/codemirror", "./editor/react", "./language-server"].includes(key)))}) {
      await import('@forma-language/forma' + (key === '.' ? '' : key.slice(1)));
    }
    const language = await createLanguage();
    try {
      assert.equal((await language.check('(+ 20 22)')).ok, true);
      assert.equal((await language.run('(+ 20 22)')).value, 42);
    } finally { await language.close(); }
  `);
  run(process.execPath, ["embed.mjs"], consumer);
  const tools = Object.entries(packed.peerDependencies)
    .filter(([name]) => !["effect", "react", "react-dom"].includes(name))
    .map(([name, range]) => `${name}@${range}`);
  run("npm", ["install", "--prefer-offline", "--ignore-scripts", "--no-audit", "--no-fund", ...tools], consumer);
  assert.match(run("npx", ["--no-install", "forma-language-server", "--help"], consumer), /forma-language-server/);
  await writeFile(join(consumer, "mcp.mjs"), `
    import { Client } from '@modelcontextprotocol/sdk/client/index.js';
    import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
    import assert from 'node:assert/strict';
    const client = new Client({ name: 'tarball-smoke', version: '1.0.0' });
    try {
      await client.connect(new StdioClientTransport({ command: process.execPath, args: ['node_modules/@forma-language/forma/dist/cli.mjs', 'mcp'] }));
      assert((await client.listTools()).tools.some(tool => tool.name === 'check'));
    } finally { await client.close(); }
  `);
  run(process.execPath, ["mcp.mjs"], consumer);
  console.log("Clean tarball: lean exports, check, run, forma:test, createLanguage, missing-tool guidance and installed tool bins passed");
} finally {
  await rm(temporary, { recursive: true, force: true });
}

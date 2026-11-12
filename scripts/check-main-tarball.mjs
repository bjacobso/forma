import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Deliberately test committed source, never local dist or uncommitted changes.
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
  const revision = run("git", ["rev-parse", "HEAD"]).trim();
  const checkout = join(temporary, "source");
  run("git", ["clone", "--shared", "--no-checkout", root, checkout]);
  run("git", ["checkout", "--detach", revision], checkout);
  console.log(`Checking clean committed source ${revision}`);
  run("pnpm", ["install", "--frozen-lockfile", "--prefer-offline"], checkout);
  run("pnpm", ["exec", "turbo", "run", "build", "--filter=@forma-language/forma"], checkout);
  const archive = join(temporary, "forma.tgz");
  run("pnpm", ["--filter", "@forma-language/forma", "pack", "--out", archive], checkout);
  const consumer = join(temporary, "consumer");
  await mkdir(consumer);
  await writeFile(join(consumer, "package.json"), JSON.stringify({ private: true, type: "module" }));
  // Use npm's ordinary peer resolution: no dependency overrides or workspace links.
  run("npm", ["install", "--prefer-offline", "--ignore-scripts", "--no-audit", "--no-fund", archive, "effect@4.1.1"], consumer);
  await writeFile(join(consumer, "main.lisp"), "(+ 20 22)\n");
  await writeFile(join(consumer, "main-test.lisp"), '(import "forma:test" [test is=]) (test "tarball" (is= (+ 20 22) 42))\n');
  run("npx", ["--no-install", "forma", "check", "main.lisp"], consumer);
  assert.equal(run("npx", ["--no-install", "forma", "run", "main.lisp"], consumer).trim(), "42");
  assert.match(run("npx", ["--no-install", "forma", "test", "main-test.lisp"], consumer), /PASS tarball/);
  assert.match(run("npx", ["--no-install", "forma-language-server", "--help"], consumer), /forma-language-server/);
  await writeFile(join(consumer, "embed.mjs"), `
    import assert from 'node:assert/strict';
    import { createLanguage } from '@forma-language/forma';
    const language = await createLanguage();
    try {
      assert.equal((await language.check('(+ 20 22)')).ok, true);
      assert.equal((await language.run('(+ 20 22)')).value, 42);
    } finally { await language.close(); }
  `);
  run(process.execPath, ["embed.mjs"], consumer);
  console.log("Clean tarball: root, check, run, forma:test, createLanguage and both bins passed");
} finally {
  await rm(temporary, { recursive: true, force: true });
}

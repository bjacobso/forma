import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

const root = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(await readFile(join(root, "packages/forma/package.json"), "utf8"));
const optional = {
  "@codemirror/autocomplete": "^6.18.6", "@codemirror/commands": "^6.8.1",
  "@codemirror/lang-markdown": "^6.5.0", "@codemirror/language": "^6.11.0",
  "@codemirror/lint": "^6.8.5", "@codemirror/state": "^6.5.2", "@codemirror/view": "^6.36.8",
  "@lezer/highlight": "^1.2.1", "@lezer/lr": "^1.4.2", "@modelcontextprotocol/sdk": "1.32.2",
  "vscode-languageserver": "^9.0.1", "vscode-languageserver-textdocument": "^1.0.12",
};

test("distribution declares optional tools as optional peers and build dependencies", () => {
  for (const [name, range] of Object.entries(optional)) {
    assert.equal(manifest.dependencies?.[name], undefined, name);
    assert.equal(manifest.peerDependencies[name], range, name);
    assert.equal(manifest.devDependencies[name], range, name);
    assert.equal(manifest.peerDependenciesMeta[name]?.optional, true, name);
  }
});

test("lean distribution loads ordinary entries and explains missing bin dependencies", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "forma-optional-"));
  try {
    const modules = join(temporary, "node_modules");
    const library = join(modules, "@forma-language/forma");
    await mkdir(library, { recursive: true });
    await cp(join(root, "packages/forma/dist"), join(library, "dist"), { recursive: true });
    await writeFile(join(library, "package.json"), JSON.stringify(manifest));
    await symlink(await realpath(join(root, "node_modules/effect")), join(modules, "effect"));
    const run = args => spawnSync(process.execPath, args, { cwd: temporary, encoding: "utf8", timeout: 30_000 });
    const entries = Object.keys(manifest.exports).filter(key => !["./editor/codemirror", "./editor/react", "./language-server"].includes(key));
    const imports = run(["--input-type=module", "-e", `
      for (const key of ${JSON.stringify(entries)}) await import('@forma-language/forma' + (key === '.' ? '' : key.slice(1)));
      const { createLanguage } = await import('@forma-language/forma');
      const language = await createLanguage();
      try { if ((await language.run('(+ 20 22)')).value !== 42) throw new Error('evaluation failed'); }
      finally { await language.close(); }
    `]);
    assert.equal(imports.status, 0, imports.stderr);
    await writeFile(join(temporary, "main.lisp"), "(+ 20 22)\n");
    await writeFile(join(temporary, "main-test.lisp"), '(import "forma:test" [test is=]) (test "lean" (is= 42 42))\n');
    const cli = join(library, "dist/cli.mjs");
    for (const args of [["help"], ["check", "main.lisp"], ["describe", "main.lisp"], ["fmt", "main.lisp"], ["explain", "typecheck/arity"], ["abi-schema"]]) {
      const result = run([cli, ...args]);
      assert.equal(result.status, 0, result.stderr);
    }
    assert.equal(run([cli, "run", "main.lisp"]).stdout.trim(), "42");
    assert.match(run([cli, "test", "main-test.lisp"]).stdout, /PASS lean/);
    const missing = (args, name, range) => {
      const result = run(args);
      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stderr, new RegExp(`needs ${name.replaceAll("/", "\\/")}`));
      assert(result.stderr.includes(`npm install ${name}@${range}`), result.stderr);
      assert.equal(result.stdout, "");
    };
    missing([join(library, "dist/cli.mjs"), "mcp"], "@modelcontextprotocol/sdk", "1.32.2");
    const server = join(library, "dist/forma-language-server.mjs");
    missing([server, "--stdio"], "vscode-languageserver", "^9.0.1");
    // Check each LSP peer independently: the server package's own transitive
    // dependencies resolve through its real workspace location.
    await symlink(await realpath(join(root, "packages/language-server/node_modules/vscode-languageserver")), join(modules, "vscode-languageserver"));
    missing([server, "--stdio"], "vscode-languageserver-textdocument", "^1.0.12");
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

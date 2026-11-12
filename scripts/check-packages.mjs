import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const temporary = await mkdtemp(join(tmpdir(), "forma-release-check-"));
const run = (command, args, cwd = root) => {
  try {
    return execFileSync(command, args, { cwd, encoding: "utf8", timeout: 180_000, maxBuffer: 16 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    console.error(error.stdout?.toString(), error.stderr?.toString());
    throw error;
  }
};
const targets = value => typeof value === "string" ? [value]
  : value && typeof value === "object" ? Object.values(value).flatMap(targets) : [];
const name = "@forma-language/forma";
const store = run("pnpm", ["store", "path"]).trim().replace(/[\\/]v\d+$/, "");
try {
  console.log(run(process.execPath, ["scripts/check-release-plan.mjs"]).trim());
  console.log(run("pnpm", ["exec", "turbo", "run", "build", `--filter=${name}`]).trim());
  console.log(run(process.execPath, ["scripts/check-distribution.mjs"]).trim());
  const cwd = join(root, "packages/forma");
  const archive = join(temporary, "forma.tgz");
  run("pnpm", ["pack", "--out", archive], cwd);
  const entries = run("tar", ["-tzf", archive]).trim().split("\n");
  const packed = JSON.parse(run("tar", ["-xOzf", archive, "package/package.json"]));
  assert.equal(packed.name, name);
  assert.equal(packed.version, JSON.parse(await readFile(join(cwd, "package.json"), "utf8")).version);
  assert.equal(packed.engines.node, ">=24");
  assert.equal(packed.peerDependencies.effect, "^4.1.1");
  assert.equal(packed.peerDependencies["@modelcontextprotocol/sdk"], "1.32.2");
  assert(!packed.dependencies || Object.keys(packed.dependencies).length === 0);
  for (const dependency of Object.keys(packed.peerDependencies).filter(name => name !== "effect")) {
    assert.equal(packed.peerDependenciesMeta[dependency]?.optional, true, dependency);
  }
  assert.equal(packed.publishConfig.access, "public");
  assert.equal(packed.repository.url, "git+https://github.com/bjacobso/forma.git");
  assert(!/@formalang\/|workspace:/.test(JSON.stringify(packed)), "private reference in manifest");
  for (const target of [packed.main, packed.types, ...targets(packed.exports), ...targets(packed.bin)]) {
    assert(entries.includes(`package/${target.replace(/^\.\//, "")}`), `missing target ${target}`);
  }
  for (const file of ["README.md", "LICENSE"]) assert(entries.includes(`package/${file}`));
  for (const entry of entries) {
    assert(/^package\/(dist\/[^\n]+|package.json|README.md|LICENSE)$/.test(entry), `unexpected archive entry ${entry}`);
    if (!/\.(?:mjs|mts|json)$/.test(entry)) continue;
    const source = run("tar", ["-xOzf", archive, entry]);
    assert(!/@formalang\/|["'`]workspace:[*^~.\/]|(?:from\s*|import\s*\()["'][^"']*(?:\/src\/|packages\/)/.test(source), `private/source reference in ${entry}`);
  }
  const consumer = join(temporary, "consumer");
  await mkdir(consumer);
  // Reproduce the tested dependency closure offline. Cached registry metadata can
  // otherwise select newer range-compatible tarballs that are not in the store.
  const trees = JSON.parse(run("pnpm", ["list", "--filter", "@formalang/host", "--filter", "@formalang/editor", "--filter", "@formalang/language-server", "--prod", "--depth", "Infinity", "--json"]));
  const overrides = {};
  const collect = tree => {
    for (const [dependency, value] of Object.entries(tree.dependencies ?? {})) {
      if (!dependency.startsWith("@formalang/")) overrides[dependency] = value.version;
      collect(value);
    }
  };
  trees.forEach(collect);
  await writeFile(join(consumer, "package.json"), JSON.stringify({ private: true, type: "module", pnpm: { overrides } }));
  const tools = Object.entries(packed.peerDependencies)
    .filter(([name]) => !["effect", "react", "react-dom"].includes(name))
    .map(([name, range]) => `${name}@${range}`);
  run("pnpm", ["add", "--store-dir", store, "--prefer-offline", "--ignore-scripts", "--config.auto-install-peers=false", archive, "effect@4.1.1", ...tools], consumer);
  const installed = JSON.parse(run("pnpm", ["list", "--prod", "--depth", "Infinity", "--json"], consumer));
  const packages = new Map();
  const measure = tree => {
    for (const [name, dependency] of Object.entries(tree.dependencies ?? {})) {
      packages.set(`${name}@${dependency.version}`, dependency.path);
      measure(dependency);
    }
  };
  installed.forEach(measure);
  let bytes = 0;
  const size = async directory => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name === "node_modules") continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await size(path);
      else if (entry.isFile()) bytes += (await stat(path)).size;
    }
  };
  for (const path of new Set(packages.values())) await size(path);
  console.log(`Tooling consumer: ${packages.size} packages, ${bytes} installed file bytes (excluding node_modules links and metadata)`);
  const inert = Object.keys(packed.exports).filter(key => key !== "./editor/react").map(key => name + (key === "." ? "" : key.slice(1)));
  await writeFile(join(consumer, "smoke.mjs"), `
    import assert from 'node:assert/strict';
    import { createRequire } from 'node:module';
    import { fileURLToPath } from 'node:url';
    const require = createRequire(import.meta.url);
    assert.throws(() => require.resolve('react'));
    for (const specifier of ${JSON.stringify(inert)}) await import(specifier);
    for (const subpath of ['session', 'evaluator', 'host/ts-host', 'authoring']) {
      await assert.rejects(import('${name}/' + subpath), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' });
    }
    const { createLanguage } = await import('${name}');
    const language = await createLanguage();
    try { assert.equal((await language.run('(+ 20 22)')).value, 42); }
    finally { await language.close(); }
    const libraryRequire = createRequire(import.meta.resolve('${name}'));
    assert.equal(libraryRequire.resolve('effect'), require.resolve('effect'));
    const { Client } = await import(libraryRequire.resolve('@modelcontextprotocol/sdk/client/index.js'));
    const { StdioClientTransport } = await import(libraryRequire.resolve('@modelcontextprotocol/sdk/client/stdio.js'));
    const client = new Client({ name: 'packed-smoke', version: '1.0.0' });
    try {
      await client.connect(new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('./cli.mjs', import.meta.resolve('${name}'))), 'mcp'] }));
      assert((await client.listTools()).tools.some(tool => tool.name === 'check'));
      assert.equal((await client.callTool({ name: 'run', arguments: { source: '(+ 1 2)' } })).structuredContent.printed, '3');
    } finally { await client.close(); }
    const { createDefaultLanguageHost } = await import('${name}');
    const host = createDefaultLanguageHost();
    assert.equal((await host.version()).engineVersion, '${packed.version}');
    assert.equal(host.parseSync({ source: '1' }).diagnostics.length, 0);
    assert.equal(host.typecheckSync({ source: '(+ 1 2)' }).diagnostics.length, 0);
    assert(host.typecheckSync({ source: '(+ 1 true)' }).diagnostics.length > 0);
    assert.equal((await host.evaluate({ source: '(+ 1 2)' })).value.value, 3);
    const { FormaWorkspace } = await import('${name}/language-server');
    const workspace = new FormaWorkspace({ preludePaths: [] });
    for (const [source, expectedType] of [['1', 'Int'], ['1.0', 'Float']]) {
      workspace.analysis.setDocument('numeric-smoke', source);
      assert.equal(workspace.analysis.analysis('numeric-smoke').resultType, expectedType);
    }
    console.log('All non-React exports imported without React; shared Effect and version verified');
  `);
  console.log(run(process.execPath, ["smoke.mjs"], consumer).trim());
  const declarations = `
    import { createDefaultLanguageHost, type LanguageHost, type ParseRequest } from '${name}';
    import type { LanguageHost as Host } from '${name}/host/types';
    import type { ParseRequest as EngineParseRequest } from '${name}/engine';
    import { createDefaultEditorAnalysisHost } from '${name}/editor';
    import * as CodeMirror from '${name}/editor/codemirror';
    const host: Host = createDefaultLanguageHost();
    const same: LanguageHost = host;
    const request: ParseRequest = {} as EngineParseRequest;
    void [same, request, CodeMirror, createDefaultEditorAnalysisHost];
  `;
  await writeFile(join(consumer, "consumer.mts"), declarations);
  const tsc = join(root, "node_modules/typescript/bin/tsc");
  for (const mode of ["NodeNext", "Bundler"]) {
    run(process.execPath, [tsc, "--noEmit", "--strict", "--skipLibCheck", "false", "--target", "es2022", "--module", mode === "Bundler" ? "esnext" : "NodeNext", "--moduleResolution", mode, "consumer.mts"], consumer);
  }
  for (const [bin, arg] of [["forma", "help"], ["forma-language-server", "--help"]]) {
    const path = join(consumer, "node_modules/.bin", bin);
    assert(existsSync(path));
    assert(run(path, [arg], consumer).includes(bin));
  }
  const version = JSON.parse(run(join(consumer, "node_modules/.bin/forma"), ["version"], consumer));
  assert(JSON.stringify(version).includes(packed.version));
  const forma = join(consumer, "node_modules/.bin/forma");
  for (const [library, source, expected] of [
    ["kernel", '(import "forma:kernel" [and not]) (and true (not false))', "true"],
    ["clojure", '(import "forma:clojure" [defn ->]) (defn inc [n] (+ n 1)) (-> 41 (inc))', "42"],
    ["routes", '(import "forma:routes" [route]) (route user ["users" [:id]]) (user {:id "ada"})', '"/users/ada"'],
    ["test", '(import "forma:test" [test is=]) (test "bundled" (is= 42 42))', undefined],
  ]) {
    const path = join(consumer, `${library}-test.lisp`);
    await writeFile(path, source);
    run(forma, ["check", path], consumer);
    if (expected !== undefined) assert.equal(run(forma, ["run", path], consumer).trim(), expected);
    else assert.match(run(forma, ["test", path], consumer), /PASS bundled/);
  }
  run("pnpm", ["add", "--store-dir", store, "--prefer-offline", "--ignore-scripts", "--config.auto-install-peers=false",
    `@codemirror/state@${packed.peerDependencies["@codemirror/state"]}`,
    `@codemirror/view@${packed.peerDependencies["@codemirror/view"]}`], consumer);
  run(process.execPath, ["--input-type=module", "-e", `
    import { EditorState } from '@codemirror/state';
    import { lispSupport } from '${name}/editor/codemirror';
    EditorState.create({ doc: '(+ 1 2)', extensions: [lispSupport()] });
  `], consumer);
  run("pnpm", ["add", "--store-dir", store, "--prefer-offline", "--ignore-scripts", "--config.auto-install-peers=false", `react@${overrides.react}`, `react-dom@${overrides["react-dom"]}`], consumer);
  run(process.execPath, ["--input-type=module", "-e", `await import('${name}/editor/react')`], consumer);
  console.log(`Packed ${name}: ${entries.length} files; all exports, declarations and both bins verified`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}

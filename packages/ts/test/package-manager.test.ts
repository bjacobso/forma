import { execFileSync } from "node:child_process";
import { realpathSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { gzipSync, gunzipSync } from "node:zlib";
import { afterEach, describe, expect, test, vi } from "vitest";
import { managePackages, verifyPackages } from "../src/Node.js";
import { gitSource, extractPackageArchive } from "../src/node/package-fetch.js";
import { compareVersions, semver, type FormaManifest } from "../src/node/package-files.js";

const temporary: string[] = [];
const temp = () => { const root = realpathSync(mkdtempSync(join(tmpdir(), "forma-vendor-test-"))); temporary.push(root); return root; };
afterEach(() => { for (const root of temporary.splice(0)) rmSync(root, { recursive: true, force: true }); });
const write = (root: string, path: string, value: unknown) => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), typeof value === "string" ? value : JSON.stringify(value, null, 2) + "\n");
};
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
function repository(name: string) {
  const root = temp(), bare = join(root, "remote.git"), work = join(root, "work");
  git(root, "init", "--bare", bare);
  mkdirSync(work);
  git(work, "init", "-b", "main");
  git(work, "config", "user.email", "test@example.invalid");
  git(work, "config", "user.name", "Package Test");
  git(work, "remote", "add", "origin", bare);
  const source = (ref: string) => `git+${pathToFileURL(bare).href}@${ref}`;
  const release = (ref: string, dependencies: Record<string, string> = {}, extra: Record<string, string> = {}) => {
    write(work, "forma.json", { name, version: ref.replace(/^v/, ""), exports: { ".": "src/index.lisp" }, dependencies });
    write(work, "src/index.lisp", "(export answer) (define answer 42)");
    write(work, "unused.lisp", `(export unused) (define unused ${JSON.stringify(ref)})`);
    write(work, "README.md", "not vendored");
    for (const [path, text] of Object.entries(extra)) write(work, path, text);
    git(work, "add", ".");
    git(work, "commit", "--allow-empty", "-m", ref);
    if (ref !== "main") git(work, "tag", ref);
    git(work, "push", "origin", "main", "--tags");
    return git(work, "rev-parse", "HEAD");
  };
  return { source, release, work, bare };
}
const app = (dependencies: Record<string, string> = {}) => {
  const root = temp();
  write(root, "forma.json", { name: "app", exports: {}, dependencies });
  return root;
};
const lockText = (root: string) => readFileSync(join(root, "forma.lock"), "utf8");

describe("explicit dependency commands (local git only)", () => {
  test("add vendors the whole package, locks exact commits, and produces deterministic JSON", async () => {
    const util = repository("@acme/util"), commit = util.release("v1.0.0");
    const root = app();
    const lock = await managePackages({ command: "add", name: "@acme/util", source: util.source("v1.0.0") }, root);
    expect(JSON.parse(readFileSync(join(root, "forma.json"), "utf8")).dependencies).toEqual({ "@acme/util": util.source("v1.0.0") });
    expect(lock.packages["@acme/util"]).toMatchObject({ source: util.source("v1.0.0"), resolved: "v1.0.0", commit });
    expect(Object.keys(lock.packages["@acme/util"]!.files)).toEqual(["forma.json", "src/index.lisp", "unused.lisp"]);
    expect(readdirSync(join(root, "vendor/@acme/util"))).toEqual(["forma.json", "src", "unused.lisp"]);
    expect(verifyPackages(root).table.packages.map(p => p.name)).toEqual(["@acme/util"]);
    const first = lockText(root);
    await managePackages({ command: "update" }, root);
    expect(lockText(root)).toBe(first);
    expect(readdirSync(root).some(name => name.startsWith(".forma-"))).toBe(false);
  }, 30_000);

  test("MVS visits lower-version requirements, selects highest minima, and terminates dependency cycles", async () => {
    const core = repository("core"), a = repository("a"), b = repository("b");
    core.release("v1.0.0"); core.release("v3.0.0");
    a.release("v1.0.0", { core: core.source("v3.0.0") });
    a.release("v2.0.0", { core: core.source("v1.0.0"), b: b.source("v1.0.0") });
    b.release("v1.0.0", { a: a.source("v2.0.0") });
    const root = app({ a: a.source("v1.0.0"), b: b.source("v1.0.0") });
    const lock = await managePackages({ command: "update" }, root);
    expect(Object.keys(lock.packages)).toEqual(["a", "b", "core"]);
    expect(lock.packages.a!.resolved).toBe("v2.0.0");
    expect(lock.packages.core!.resolved).toBe("v3.0.0");
    expect(verifyPackages(root).table.packages).toHaveLength(3);
  }, 30_000);

  test.each(["branches", "mixed", "locations"])("reject %s conflicts without changing project files", async kind => {
    const core = repository("core"), other = repository("core"), a = repository("a");
    core.release("v1.0.0"); core.release("v2.0.0"); core.release("other"); other.release("v1.0.0");
    const conflicting = kind === "branches" ? core.source("other") : kind === "mixed" ? core.source("main") : other.source("v1.0.0");
    a.release("v1.0.0", { core: conflicting });
    const root = app({ core: core.source(kind === "branches" ? "main" : "v1.0.0") });
    await managePackages({ command: "update" }, root);
    const before = lockText(root), manifest = readFileSync(join(root, "forma.json"), "utf8");
    await expect(managePackages({ command: "add", name: "a", source: a.source("v1.0.0") }, root)).rejects.toMatchObject({ diagnostic: { code: "module/package-version-conflict" } });
    expect(lockText(root)).toBe(before);
    expect(readFileSync(join(root, "forma.json"), "utf8")).toBe(manifest);
    expect(verifyPackages(root).table.packages).toHaveLength(1);
  }, 30_000);

  test("targeted update refreshes one moving ref and preserves unrelated commits", async () => {
    const a = repository("a"), b = repository("b");
    const a1 = a.release("main"), b1 = b.release("main");
    const root = app({ a: a.source("main"), b: b.source("main") });
    await managePackages({ command: "update" }, root);
    const a2 = a.release("main"), b2 = b.release("main");
    expect(a2).not.toBe(a1); expect(b2).not.toBe(b1);
    const updated = await managePackages({ command: "update", name: "a" }, root);
    expect(updated.packages.a!.commit).toBe(a2);
    expect(updated.packages.b!.commit).toBe(b1);
    const all = await managePackages({ command: "update" }, root);
    expect(all.packages.b!.commit).toBe(b2);
  }, 30_000);

  test("vendor restores exact locked commits after refs move and refuses hash tampering", async () => {
    const util = repository("util"); util.release("main");
    const root = app({ util: util.source("main") });
    const locked = await managePackages({ command: "update" }, root), original = lockText(root);
    util.release("main");
    rmSync(join(root, "vendor"), { recursive: true });
    await managePackages({ command: "vendor" }, root);
    expect(lockText(root)).toBe(original);
    expect(verifyPackages(root).table.packages).toHaveLength(1);
    const edited = { ...locked, packages: { util: { ...locked.packages.util!, files: { ...locked.packages.util!.files, "unused.lisp": "a".repeat(64) } } } };
    write(root, "forma.lock", edited);
    await expect(managePackages({ command: "vendor" }, root)).rejects.toMatchObject({ diagnostic: { code: "module/package-integrity" } });
    expect(readFileSync(join(root, "vendor/util/unused.lisp"), "utf8")).toContain('"main"');
  }, 30_000);

  test("local monorepo dependencies resolve relative to each declaring manifest", async () => {
    const root = app({ a: "./packages/a", shared: "./packages/shared" });
    write(root, "packages/a/forma.json", { name: "a", exports: {}, dependencies: { shared: "../shared" } });
    write(root, "packages/shared/forma.json", { name: "shared", exports: { ".": "index.lisp" } });
    write(root, "packages/shared/index.lisp", "(export answer) (define answer 42)");
    const fetcher = { fetch: vi.fn(() => { throw new Error("must stay offline"); }) };
    const lock = await managePackages({ command: "update" }, root, { fetcher });
    expect(lock.packages.shared).toMatchObject({ commit: null, resolved: "local" });
    expect(verifyPackages(root).directories.get("shared")).toBe(join(root, "packages/shared"));
    write(root, "packages/shared/index.lisp", "(export answer) (define answer 43)");
    expect(() => verifyPackages(root)).toThrow();
    await expect(managePackages({ command: "vendor" }, root, { fetcher })).rejects.toThrow();
    await managePackages({ command: "update" }, root, { fetcher });
    expect(verifyPackages(root).table.packages).toHaveLength(2);
    expect(fetcher.fetch).not.toHaveBeenCalled();
  }, 30_000);

  test("identity mismatches, missing exports, bad refs, and fetch failures leave add unapplied", async () => {
    const util = repository("util"); util.release("v1.0.0");
    const root = app(), original = readFileSync(join(root, "forma.json"), "utf8");
    await expect(managePackages({ command: "add", name: "alias", source: util.source("v1.0.0") }, root)).rejects.toMatchObject({ diagnostic: { code: "module/package-name" } });
    await expect(managePackages({ command: "add", name: "util", source: util.source("missing") }, root)).rejects.toMatchObject({ diagnostic: { code: "module/package-fetch" } });
    await expect(managePackages({ command: "add", name: "util", source: util.source("--upload-pack=evil") }, root)).rejects.toMatchObject({ diagnostic: { code: "module/package-source" } });
    expect(readFileSync(join(root, "forma.json"), "utf8")).toBe(original);
    expect(existsSync(join(root, "forma.lock"))).toBe(false);
    expect(existsSync(join(root, "vendor"))).toBe(false);
    write(root, "local/forma.json", { name: "util", exports: { ".": "missing.lisp" } } satisfies FormaManifest);
    await expect(managePackages({ command: "add", name: "util", source: "./local" }, root)).rejects.toMatchObject({ diagnostic: { code: "module/package-manifest" } });
  }, 30_000);

  test("failed publication restores the previous manifest, lock, and vendor tree", async () => {
    const util = repository("util"); util.release("v1.0.0");
    const root = app({ util: util.source("v1.0.0") });
    await managePackages({ command: "update" }, root);
    const manifest = readFileSync(join(root, "forma.json"), "utf8"), lock = lockText(root);
    const fetched = temp(), a = join(fetched, "a"), b = join(fetched, "b");
    const source = (name: string) => `git+${pathToFileURL(join(fetched, name + ".git")).href}@main`;
    write(a, "forma.json", { name: "a", exports: {}, dependencies: { b: source("b") } });
    write(a, "unused.lisp", "original");
    write(b, "forma.json", { name: "b", exports: {} });
    const fetcher = { fetch: async (spec: string) => {
      if (spec === source("b")) write(a, "unused.lisp", "changed after hashing");
      return { directory: spec === source("a") ? a : b, commit: "a".repeat(40) };
    } };
    await expect(managePackages({ command: "add", name: "a", source: source("a") }, root, { fetcher }))
      .rejects.toMatchObject({ diagnostic: { code: "module/package-integrity" } });
    expect(readFileSync(join(root, "forma.json"), "utf8")).toBe(manifest);
    expect(lockText(root)).toBe(lock);
    expect(verifyPackages(root).table.packages.map(pkg => pkg.name)).toEqual(["util"]);
    expect(readdirSync(root).some(name => name.startsWith(".forma-"))).toBe(false);
  }, 30_000);

  test("concurrent manifest edits survive without publishing fetched results", async () => {
    const root = app(), fetched = temp();
    write(fetched, "forma.json", { name: "util", exports: {} });
    const edit = JSON.stringify({ name: "app", exports: {}, version: "new edit" });
    const fetcher = { fetch: async () => {
      write(root, "forma.json", edit);
      return { directory: fetched, commit: "a".repeat(40) };
    } };
    await expect(managePackages({ command: "add", name: "util", source: "github.com/acme/util@v1.0.0" }, root, { fetcher }))
      .rejects.toMatchObject({ diagnostic: { code: "module/package-busy" } });
    expect(readFileSync(join(root, "forma.json"), "utf8")).toBe(edit);
    expect(existsSync(join(root, "forma.lock"))).toBe(false);
    expect(existsSync(join(root, "vendor"))).toBe(false);
    expect(readdirSync(root).some(name => name.startsWith(".forma-"))).toBe(false);
  }, 30_000);

  test("short commit refs resolve through git and fetched relative dependencies fail explicitly", async () => {
    const util = repository("util"), commit = util.release("v1.0.0");
    const root = app({ util: util.source(commit.slice(0, 9)) });
    expect((await managePackages({ command: "update" }, root)).packages.util!.commit).toBe(commit);
    util.release("v2.0.0", { child: "../child" });
    await expect(managePackages({ command: "add", name: "util", source: util.source("v2.0.0") }, root)).rejects.toMatchObject({ diagnostic: { code: "module/package-source" } });
    expect(verifyPackages(root).table.packages).toHaveLength(1);
  }, 30_000);
});

describe("transport mapping and semver", () => {
  test.each([
    ["github.com/acme/util@v1.0.0", "https://codeload.github.com/acme/util/tar.gz/abc"],
    ["gitlab.com/group/team/util@v1.0.0", "https://gitlab.com/group/team/util/-/archive/abc/util-abc.tar.gz"],
    ["codeberg.org/acme/util@v1.0.0", "https://codeberg.org/acme/util/archive/abc.tar.gz"],
    ["bitbucket.org/acme/util@v1.0.0", "https://bitbucket.org/acme/util/get/abc.tar.gz"],
  ])("maps %s without fetching", (source, archive) => {
    expect(gitSource(source).archive!("abc")).toBe(archive);
    expect(gitSource(source).url).toMatch(/^https:.*\.git$/);
  }, 30_000);
  test("arbitrary git servers and SSH usernames use git", () => {
    expect(gitSource("git+ssh://git@git.corp.example/rules.git@main")).toEqual({ url: "ssh://git@git.corp.example/rules.git", ref: "main" });
    expect(gitSource("git+https://example.invalid/rules.git@v1.0.0").archive).toBeUndefined();
    expect(() => gitSource("example.invalid/owner/repo@v1.0.0")).toThrow();
  }, 30_000);
  test("semver orders prereleases numerically, releases last, ignores build metadata", () => {
    const versions = ["v1.0.0-alpha", "v1.0.0-alpha.1", "v1.0.0-alpha.2", "v1.0.0-alpha.10", "v1.0.0-beta", "v1.0.0", "v2.0.0"];
    expect([...versions].reverse().sort(compareVersions)).toEqual(versions);
    expect(compareVersions("v1.0.0+build.2", "1.0.0+build.1")).toBe(0);
    expect(semver("v1.0.0-01")).toBeUndefined();
    expect(semver("^1.0.0")).toBeUndefined();
  }, 30_000);
  test("archives extract regular package files and reject links and traversal", async () => {
    const root = temp();
    write(root, "repo/forma.json", { name: "util", exports: {} });
    const archive = join(root, "safe.tar.gz");
    execFileSync("tar", ["-czf", archive, "-C", root, "repo"]);
    await extractPackageArchive(archive, join(root, "extracted"));
    expect(existsSync(join(root, "extracted/forma.json"))).toBe(true);
    symlinkSync("../../outside", join(root, "repo/escape.lisp"));
    execFileSync("tar", ["-czf", join(root, "links.tar.gz"), "-C", root, "repo"]);
    await expect(extractPackageArchive(join(root, "links.tar.gz"), join(root, "bad"))).rejects.toThrow();
    // Rewrite a regular tar header directly: GNU tar's --transform is absent
    // from macOS bsdtar. Keep a valid checksum so rejection tests traversal.
    execFileSync("tar", ["-czf", join(root, "escape.tar.gz"), "-C", root, "repo/forma.json"]);
    const tar = gunzipSync(readFileSync(join(root, "escape.tar.gz")));
    expect([0, 48]).toContain(tar[156]); // NUL or '0': a regular file, not a metadata header.
    tar.fill(0, 0, 100);
    tar.write("../outside/forma.json", 0);
    tar.fill(32, 148, 156);
    const checksum = tar.subarray(0, 512).reduce((sum, byte) => sum + byte, 0);
    tar.write(checksum.toString(8).padStart(6, "0") + "\0 ", 148);
    writeFileSync(join(root, "escape.tar.gz"), gzipSync(tar));
    await expect(extractPackageArchive(join(root, "escape.tar.gz"), join(root, "bad"))).rejects.toThrow();
    expect(existsSync(join(root, "bad"))).toBe(false);
  }, 30_000);
});

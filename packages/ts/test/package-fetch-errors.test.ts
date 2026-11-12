import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, expect, test, vi } from "vitest";
import { defaultPackageFetcher, extractPackageArchive } from "../src/node/package-fetch.js";
import { ModuleError } from "../src/modules/graph.js";

const roots: string[] = [];
const temp = () => { const root = mkdtempSync(join(tmpdir(), "forma-fetch-errors-")); roots.push(root); return root; };
afterEach(() => {
  vi.unstubAllGlobals();
  for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true});
});

test("git destination filesystem failures retain the package-fetch code", async () => {
  const root = temp();
  const destination = join(root, "file");
  writeFileSync(destination, "occupied");
  const result = defaultPackageFetcher.fetch(`git+${pathToFileURL(join(root, "remote.git")).href}@main`, destination);
  await expect(result).rejects.toBeInstanceOf(ModuleError);
  await expect(result).rejects.toMatchObject({diagnostic: {code: "module/package-fetch"}});
});

test("archive write failures retain the package-fetch code", async () => {
  const root = temp();
  vi.stubGlobal("fetch", vi.fn(async () => new Response("archive bytes")));
  const result = defaultPackageFetcher.fetch("github.com/example/repository@main", join(root, "missing", "destination"), "a".repeat(40));
  await expect(result).rejects.toBeInstanceOf(ModuleError);
  await expect(result).rejects.toMatchObject({diagnostic: {code: "module/package-fetch"}});
});

test("archive extraction filesystem failures retain the package-fetch code", async () => {
  const root = temp();
  writeFileSync(join(root, "entry"), "content");
  const archive = join(root, "archive.tar.gz");
  execFileSync("tar", ["-czf", archive, "-C", root, "entry"]);
  const destination = join(root, "file");
  writeFileSync(destination, "occupied");
  const result = extractPackageArchive(archive, destination);
  await expect(result).rejects.toBeInstanceOf(ModuleError);
  await expect(result).rejects.toMatchObject({diagnostic: {code: "module/package-fetch"}});
});

import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Count installed package instances and sum their compressed registry tarballs.
// The local Forma archive contributes its actual compressed size. Run the same
// script on the before and after archives; no workspace resolution or overrides.
const archive = resolve(process.argv[2] ?? "");
if (!process.argv[2]) throw new Error("Usage: node scripts/measure-install.mjs <forma.tgz>");
const temporary = await mkdtemp(join(tmpdir(), "forma-measure-"));
const run = args => execFileSync("npm", args, {
  cwd: temporary, encoding: "utf8", timeout: 600_000, maxBuffer: 16 * 1024 * 1024,
  stdio: ["ignore", "pipe", "pipe"],
});
try {
  await writeFile(join(temporary, "package.json"), JSON.stringify({ private: true, type: "module" }));
  run(["install", "--prefer-offline", "--ignore-scripts", "--no-audit", "--no-fund", archive, "effect@4.1.1"]);
  const lock = JSON.parse(await readFile(join(temporary, "package-lock.json"), "utf8"));
  const packages = Object.entries(lock.packages).filter(([path]) => path !== "");
  const sizes = new Map();
  let bytes = 0;
  for (const [path, entry] of packages) {
    if (path === "node_modules/@forma-language/forma") {
      bytes += (await stat(archive)).size;
      continue;
    }
    const manifest = JSON.parse(await readFile(join(temporary, path, "package.json"), "utf8"));
    const key = `${manifest.name}@${entry.version}`;
    if (!sizes.has(key)) {
      const [packed] = JSON.parse(run(["pack", "--prefer-offline", "--ignore-scripts", "--json", key]));
      sizes.set(key, packed.size);
      await rm(join(temporary, packed.filename));
    }
    bytes += sizes.get(key);
  }
  console.log(`packages=${packages.length} bytes=${bytes}`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}

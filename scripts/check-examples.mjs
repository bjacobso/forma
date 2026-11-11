import { execFileSync } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const temporary = await mkdtemp(join(tmpdir(), "forma-examples-"));
const run = (command, args, cwd = root) => {
  try {
    return execFileSync(command, args, { cwd, encoding: "utf8", timeout: 180_000, stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    console.error(error.stdout?.toString(), error.stderr?.toString());
    throw error;
  }
};
try {
  console.log(run("pnpm", ["exec", "turbo", "run", "build", "--filter=@forma-language/forma"]).trim());
  const archive = join(temporary, "forma.tgz");
  run("pnpm", ["pack", "--out", archive], join(root, "packages/forma"));
  const store = run("pnpm", ["store", "path"]).trim().replace(/[\\/]v\d+$/, "");
  // Pin the installed dependency closure, as in check-packages.mjs: cached
  // metadata may select newer versions whose tarballs are unavailable offline.
  const trees = JSON.parse(run("pnpm", ["list", "--filter", "@formalang/editor", "--filter", "@formalang/language-server", "--prod", "--depth", "Infinity", "--json"]));
  const overrides = {};
  const collect = tree => {
    for (const [name, value] of Object.entries(tree.dependencies ?? {})) {
      if (!name.startsWith("@formalang/")) overrides[name] = value.version;
      collect(value);
    }
  };
  trees.forEach(collect);
  for (const example of ["embed-node", "project"]) {
    const cwd = join(temporary, example);
    await cp(join(root, "examples", example), cwd, { recursive: true, filter: path => !path.split(/[\\/]/).includes("node_modules") });
    const manifest = JSON.parse(await readFile(join(cwd, "package.json"), "utf8"));
    manifest.dependencies["@forma-language/forma"] = `file:${archive}`;
    manifest.pnpm = { overrides };
    await writeFile(join(cwd, "package.json"), JSON.stringify(manifest));
    run("pnpm", ["install", "--store-dir", store, "--offline", "--ignore-scripts", "--config.auto-install-peers=false"], cwd);
    console.log(run("pnpm", ["test"], cwd).trim());
    if (example === "embed-node") {
      console.log(run("pnpm", ["start"], cwd).trim());
      // Exercise the public generator subpaths with the same installed tarball.
      const http = join(cwd, "http-rpc");
      await cp(join(root, "examples/http-rpc"), http, { recursive: true, filter: path => !path.split(/[\\/]/).includes("node_modules") });
      console.log(run(process.execPath, ["generate.mjs", "--check"], http).trim());
      console.log(run(process.execPath, ["--test", "generate.test.mjs"], http).trim());
    }
    console.log(`Packed distribution example passed: ${example}`);
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}

import { execFileSync, spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
// Layout fixtures intentionally contain unformatted input and non-default widths.
// Reader error fixtures must retain the exact bytes pinned by their diagnostics.
const excluded = (path) => /^conformance\/fixtures\/reader\/[^/]+-error\//.test(path) || path.startsWith("conformance/format/");
const explicit = args.includes("--stdin") || args.some(arg => !arg.startsWith("-"));
const paths = explicit ? [] : execFileSync("git", ["ls-files", "-z", "*.lisp", "*.forma", "*.md"], { cwd: root, encoding: "utf8" }).split("\0").filter(path => path && !excluded(path));
const result = spawnSync(process.execPath, [resolve(root, "packages/host/dist/cli.mjs"), "fmt", ...args, ...paths], { cwd: root, stdio: "inherit" });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;

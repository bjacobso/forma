import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "..");

// Reviewed ceilings, not an updateable snapshot: remove allowances as uses migrate.
export function checkDefineForm(directory = root) {
  const allowlist = JSON.parse(readFileSync(resolve(directory, "scripts/legacy-forms-allowlist.json"), "utf8"));
  for (const [file, count] of Object.entries(allowlist)) {
    if (!Number.isSafeInteger(count) || count < 1) throw new Error(`Invalid legacy allowance for ${file}`);
  }
  const files = execFileSync("git", ["ls-files", "-z", "--cached"], { cwd: directory, encoding: "utf8" }).split("\0").filter(Boolean);
  const failures = [];
  for (const file of new Set(files)) {
    let source;
    try {
      source = readFileSync(resolve(directory, file), "utf8");
    } catch (error) {
      if (error.code === "ENOENT") continue; // Allow tracked files deleted during migration.
      throw error;
    }
    const count = source.split("define-form").length - 1;
    const allowance = Object.hasOwn(allowlist, file) ? allowlist[file] : 0;
    if (count > allowance) failures.push(`${file}: ${count} occurrences exceed allowance ${allowance}`);
  }
  return failures;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const failures = checkDefineForm();
  if (failures.length) {
    console.error(`Legacy define-form usage grew; use form instead:\n${failures.join("\n")}`);
    process.exitCode = 1;
  } else {
    console.log("Legacy form usage stays within the reviewed allowlist.");
  }
}

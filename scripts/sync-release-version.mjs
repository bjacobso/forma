// Keep the documented release version equal to the public manifest.
// `pnpm release:version` runs this after `changeset version`, so a regenerated
// release PR carries matching docs. `checkReleaseVersionDocs` fails when they differ.
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "..");
const semver = String.raw`\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?`;
// Each pattern captures the text before and after the version it anchors.
const targets = [
  ["README.md", [new RegExp(String.raw`(The public distribution is \`@forma-language/forma\` )${semver}()`, "g")]],
  ["packages/forma/README.md", [new RegExp(String.raw`(distribution, version )${semver}()`, "g")]],
  ["docs/publishing.md", [
    new RegExp(String.raw`(\`@forma-language/forma\` \*\*)${semver}(\*\*)`, "g"),
    new RegExp(String.raw`(forma-language-forma-)${semver}(\.tgz)`, "g"),
  ]],
];

export async function manifestVersion() {
  return JSON.parse(await readFile(join(root, "packages/forma/package.json"), "utf8")).version;
}

/** Returns a problem for each target pattern that is missing or names another version. */
export async function checkReleaseVersionDocs(version) {
  version ??= await manifestVersion();
  const problems = [];
  for (const [file, patterns] of targets) {
    const text = await readFile(join(root, file), "utf8");
    for (const pattern of patterns) {
      const matches = [...text.matchAll(pattern)];
      if (matches.length === 0) problems.push(`${file}: no version mention matches ${pattern}`);
      for (const match of matches) {
        const found = match[0].slice(match[1].length, match[0].length - match[2].length);
        if (found !== version) problems.push(`${file}: names ${found}, manifest is ${version}`);
      }
    }
  }
  return problems;
}

export async function syncReleaseVersionDocs(version) {
  version ??= await manifestVersion();
  for (const [file, patterns] of targets) {
    const path = join(root, file);
    let text = await readFile(path, "utf8");
    for (const pattern of patterns) text = text.replace(pattern, (_, before, after) => `${before}${version}${after}`);
    await writeFile(path, text);
  }
  const problems = await checkReleaseVersionDocs(version);
  if (problems.length) throw new Error(`Release version docs are out of sync:\n${problems.join("\n")}`);
  return version;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  if (process.argv.includes("--check")) {
    const problems = await checkReleaseVersionDocs();
    if (problems.length) {
      console.error(`Release version docs are out of sync:\n${problems.join("\n")}\nRun node scripts/sync-release-version.mjs`);
      process.exit(1);
    }
    console.log(`Release version docs name ${await manifestVersion()}`);
  } else {
    console.log(`Release version docs synced to ${await syncReleaseVersionDocs()}`);
  }
}

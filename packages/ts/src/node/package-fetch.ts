/** Git and forge transports. No package-manager or compiler policy here. */
import { execFile } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { promisify } from "node:util";
import { packageError, safeFile, sourceParts } from "./package-files.js";

const execute = promisify(execFile);
async function command(program: string, args: readonly string[], cwd?: string): Promise<string> {
  try {
    return (await execute(program, [...args], { cwd, encoding: "utf8", timeout: 120_000, maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } })).stdout.trim();
  } catch (error) { return packageError("package-fetch", `${program} failed: ${String(error)}`); }
}
export interface PackageFetcher {
  /** Materialize into an unused directory. A supplied commit must be fetched exactly. */
  fetch(source: string, destination: string, commit?: string): Promise<{ directory: string; commit: string }>;
}
export interface GitSource {
  readonly url: string;
  readonly ref: string;
  readonly archive?: (commit: string) => string;
}
/** Pure mapping, also usable by hosts that provide their own transport. */
export function gitSource(source: string): GitSource {
  const { location, ref } = sourceParts(source);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._/+-]*$/.test(ref) || ref.includes("..") || ref.includes("//"))
    return packageError("package-source", `Invalid git ref ${ref}.`);
  if (location.startsWith("git+")) {
    let url: URL;
    try { url = new URL(location.slice(4)); }
    catch { return packageError("package-source", `Invalid git URL ${location}.`); }
    if (!["https:", "ssh:", "file:"].includes(url.protocol) || url.search || url.hash || !url.pathname ||
        (url.protocol !== "file:" && !url.hostname))
      return packageError("package-source", `Unsupported git URL ${location}.`);
    return { url: url.href, ref };
  }
  const [host, ...parts] = location.split("/");
  if (parts.length < 2 || parts.some(part => !/^[a-zA-Z0-9_.-]+$/.test(part) || part === "." || part === ".."))
    return packageError("package-source", `Invalid forge source ${source}.`);
  if (host !== "gitlab.com" && parts.length !== 2)
    return packageError("package-source", `Expected owner/repo in ${source}.`);
  const path = parts.join("/").replace(/\.git$/, "");
  const repo = parts.at(-1)!.replace(/\.git$/, "");
  const url = `https://${host}/${path}.git`;
  switch (host) {
    case "github.com": return { url, ref, archive: commit => `https://codeload.github.com/${path}/tar.gz/${encodeURIComponent(commit)}` };
    case "gitlab.com": return { url, ref, archive: commit => `https://gitlab.com/${path}/-/archive/${encodeURIComponent(commit)}/${repo}-${encodeURIComponent(commit)}.tar.gz` };
    case "codeberg.org": return { url, ref, archive: commit => `https://codeberg.org/${path}/archive/${encodeURIComponent(commit)}.tar.gz` };
    case "bitbucket.org": return { url, ref, archive: commit => `https://bitbucket.org/${path}/get/${encodeURIComponent(commit)}.tar.gz` };
    default: return packageError("package-source", `Unknown forge ${host}; use git+https:// or git+ssh:// with @ref.`);
  }
}
async function gitFetch(source: GitSource, destination: string, pinned?: string): Promise<{ directory: string; commit: string }> {
  mkdirSync(destination, { recursive: true });
  await command("git", ["init", "--quiet", destination]);
  await command("git", ["remote", "add", "origin", source.url], destination);
  const ref = pinned ?? source.ref;
  let revision = "FETCH_HEAD";
  try {
    await command("git", ["fetch", "--quiet", "--depth=1", "origin", ref], destination);
  } catch {
    // Short commit IDs and refs not advertised by the server need repository history.
    await command("git", ["fetch", "--quiet", "origin", "+refs/heads/*:refs/remotes/origin/*", "+refs/tags/*:refs/tags/*"], destination);
    revision = await command("git", ["rev-parse", "--verify", `${ref}^{commit}`], destination);
  }
  const commit = await command("git", ["rev-parse", "--verify", `${revision}^{commit}`], destination);
  if (!/^[a-f0-9]{40,64}$/.test(commit) || (pinned && commit !== pinned))
    return packageError("package-fetch", `Git returned an unexpected commit for ${source.url}.`);
  await command("git", ["checkout", "--quiet", "--detach", commit], destination);
  return { directory: destination, commit };
}
async function forgeCommit(source: GitSource): Promise<string | undefined> {
  if (/^[a-f0-9]{40}$/.test(source.ref)) return source.ref;
  const tag = `refs/tags/${source.ref}`, branch = `refs/heads/${source.ref}`;
  const refs = new Map((await command("git", ["ls-remote", source.url, tag, `${tag}^{}`, branch])).split("\n")
    .filter(Boolean).map(line => { const [commit, ref] = line.split(/\s+/); return [ref!, commit!] as const; }));
  return refs.get(`${tag}^{}`) ?? refs.get(tag) ?? refs.get(branch);
}
/** Validate archive entries before extraction; no links or paths outside one archive root. */
export async function extractPackageArchive(archive: string, destination: string): Promise<void> {
  const entries = (await command("tar", ["-tzf", archive])).split("\n");
  const roots = new Set<string>();
  for (const entry of entries) {
    const path = entry.replace(/\/$/, "");
    if (!safeFile(path)) return packageError("package-fetch", `Unsafe archive path ${entry}.`);
    roots.add(path.split("/")[0]!);
  }
  if (roots.size !== 1) return packageError("package-fetch", "Forge archive must have one root directory.");
  const types = (await command("tar", ["-tvzf", archive])).split("\n");
  if (types.some(line => !["-", "d"].includes(line[0]!)))
    return packageError("package-fetch", "Package archives may contain only regular files and directories.");
  mkdirSync(destination, { recursive: true });
  await command("tar", ["-xzf", archive, "--directory", destination, "--strip-components=1", "--no-same-owner", "--no-same-permissions"]);
}
export const defaultPackageFetcher: PackageFetcher = {
  async fetch(spec, destination, pinned) {
    const source = gitSource(spec);
    if (pinned !== undefined && !/^[a-f0-9]{40,64}$/.test(pinned))
      return packageError("package-source", "Pinned commits must be full git commit IDs.");
    if (source.archive) {
      let commit: string | undefined;
      try { commit = pinned ?? await forgeCommit(source); } catch { /* git fallback retains native credentials. */ }
      if (commit) {
        let bytes: Uint8Array | undefined;
        try {
          const response = await fetch(source.archive(commit), { signal: AbortSignal.timeout(30_000) });
          if (response.ok) {
            const chunks: Uint8Array[] = [];
            let size = 0;
            for await (const chunk of response.body!) {
              size += chunk.length;
              if (size > 64 * 1024 * 1024) throw new Error("Archive exceeds 64 MiB.");
              chunks.push(chunk);
            }
            bytes = Buffer.concat(chunks);
          }
        } catch { /* Fall back to git if the archive endpoint is unavailable. */ }
        if (bytes) {
          const archive = destination + ".tar.gz";
          writeFileSync(archive, bytes);
          try { await extractPackageArchive(archive, destination); }
          finally { rmSync(archive, { force: true }); }
          return { directory: destination, commit };
        }
      }
    }
    return gitFetch(source, destination, pinned);
  },
};

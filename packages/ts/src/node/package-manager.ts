/** Explicit dependency commands; compiler entry points never call this module. */
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { defaultPackageFetcher, gitSource, type PackageFetcher } from "./package-fetch.js";
import {
  assertPackageName, compareVersions, findFormaRoot, isLocalSpec, packageError, packageFiles,
  readFormaLock, readFormaManifest, readVendoredPackages, semver, sourceParts, sourceSatisfies, validPackageName,
  type FormaLock, type FormaManifest, type LockedPackage,
} from "./package-files.js";
import { sha256 } from "../source/sha256.js";

export type PackageCommand = { readonly command: "add"; readonly name: string; readonly source: string } |
  { readonly command: "update"; readonly name?: string } | { readonly command: "vendor" };
export interface PackageCommandOptions { readonly fetcher?: PackageFetcher }
const json = (value: unknown): string => JSON.stringify(value, null, 2) + "\n";
const entries = <T>(value: Readonly<Record<string, T>>): [string, T][] => Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
const sameFiles = (a: Readonly<Record<string, string>>, b: Readonly<Record<string, string>>): boolean =>
  json(entries(a)) === json(entries(b));
function projectRoot(start: string): string {
  return findFormaRoot(start) ?? packageError("package-manifest", "No forma.json found at or above the current directory.");
}
export function verifyPackages(start = process.cwd()): ReturnType<typeof readVendoredPackages> {
  return readVendoredPackages(projectRoot(start));
}
interface Candidate {
  readonly source: string;
  readonly directory: string;
  readonly manifest: FormaManifest;
  readonly locked: LockedPackage;
}
function select(name: string, first: Candidate, next: Candidate): Candidate {
  if (isLocalSpec(first.source) || isLocalSpec(next.source)) {
    if (isLocalSpec(first.source) && isLocalSpec(next.source) && first.directory === next.directory) return first;
  } else {
    const a = sourceParts(first.source), b = sourceParts(next.source);
    if (a.location === b.location) {
      if (a.ref === b.ref) return first;
      if (semver(a.ref) && semver(b.ref)) {
        const order = compareVersions(a.ref, b.ref);
        return order > 0 || order === 0 && first.source < next.source ? first : next;
      }
    }
  }
  return packageError("package-version-conflict", `${name} requires conflicting sources ${first.source} and ${next.source}.`);
}
function snapshot(name: string, source: string, directory: string, commit: string | null): Candidate {
  const manifest = readFormaManifest(directory);
  assertPackageName(name, manifest);
  const files = packageFiles(directory);
  for (const path of [...Object.values(manifest.exports), ...(manifest.prelude ? [manifest.prelude] : [])]) {
    if (!Object.hasOwn(files, path.replace(/^\.\//, "")))
      return packageError("package-manifest", `${name} declares missing file ${path}.`);
  }
  return { source, directory, manifest, locked: { source, resolved: isLocalSpec(source) ? "local" : sourceParts(source).ref, commit, files } };
}
/** Stage complete results before replacing any project file; roll back failed publication. */
function publish(root: string, stage: string, candidates: ReadonlyMap<string, Candidate>, lock: FormaLock, manifest: string, writeManifest: boolean): void {
  const vendor = join(stage, "new-vendor");
  mkdirSync(vendor);
  for (const [name, pkg] of candidates) {
    if (isLocalSpec(pkg.source)) continue;
    for (const file of Object.keys(pkg.locked.files)) {
      const target = join(vendor, ...name.split("/"), file);
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(join(pkg.directory, file), target);
    }
  }
  writeFileSync(join(stage, "new-lock"), json(lock));
  if (writeManifest) writeFileSync(join(stage, "new-manifest"), manifest);
  const changes = [["vendor", "new-vendor"], ["forma.lock", "new-lock"], ...(writeManifest ? [["forma.json", "new-manifest"]] : [])];
  const applied: { path: string; backup: string; hadOriginal: boolean; installed: boolean }[] = [];
  try {
    for (const [file, staged] of changes) {
      const path = join(root, file!), backup = join(stage, "old-" + file);
      const state = { path, backup, hadOriginal: existsSync(path), installed: false };
      applied.push(state);
      if (state.hadOriginal) renameSync(path, backup);
      renameSync(join(stage, staged!), path);
      state.installed = true;
    }
    readVendoredPackages(root);
  } catch (error) {
    for (const state of applied.reverse()) {
      if (state.installed) rmSync(state.path, { recursive: true, force: true });
      if (state.hadOriginal && existsSync(state.backup)) renameSync(state.backup, state.path);
    }
    throw error;
  }
}
/** add changes the source map only after fetching succeeds; update refreshes declared refs. */
export async function managePackages(request: PackageCommand, start = process.cwd(), options: PackageCommandOptions = {}): Promise<FormaLock> {
  const root = projectRoot(start);
  const manifestPath = join(root, "forma.json"), lockPath = join(root, "forma.lock");
  const originalManifest = readFileSync(manifestPath, "utf8");
  const originalLock = existsSync(lockPath) ? readFileSync(lockPath, "utf8") : undefined;
  const manifest = readFormaManifest(root);
  if (request.command === "add" && (!validPackageName(request.name) || !request.source))
    return packageError("package-source", "Expected a valid dependency name and source spec.");
  const dependencies = Object.fromEntries(entries({ ...manifest.dependencies,
    ...(request.command === "add" ? { [request.name]: request.source } : {}) }));
  const manifestText = request.command === "add" ? json({ ...JSON.parse(originalManifest), dependencies }) : originalManifest;
  const oldLock = originalLock ? readFormaLock(root) : undefined;
  if (request.command === "vendor" && (!oldLock || oldLock.manifest !== sha256(originalManifest)))
    return packageError("package-stale", "forma vendor requires a lock matching forma.json; run forma update.");
  if (request.command === "update" && request.name && !Object.hasOwn(dependencies, request.name) && !Object.hasOwn(oldLock?.packages ?? {}, request.name))
    return packageError("package-not-found", `No dependency named ${request.name}.`);
  const guard = join(root, ".forma-packages-busy");
  try { writeFileSync(guard, "Dependency command in progress\n", { flag: "wx" }); }
  catch { return packageError("package-busy", `Another dependency command is active (${guard}).`); }
  let stage: string | undefined;
  const fetcher = options.fetcher ?? defaultPackageFetcher;
  try {
    stage = mkdtempSync(join(root, ".forma-stage-"));
    const candidates = new Map<string, Candidate>();
    let counter = 0;
    if (request.command === "vendor") {
      // The lock, rather than mutable tags or branches, is the source of truth.
      const queue = entries(dependencies).map(([name, source]) => ({ name, source, from: root, remote: false }));
      while (queue.length) {
        const { name, source, from, remote } = queue.shift()!;
        const locked = oldLock!.packages[name];
        if (!Object.hasOwn(oldLock!.packages, name) || !locked)
          return packageError("package-stale", `Missing lock entry for ${name}.`);
        if (!(isLocalSpec(source) && isLocalSpec(locked.source)) && !sourceSatisfies(locked.source, source))
          return packageError("package-stale", `${name}: lock does not satisfy ${source}.`);
        if (remote && isLocalSpec(source)) return packageError("package-source", "Relative dependencies inside fetched packages are not supported; declare a git source.");
        const local = isLocalSpec(source) ? realpathSync(resolve(from, source)) : undefined;
        const previous = candidates.get(name);
        if (previous) {
          if (local && previous.directory !== local) return packageError("package-version-conflict", `${name} refers to different local directories.`);
          continue;
        }
        if (isLocalSpec(locked.source) ? locked.commit !== null || locked.resolved !== "local" : locked.commit === null || locked.resolved !== sourceParts(locked.source).ref)
          return packageError("package-stale", `Inconsistent source provenance for ${name}.`);
        const fetched = local ? undefined : await fetcher.fetch(locked.source, join(stage, `fetch-${counter++}`), locked.commit!);
        if (fetched && fetched.commit !== locked.commit) return packageError("package-fetch", `${name}: fetcher did not return the locked commit.`);
        const directory = local ?? fetched!.directory;
        const pkg = snapshot(name, locked.source, directory, locked.commit);
        if (!sameFiles(pkg.locked.files, locked.files)) return packageError("package-integrity", `${name}: fetched or local files differ from forma.lock.`);
        candidates.set(name, pkg);
        for (const [child, spec] of entries(pkg.manifest.dependencies ?? {}))
          queue.push({ name: child, source: spec, from: directory, remote: !local });
      }
      if (candidates.size !== Object.keys(oldLock!.packages).length)
        return packageError("package-stale", "forma.lock contains unreachable packages.");
    } else {
      const queue = entries(dependencies).map(([name, source]) => ({ name, source, from: root, remote: false }));
      const seen = new Set<string>();
      while (queue.length) {
        const requirement = queue.shift()!;
        const { name, from, remote } = requirement;
        let source = requirement.source;
        if (remote && isLocalSpec(source)) return packageError("package-source", "Relative dependencies inside fetched packages are not supported; declare a git source.");
        const local = isLocalSpec(source) ? realpathSync(resolve(from, source)) : undefined;
        if (!local) gitSource(source); // Validate before invoking any custom fetcher.
        const preserved = request.command === "add" ? name !== request.name : request.name !== undefined && name !== request.name;
        const locked = Object.hasOwn(oldLock?.packages ?? {}, name) ? oldLock!.packages[name] : undefined;
        const reuse = !local && preserved && locked && sourceSatisfies(locked.source, source);
        if (reuse) source = locked.source;
        const key = `${name}\0${local ?? source}`;
        if (seen.has(key)) continue;
        seen.add(key);
        let pkg: Candidate;
        if (reuse) {
          const directory = join(root, "vendor", ...name.split("/"));
          if (!sameFiles(packageFiles(directory, true), locked.files))
            return packageError("package-integrity", `${name}: existing vendor files differ from forma.lock; update this package first.`);
          pkg = snapshot(name, source, directory, locked.commit);
        } else if (local) pkg = snapshot(name, source, local, null);
        else {
          const fetched = await fetcher.fetch(source, join(stage, `fetch-${counter++}`));
          pkg = snapshot(name, source, fetched.directory, fetched.commit);
        }
        const previous = candidates.get(name);
        candidates.set(name, previous ? select(name, previous, pkg) : pkg);
        // Visit every encountered minimum, including lower versions. This is MVS,
        // not a solver over the latest manifests only. Seen keys terminate cycles.
        for (const [child, spec] of entries(pkg.manifest.dependencies ?? {}))
          queue.push({ name: child, source: spec, from: pkg.directory, remote: !local });
      }
      // Old-version requirements may raise a selected minimum, but packages no
      // longer reachable from selected manifests are not installed or locked.
      const reachable = new Set<string>();
      const visit = (name: string) => {
        if (reachable.has(name)) return;
        reachable.add(name);
        for (const child of Object.keys(candidates.get(name)!.manifest.dependencies ?? {})) visit(child);
      };
      for (const name of Object.keys(dependencies)) visit(name);
      for (const name of candidates.keys()) if (!reachable.has(name)) candidates.delete(name);
    }
    const lock: FormaLock = request.command === "vendor" ? oldLock! : {
      version: 1, manifest: sha256(manifestText),
      packages: Object.fromEntries([...candidates].sort(([a], [b]) => a < b ? -1 : 1).map(([name, pkg]) => [name, {
        ...pkg.locked, files: Object.fromEntries(entries(pkg.locked.files)),
      }])),
    };
    if (readFileSync(manifestPath, "utf8") !== originalManifest ||
        (existsSync(lockPath) ? readFileSync(lockPath, "utf8") : undefined) !== originalLock)
      return packageError("package-busy", "forma.json or forma.lock changed while fetching; retry the command.");
    publish(root, stage, candidates, lock, manifestText, request.command === "add");
    return lock;
  } finally {
    if (stage) rmSync(stage, { recursive: true, force: true });
    rmSync(guard, { force: true });
  }
}

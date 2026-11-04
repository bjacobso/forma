/** Filesystem boundary for vendored packages. This module never fetches. */
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { ModuleError } from "../modules/graph.js";
import { packageTableErrors, splitPackageSpecifier, type ModulePackage, type PackageTable } from "../modules/packages.js";
import { sha256 } from "../source/sha256.js";

export interface FormaManifest {
  readonly name: string;
  readonly version?: string;
  readonly exports: Readonly<Record<string, string>>;
  readonly prelude?: string;
  readonly dependencies?: Readonly<Record<string, string>>;
}
export interface LockedPackage {
  readonly source: string;
  readonly resolved: string;
  /** Full git commit, or null for a live relative directory. */
  readonly commit: string | null;
  readonly files: Readonly<Record<string, string>>;
}
export interface FormaLock {
  readonly version: 1;
  readonly manifest: string;
  readonly packages: Readonly<Record<string, LockedPackage>>;
}
export interface NodePackages {
  readonly table: PackageTable;
  readonly directories: ReadonlyMap<string, string>;
}
export function packageError(code: string, message: string): never {
  throw new ModuleError({ code: `module/${code}`, severity: "error", phase: "typecheck", message });
}
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const strings = (value: unknown): value is Record<string, string> =>
  record(value) && Object.values(value).every(v => typeof v === "string");
export function validPackageName(name: string): boolean {
  const parsed = splitPackageSpecifier(name);
  return parsed?.name === name && parsed.subpath === ".";
}
export function readPackageJson(path: string): unknown {
  try { return JSON.parse(readFileSync(path, "utf8")); }
  catch (error) { return packageError("package-manifest", `Cannot read ${path}: ${String(error)}`); }
}
export function readFormaManifest(directory: string): FormaManifest {
  const value = readPackageJson(join(directory, "forma.json"));
  if (!record(value) || typeof value.name !== "string" || !validPackageName(value.name) ||
      !strings(value.exports) || (value.version !== undefined && typeof value.version !== "string") ||
      (value.prelude !== undefined && typeof value.prelude !== "string") ||
      (value.dependencies !== undefined && (!strings(value.dependencies) ||
        Object.entries(value.dependencies).some(([name, spec]) => !validPackageName(name) || !spec))))
    return packageError("package-manifest", `Invalid forma.json in ${directory}; expected name, exports, and optional version, prelude, dependencies.`);
  const manifest = value as unknown as FormaManifest;
  const errors = packageTableErrors({ packages: [{ ...manifest, dependencies: Object.keys(manifest.dependencies ?? {}) }] });
  if (errors.length) return packageError("package-manifest", errors.join(" "));
  for (const path of [...Object.values(manifest.exports), ...(manifest.prelude ? [manifest.prelude] : [])]) {
    if (!safeFile(path.replace(/^\.\//, "")) || !path.endsWith(".forma"))
      return packageError("package-manifest", `${manifest.name}: exports and prelude must name .forma files inside the package.`);
  }
  return manifest;
}
export function findFormaRoot(start: string): string | undefined {
  for (let dir = resolve(start); ; dir = dirname(dir)) {
    if (existsSync(join(dir, "forma.json"))) return dir;
    if (dirname(dir) === dir) return undefined;
  }
}
export const isLocalSpec = (spec: string): boolean => spec.startsWith("./") || spec.startsWith("../");
export function safeFile(path: string): boolean {
  return !!path && !path.includes("\\") && !path.includes("\0") &&
    path.split("/").every(part => part !== "" && part !== "." && part !== "..");
}
/** No symlinks: neither hashing nor resolution may read outside a package. */
export function packageFiles(directory: string, vendored = false): Record<string, string> {
  const files: Record<string, string> = Object.create(null);
  const visit = (dir: string, prefix: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : 1)) {
      if ([".git", "node_modules", "vendor"].includes(entry.name) && !vendored) continue;
      const path = prefix + entry.name;
      if (entry.isSymbolicLink()) return packageError("package-integrity", `Symlink ${join(dir, entry.name)} is not a package file.`);
      if (entry.isDirectory()) visit(join(dir, entry.name), path + "/");
      else if (entry.isFile() && (vendored || path === "forma.json" || path.endsWith(".forma")))
        files[path] = sha256(readFileSync(join(directory, path), "utf8"));
      else if (vendored) return packageError("package-integrity", `Unsupported file ${path}.`);
    }
  };
  visit(directory, "");
  return files;
}
export function readFormaLock(root: string): FormaLock {
  if (!existsSync(join(root, "forma.lock"))) return packageError("package-stale", "Missing forma.lock; materialize dependencies before compiling.");
  const value = readPackageJson(join(root, "forma.lock"));
  if (!record(value) || value.version !== 1 || typeof value.manifest !== "string" || !record(value.packages))
    return packageError("package-stale", "Invalid forma.lock format.");
  for (const [name, pkg] of Object.entries(value.packages)) {
    if (!validPackageName(name) || !record(pkg) || typeof pkg.source !== "string" ||
        typeof pkg.resolved !== "string" || !(pkg.commit === null || (typeof pkg.commit === "string" && /^[a-f0-9]{40,64}$/.test(pkg.commit))) ||
        !strings(pkg.files) || !Object.keys(pkg.files).includes("forma.json") ||
        Object.entries(pkg.files).some(([file, hash]) => !safeFile(file) || !/^[a-f0-9]{64}$/.test(hash)))
      return packageError("package-stale", `Invalid lock entry for ${name}.`);
  }
  return value as unknown as FormaLock;
}
export function assertPackageName(name: string, manifest: FormaManifest): void {
  if (manifest.name !== name) packageError("package-name", `Dependency ${name} declares name ${manifest.name} in forma.json.`);
}
/** Verify the entire closure, including unimported files, before returning a table. */
export function readVendoredPackages(root: string): NodePackages {
  const manifest = readFormaManifest(root);
  const dependencies = Object.keys(manifest.dependencies ?? {}).sort();
  if (!existsSync(join(root, "forma.lock")) && dependencies.length === 0) {
    if (existsSync(join(root, "vendor")) && Object.keys(packageFiles(join(root, "vendor"), true)).length)
      return packageError("package-stale", "Vendor files exist without forma.lock.");
    return { table: { packages: [], dependencies }, directories: new Map() };
  }
  const lock = readFormaLock(root);
  if (lock.manifest !== sha256(readFileSync(join(root, "forma.json"), "utf8")))
    return packageError("package-stale", "forma.json has changed since forma.lock was written; update dependencies.");
  const directories = new Map<string, string>();
  const packages = new Map<string, ModulePackage>();
  const visit = (name: string, spec: string, from: string) => {
    const locked = Object.hasOwn(lock.packages, name) ? lock.packages[name] : undefined;
    if (!locked) return packageError("package-stale", `Missing lock entry for ${name}.`);
    if (!(isLocalSpec(locked.source) && isLocalSpec(spec)) && !sourceSatisfies(locked.source, spec)) return packageError("package-stale", `${name}: ${spec} is not satisfied by locked source ${locked.source}.`);
    if (isLocalSpec(locked.source) ? locked.commit !== null || locked.resolved !== "local" : locked.commit === null || locked.resolved !== sourceParts(locked.source).ref)
      return packageError("package-stale", `Inconsistent source provenance for ${name}.`);
    const directory = isLocalSpec(locked.source) ? resolve(from, spec) : join(root, "vendor", ...name.split("/"));
    if (directories.has(name)) {
      if (isLocalSpec(spec) && directories.get(name) !== realpathSync(resolve(from, spec)))
        return packageError("package-version-conflict", `${name} refers to different local directories.`);
      return;
    }
    // Reject symlinks in the path to a vendored package as well as its contents.
    if (!isLocalSpec(locked.source)) {
      let path = root;
      for (const part of ["vendor", ...name.split("/")]) {
        path = join(path, part);
        if (!existsSync(path) || lstatSync(path).isSymbolicLink())
          return packageError("package-integrity", `Missing or symlinked vendor directory ${path}.`);
      }
    }
    if (!existsSync(directory)) return packageError("package-integrity", `Missing package directory ${directory}.`);
    const actual = packageFiles(directory, !isLocalSpec(locked.source));
    for (const file of [...new Set([...Object.keys(actual), ...Object.keys(locked.files)])].sort()) {
      if (actual[file] !== locked.files[file])
        return packageError("package-integrity", `${name}/${file} is missing, extra, or edited relative to forma.lock.`);
    }
    const pkg = readFormaManifest(directory);
    assertPackageName(name, pkg);
    directories.set(name, realpathSync(directory));
    packages.set(name, { name, ...(pkg.version ? { version: pkg.version } : {}), exports: pkg.exports,
      ...(pkg.prelude ? { prelude: pkg.prelude } : {}), dependencies: Object.keys(pkg.dependencies ?? {}).sort() });
    for (const [dependency, source] of Object.entries(pkg.dependencies ?? {}).sort()) visit(dependency, source, directory);
  };
  for (const name of dependencies) visit(name, manifest.dependencies![name]!, root);
  if (Object.keys(lock.packages).some(name => !packages.has(name)))
    return packageError("package-stale", "forma.lock contains unreachable packages; update dependencies.");
  // Also reject files and directories belonging to packages absent from the lock.
  const vendor = join(root, "vendor");
  if (existsSync(vendor)) {
    const expected = new Set([...directories].filter(([name]) => !isLocalSpec(lock.packages[name]!.source))
      .flatMap(([name]) => Object.keys(lock.packages[name]!.files).map(file => `${name}/${file}`)));
    for (const file of Object.keys(packageFiles(vendor, true))) {
      if (!expected.has(file)) return packageError("package-integrity", `Extra vendored file ${file}.`);
    }
  }
  return { table: { packages: [...packages.values()].sort((a, b) => a.name < b.name ? -1 : 1), dependencies }, directories };
}

/** Strict semver tags, including prereleases; ranges are deliberately unsupported. */
export function semver(ref: string): readonly [number, number, number, readonly string[]] | undefined {
  const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(ref);
  if (!match || match[4]?.split(".").some(p => /^\d+$/.test(p) && p.length > 1 && p.startsWith("0"))) return undefined;
  return [Number(match[1]), Number(match[2]), Number(match[3]), match[4]?.split(".") ?? []];
}
export function compareVersions(a: string, b: string): number {
  const x = semver(a)!, y = semver(b)!;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return (x[i] as number) - (y[i] as number);
  const xp = x[3], yp = y[3];
  if (!xp.length || !yp.length) return xp.length ? -1 : yp.length ? 1 : 0;
  for (let i = 0; i < Math.max(xp.length, yp.length); i++) {
    const u = xp[i], v = yp[i];
    if (u === undefined || v === undefined) return u === undefined ? -1 : 1;
    if (u === v) continue;
    const un = /^\d+$/.test(u), vn = /^\d+$/.test(v);
    return un && vn ? Number(u) - Number(v) : un !== vn ? (un ? -1 : 1) : u < v ? -1 : 1;
  }
  return 0;
}
export function sourceParts(spec: string): { location: string; ref: string } {
  const at = spec.lastIndexOf("@");
  if (at <= 0 || at === spec.length - 1) return packageError("package-source", `Expected a git source with @ref, got ${spec}.`);
  return { location: spec.slice(0, at), ref: spec.slice(at + 1) };
}
export function sourceSatisfies(selected: string, requirement: string): boolean {
  if (isLocalSpec(selected) || isLocalSpec(requirement)) return selected === requirement;
  const a = sourceParts(selected), b = sourceParts(requirement);
  return a.location === b.location && (a.ref === b.ref || !!semver(a.ref) && !!semver(b.ref) && compareVersions(a.ref, b.ref) >= 0);
}

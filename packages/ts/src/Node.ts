/** Node-only helpers; browser entry points do not import this module. */
import { readFileSync } from "node:fs";
import {
  bootstrapFromSources,
  type BootstrapOptions,
  type BootstrappedPrelude,
} from "./descriptor/bootstrap.js";

/** Bootstrap descriptors from files, with the same options as source bootstrapping. */
export function bootstrapFromFiles(
  compilerPath: string,
  domainPath: string,
  ...additionalPathsAndOptions: readonly (string | BootstrapOptions)[]
): BootstrappedPrelude {
  return bootstrapFromSources(
    readFileSync(compilerPath, "utf-8"),
    readFileSync(domainPath, "utf-8"),
    ...additionalPathsAndOptions.map((input) =>
      typeof input === "string" ? readFileSync(input, "utf-8") : input,
    ),
  );
}

import { existsSync, realpathSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import {
  ModuleError,
  relativeModuleId,
  resolveModuleGraph,
  type ModuleGraph,
  type ModuleResolver,
} from "./modules/graph.js";
import {
  packageOfModule,
  PACKAGE_ID_PREFIX,
  type ModulePackage,
  type PackageTable,
} from "./modules/packages.js";
/** Relative file imports between files outside installed packages. */
export const fileModuleResolver: ModuleResolver = (specifier, importer) => {
  if (!specifier.startsWith("./") && !specifier.startsWith("../"))
    return undefined;
  try {
    const id = realpathSync(resolve(dirname(importer), specifier));
    return { id, source: readFileSync(id, "utf8") };
  } catch (error) {
    if (
      ["ENOENT", "ENOTDIR"].includes(String((error as { code?: string }).code))
    )
      return undefined;
    throw error;
  }
};

/** Installed Forma packages and the directories they were found in. */
export interface NodePackages {
  readonly table: PackageTable;
  readonly directories: ReadonlyMap<string, string>;
}

interface PackageJson {
  readonly name?: string;
  readonly version?: string;
  readonly dependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
  readonly peerDependencies?: Record<string, string>;
  readonly optionalDependencies?: Record<string, string>;
  readonly forma?: { readonly exports?: Record<string, string>; readonly prelude?: string };
}

const readJson = (path: string): PackageJson => JSON.parse(readFileSync(path, "utf8")) as PackageJson;
const dependencyNames = (manifest: PackageJson, root: boolean): string[] => [
  ...new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
    ...(root ? Object.keys(manifest.devDependencies ?? {}) : []),
  ]),
].sort();

/** The nearest directory at or above `start` that contains a package.json. */
function packageRoot(start: string): string | undefined {
  for (let dir = start; ; dir = dirname(dir)) {
    if (existsSync(join(dir, "package.json"))) return dir;
    if (dirname(dir) === dir) return undefined;
  }
}

/** Node's node_modules lookup for `name`, starting at `from`. */
function installedPackage(name: string, from: string): string | undefined {
  for (let dir = from; ; dir = dirname(dir)) {
    const candidate = join(dir, "node_modules", ...name.split("/"));
    if (existsSync(join(candidate, "package.json"))) return realpathSync(candidate);
    if (dirname(dir) === dir) return undefined;
  }
}

/**
 * Build the package table for the package that contains `entryPath`: its
 * Forma dependencies and theirs, found through node_modules. A dependency is a
 * Forma package when its package.json has a `forma` field. Returns undefined
 * when no package.json encloses the entry.
 */
export function readNodePackages(entryPath: string): NodePackages | undefined {
  const root = packageRoot(dirname(realpathSync(entryPath)));
  if (!root) return undefined;
  const packages = new Map<string, ModulePackage>();
  const directories = new Map<string, string>();
  const conflict = (name: string, first: string, second: string): never => {
    throw new ModuleError({
      code: "module/package-version-conflict",
      severity: "error",
      phase: "typecheck",
      message: `${name} is installed at ${first} and ${second} with different versions; a graph contains one version of each package.`,
    });
  };
  /** The Forma dependencies of the package in `from`, registering each. */
  const formaDependencies = (manifest: PackageJson, from: string, isRoot: boolean): string[] =>
    dependencyNames(manifest, isRoot).filter((name) => {
      const directory = installedPackage(name, from);
      if (!directory) return false;
      const dependency = readJson(join(directory, "package.json"));
      if (!dependency.forma) return false;
      const known = directories.get(name);
      if (known !== undefined) {
        if (known !== directory && packages.get(name)?.version !== dependency.version) conflict(name, known, directory);
        return true;
      }
      directories.set(name, directory);
      // Register before visiting dependencies so cycles terminate.
      packages.set(name, { name, version: dependency.version, exports: {} });
      packages.set(name, {
        name,
        ...(dependency.version ? { version: dependency.version } : {}),
        exports: dependency.forma.exports ?? {},
        ...(dependency.forma.prelude ? { prelude: dependency.forma.prelude } : {}),
        dependencies: formaDependencies(dependency, directory, false),
      });
      return true;
    });
  const dependencies = formaDependencies(readJson(join(root, "package.json")), root, true);
  return { table: { packages: [...packages.values()], dependencies }, directories };
}

/** Relative imports between files, and files inside installed packages by `pkg:` ID. */
export function nodeModuleResolver(packages: NodePackages | undefined): ModuleResolver {
  return (specifier, importer) => {
    if (!importer.startsWith(PACKAGE_ID_PREFIX) || !packages) return fileModuleResolver(specifier, importer);
    const id = relativeModuleId(specifier, importer);
    const name = packageOfModule(id);
    const directory = name === undefined ? undefined : packages.directories.get(name);
    if (name === undefined || directory === undefined) return undefined;
    const path = resolve(directory, id.slice(PACKAGE_ID_PREFIX.length + name.length + 1));
    if (path !== directory && !path.startsWith(directory + sep)) return undefined;
    try {
      return { id, source: readFileSync(path, "utf8") };
    } catch (error) {
      if (["ENOENT", "ENOTDIR", "EISDIR"].includes(String((error as { code?: string }).code))) return undefined;
      throw error;
    }
  };
}

/** Resolve the graph of a file, with the Forma packages its package depends on. */
export function readModuleGraph(entryPath: string): ModuleGraph {
  const id = realpathSync(entryPath);
  const packages = readNodePackages(id);
  return resolveModuleGraph(
    { id, source: readFileSync(id, "utf8") },
    nodeModuleResolver(packages),
    packages ? { packages: packages.table } : {},
  );
}

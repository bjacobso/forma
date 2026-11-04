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

import { realpathSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import {
  relativeModuleId,
  resolveModuleGraph,
  type ModuleGraph,
  type ModuleResolver,
} from "./modules/graph.js";
import {
  packageOfModule,
  PACKAGE_ID_PREFIX,
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

export { readFormaManifest, readFormaLock, readVendoredPackages } from "./node/package-files.js";
export type { FormaManifest, FormaLock, LockedPackage, NodePackages } from "./node/package-files.js";
import { findFormaRoot, packageError, readVendoredPackages, type NodePackages } from "./node/package-files.js";

/** Read and verify the nearest Forma project's vendored dependency closure. No network. */
export function readNodePackages(entryPath: string): NodePackages | undefined {
  const root = findFormaRoot(dirname(realpathSync(entryPath)));
  return root === undefined ? undefined : readVendoredPackages(root);
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
      if (!realpathSync(path).startsWith(directory + sep))
        return packageError("package-integrity", `${path} leaves its package directory.`);
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

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
import { dirname, resolve } from "node:path";
import {
  resolveModuleGraph,
  type ModuleGraph,
  type ModuleResolver,
} from "./modules/graph.js";
/** Relative file imports only; project/package resolution is a later stage. */
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
export function readModuleGraph(entryPath: string): ModuleGraph {
  const id = realpathSync(entryPath);
  return resolveModuleGraph(
    { id, source: readFileSync(id, "utf8") },
    fileModuleResolver,
  );
}

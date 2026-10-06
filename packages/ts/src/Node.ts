/** Node-only helpers; browser entry points do not import this module. */
import { readFileSync } from "node:fs";
import { bootstrapFromSources, type BootstrapOptions, type BootstrappedPrelude } from "./descriptor/bootstrap.js";

/** Bootstrap descriptors from files, with the same options as source bootstrapping. */
export function bootstrapFromFiles(
  compilerPath: string,
  domainPath: string,
  ...additionalPathsAndOptions: readonly (string | BootstrapOptions)[]
): BootstrappedPrelude {
  return bootstrapFromSources(
    readFileSync(compilerPath, "utf-8"),
    readFileSync(domainPath, "utf-8"),
    ...additionalPathsAndOptions.map(input => typeof input === "string" ? readFileSync(input, "utf-8") : input),
  );
}

/**
 * Package resolution (RFC 0018). The host supplies a package table; the
 * compiler maps bare specifiers through it and gives package modules
 * `pkg:<name>/<path>` identities. No filesystem access.
 */
import { normalizeModuleId, relativeModuleId, type ModuleResolver } from "./graph.js";

export interface ModulePackage {
  readonly name: string;
  /** Recorded for provenance; not part of module identity. */
  readonly version?: string | undefined;
  /** `"."` or `"./subpath"` → a file path relative to the package root. */
  readonly exports: Readonly<Record<string, string>>;
  /** Packages this package's modules may import. */
  readonly dependencies?: readonly string[] | undefined;
  /** A module whose exports the package's own modules import automatically. */
  readonly prelude?: string | undefined;
}

export interface PackageTable {
  readonly packages: readonly ModulePackage[];
  /** Packages that modules outside every package may import; every listed package when omitted. */
  readonly dependencies?: readonly string[] | undefined;
}

/** A resolution failure reported at the importing specifier. */
export class ModuleResolutionError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const PACKAGE_ID_PREFIX = "pkg:";

const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/;

/** `@scope/name/sub/path` → `{ name: "@scope/name", subpath: "./sub/path" }`. */
export function splitPackageSpecifier(specifier: string): { readonly name: string; readonly subpath: string } | undefined {
  const parts = specifier.split("/");
  const size = specifier.startsWith("@") ? 2 : 1;
  const name = parts.slice(0, size).join("/");
  if (parts.length < size || !PACKAGE_NAME.test(name)) return undefined;
  const rest = parts.slice(size);
  if (rest.some((part) => part === "" || part === "." || part === "..")) return undefined;
  return { name, subpath: rest.length ? `./${rest.join("/")}` : "." };
}

/** The ID of a file inside a package. */
export function packageModuleId(name: string, path: string): string {
  return `${PACKAGE_ID_PREFIX}${name}/${normalizeModuleId(path)}`;
}

/** The package that owns a `pkg:` module ID. */
export function packageOfModule(id: string): string | undefined {
  if (!id.startsWith(PACKAGE_ID_PREFIX)) return undefined;
  const parts = id.slice(PACKAGE_ID_PREFIX.length).split("/");
  const name = parts.slice(0, parts[0]?.startsWith("@") ? 2 : 1).join("/");
  return PACKAGE_NAME.test(name) ? name : undefined;
}

/** Problems in a table that would make resolution ambiguous or escape a package. */
export function packageTableErrors(table: PackageTable): readonly string[] {
  const errors: string[] = [];
  const names = new Set<string>();
  for (const pkg of table.packages) {
    if (!PACKAGE_NAME.test(pkg.name)) errors.push(`Invalid package name ${JSON.stringify(pkg.name)}.`);
    if (names.has(pkg.name)) errors.push(`Package ${pkg.name} is listed twice; a graph contains one version of each package.`);
    names.add(pkg.name);
    for (const [subpath, file] of Object.entries(pkg.exports)) {
      if (subpath !== "." && !subpath.startsWith("./")) errors.push(`${pkg.name} export ${subpath} must be "." or start with "./".`);
      if (escapesRoot(file)) errors.push(`${pkg.name} export ${subpath} leaves the package root.`);
    }
    if (pkg.prelude !== undefined && escapesRoot(pkg.prelude)) errors.push(`${pkg.name} prelude leaves the package root.`);
  }
  return errors;
}

function escapesRoot(path: string): boolean {
  return path.startsWith("/") || normalizeModuleId(path).split("/")[0] === "..";
}

/**
 * Wrap a host resolver with package resolution. A bare specifier resolves to
 * `./<export path>` from the importer `pkg:<name>/`; the host stores package
 * files under those IDs. Relative imports may not leave a package.
 */
export function withPackages(table: PackageTable, resolver: ModuleResolver): ModuleResolver {
  const errors = packageTableErrors(table);
  if (errors.length) throw new ModuleResolutionError("module/package-table", errors.join(" "));
  const packages = new Map(table.packages.map((pkg) => [pkg.name, pkg]));
  return (specifier, importer) => {
    const owner = packageOfModule(importer);
    if (specifier.startsWith("./") || specifier.startsWith("../")) {
      if (owner !== undefined && packageOfModule(relativeModuleId(specifier, importer)) !== owner)
        throw new ModuleResolutionError("module/package-escape", `${specifier} leaves package ${owner}; import other packages by name.`);
      return resolver(specifier, importer);
    }
    const parsed = splitPackageSpecifier(specifier);
    if (!parsed)
      throw new ModuleResolutionError("module/specifier", `${specifier} is neither a relative file nor a package name.`);
    const allowed =
      owner !== undefined
        ? [owner, ...(packages.get(owner)?.dependencies ?? [])]
        : (table.dependencies ?? [...packages.keys()]);
    if (!allowed.includes(parsed.name))
      throw new ModuleResolutionError(
        "module/undeclared-dependency",
        `${owner ?? "This module's package"} does not declare a dependency on ${parsed.name}.`,
      );
    const pkg = packages.get(parsed.name);
    if (!pkg) throw new ModuleResolutionError("module/package-not-found", `Package ${parsed.name} is not installed.`);
    const file = pkg.exports[parsed.subpath];
    if (file === undefined)
      throw new ModuleResolutionError(
        "module/package-private",
        `${pkg.name} does not export ${parsed.subpath}; its exports are ${Object.keys(pkg.exports).sort().join(", ") || "none"}.`,
      );
    return resolver(`./${normalizeModuleId(file)}`, packageModuleId(pkg.name, ""));
  };
}

/** Project settings that give each package's own modules its prelude. */
export function packageProjects(table: PackageTable): readonly {
  readonly id: string;
  readonly base: string;
  readonly prelude: string;
}[] {
  return table.packages.flatMap((pkg) =>
    pkg.prelude === undefined
      ? []
      : [{ id: `${PACKAGE_ID_PREFIX}${pkg.name}`, base: packageModuleId(pkg.name, ""), prelude: `./${normalizeModuleId(pkg.prelude)}` }],
  );
}

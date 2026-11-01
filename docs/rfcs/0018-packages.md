# RFC 0018: Packages

| | |
| --- | --- |
| Status | Accepted; stage 1 implemented |
| Created | 2026-11-01 |
| Scope | Package specifiers, the `forma` manifest field, exports, declared dependencies, package module identity, package preludes, version conflicts, host package tables, the Node adapter |
| Direction | A package is a directory of file modules with a public export map. The host's package manager installs and locks packages; Forma resolves bare specifiers through a host-supplied table and gives package modules location-independent identities |

## Summary

`(import "@acme/flows/ir" [FlowIR])` imports from the `@acme/flows` package.
A package is an npm-style package whose `package.json` has a `forma` field:

```json
{
  "name": "@acme/flows",
  "version": "1.2.0",
  "dependencies": { "@acme/ir": "^1.0.0" },
  "forma": {
    "exports": { ".": "./src/index.forma", "./ir": "./src/ir.forma" },
    "prelude": "./src/prelude.forma"
  }
}
```

Only the subpaths in `forma.exports` can be imported from outside the package.
A module may import a package only when its own package declares it as a
dependency. Package modules have identities of the form
`pkg:@acme/flows/src/ir.forma`, independent of where the package is installed,
so binding identities, generated names, and contract identities are the same on
every machine. A graph contains at most one version of each package.

The compiler still never reads the filesystem. A host supplies a package table,
plain data that browsers and in-memory bundles can construct, and the Node
adapter builds one from `package.json` files.

This RFC replaces the `forma.toml` and lockfile sketch in
[RFC 0002](./0002-modules-and-packages.md#packages-and-tooling).

## Motivation

[RFC 0002](./0002-modules-and-packages.md) implemented relative file modules
and compile-time libraries; bare specifiers fail with `module/package-stage`.
That blocks the main reason to have modules at all: sharing vocabulary between
projects. Open Ontology vendors `compiler.lisp` and `ontology.lisp` and edits its
copy because there is no way to import them. A form can now produce an `:ir`
type another module exports, but only through relative paths inside one tree,
so two libraries cannot target a type that a third library owns.

Identity is the other half. Module IDs are canonical file paths today. A type
installed under `/home/a/node_modules/x` and `/srv/b/node_modules/x` has two
identities, and every name and `contractId` derived from it differs between
machines.

## Decisions

### Distribution belongs to the host's package manager

Forma packages are npm packages. npm, pnpm, or yarn install them, resolve version
ranges, and record integrity in their lockfile. Forma defines no registry,
lockfile, or version solver. Consumers of Forma already depend on npm packages:
`@formalang/ts`, Open Ontology, and generated Effect TypeScript all live there.

### The manifest is the `forma` field of `package.json`

- `exports` maps `"."` or `"./subpath"` to a `.forma` file inside the package,
  written as a relative path. It is required; a package with no exports has
  nothing to import.
- `prelude` (optional) names a file module whose exports every module of the
  package imports automatically, using the existing project prelude rules.
  It applies to the package's own modules, not to its consumers.

A package's Forma dependencies are the names in its `dependencies`,
`peerDependencies`, and `optionalDependencies` whose own `package.json` has a
`forma` field. For the root package, `devDependencies` count too.

### Specifiers

| Specifier | Meaning |
| --- | --- |
| `./x.forma`, `../x.forma` | A file relative to the importing module, as today |
| `name`, `@scope/name` | The package's `"."` export |
| `name/sub`, `@scope/name/sub` | The package's `"./sub"` export |

Anything else, such as an absolute path or a URL, is `module/specifier`.
A package may import itself by name, through its exports.

### Checks

| Code | When |
| --- | --- |
| `module/undeclared-dependency` | The importing module's package does not declare the package |
| `module/package-not-found` | A declared package is not in the host's table |
| `module/package-private` | The subpath is not in the package's `exports`; the message lists the exports |
| `module/package-escape` | A relative import leaves its package's root |
| `module/package-version-conflict` | The graph would contain two versions of one package |
| `module/package-table` | The host's table lists a package twice, or an export or prelude leaves its package |

The first four are reported at the specifier the author wrote; the last two
come from the host's table before resolution starts.

### Identity

A module inside an installed package has the ID `pkg:<name>/<path>`, where
`<path>` is its file path relative to the package root. The version is not part
of the ID, so a release that leaves a definition unchanged leaves its binding
identities and `contractId`s unchanged. Because the ID omits the version, a graph
must not contain two versions of one package; the host rejects that when it
builds the table. A single version per graph also keeps nominal types simple:
there is never a `FlowIR` from 1.2 and another from 2.0 in one program.

Modules of the root package (the package being developed) keep their host file
IDs, so diagnostics and editors point at real files. Its identities become
`pkg:` IDs when another package consumes it.

### The host package table

The compiler accepts a table through `ModuleCoreOptions.packages`:

```ts
interface ModulePackage {
  readonly name: string;
  readonly version?: string;
  readonly exports: Readonly<Record<string, string>>;
  readonly dependencies?: readonly string[];
  readonly prelude?: string;
}
interface PackageTable {
  readonly packages: readonly ModulePackage[];
  /** Packages that modules outside every package may import; every listed package when omitted. */
  readonly dependencies?: readonly string[];
}
```

Resolution maps a bare specifier to the export's path relative to the package
root and asks the host resolver for `./<path>` from the importer
`pkg:<name>/`. The resolver contract, `(specifier, importerId) -> {id, source}`,
does not change. In-memory hosts store package files under their `pkg:` IDs;
`sourceModuleResolver` then works unchanged. Sessions accept the table through
`configureSession({ packages })`.

The Node adapter (`@formalang/ts/node`) finds the nearest `package.json` above
the entry file, follows its Forma dependencies with Node's `node_modules` lookup,
and builds the table before resolving the graph. Reaching a second directory for
a package name with a different version is `module/package-version-conflict`.

## Alternatives considered

- **`forma.toml` and a Forma lockfile** ([RFC 0002](./0002-modules-and-packages.md#packages-and-tooling)).
  Forma would need its own version solver, registry protocol, and integrity
  format, and every consumer would keep two manifests. Rejected while every
  consumer already uses npm.
- **Version in the module ID, multiple versions per graph.** Matches npm's
  nested installs, but every release changes every identity and `contractId`,
  and two copies of one nominal type can meet in one program. Rejected; a host
  can still bundle two versions under different package names when needed.
- **Unrestricted imports of anything installed.** Simpler, but a package could
  depend on whatever its consumer happened to install. Rejected; declared
  dependencies are what make a package reusable.
- **Filesystem paths as package IDs.** Already the case for relative modules;
  rejected for packages because identity must not depend on install location.

## Implementation stages

1. **Resolution and identity (implemented).** Package specifiers, the table,
   the checks above, `pkg:` IDs, package preludes, session `packages`, the Node
   adapter, and `forma file` commands across packages.
2. **Language services.** Go-to-definition, hover, and search across package
   modules in the language server, which needs the Node table in its workspace.
3. **Distribution of the repository preludes.** Publish reference vocabularies
   as Forma packages so consumers such as Open Ontology import instead of vendoring.

## Decisions still required

- Whether package exports should support patterns (`"./forms/*"`).
- Whether a package can re-export another package's prelude to its consumers.
- How the website playground, which has no `node_modules`, offers packages.

# RFC 0018: Packages

| | |
| --- | --- |
| Status | Accepted; offline consumption implemented |
| Created | 2026-11-01 |
| Scope | Provider-independent sources, forma.json, MVS, vendoring, lock verification, exports, identities, host package tables |
| Direction | Names identify packages; source maps locate them. Commit reviewed dependencies in vendor/ and compile offline |

## Summary

`(import "@acme/flows/ir" [FlowIR])` imports a declared package export.
Forma dependencies use their own `forma.json`, without npm metadata:

```json
{
  "name": "@me/app",
  "version": "0.1.0",
  "exports": { ".": "./src/index.forma" },
  "prelude": "./src/prelude.forma",
  "dependencies": {
    "@acme/flows": "github.com/acme/flows@v2.1.0",
    "@acme/ir": "gitlab.com/acme/ir@v1.0.0",
    "@corp/rules": "git+ssh://git.corp.example/rules.git@3f9c2e1",
    "@me/shared": "../shared"
  }
}
```

Imports contain names, never hosting locations. Dependencies are vendored and
committed with the consumer. Package module IDs remain `pkg:<name>/<path>`, so
binding identities and `contractId`s do not depend on a provider, checkout path,
or version. The compiler receives a plain package table and never accesses the
filesystem or network. This replaces the original package-manager direction and
[RFC 0002's sketch](./0002-modules-and-packages.md#packages-and-tooling).

## Decisions

### Manifest and identity

`forma.json` requires `name` and `exports`, with optional `version`, `prelude`,
and `dependencies`. Exports map `"."` or `"./subpath"` to a `.forma` file inside
the package. A prelude imports exports into the package's own modules, using
project-prelude rules. Dependencies map declared names to source specs.

A dependency key **must equal** the fetched package's own `name`; mismatches
are `module/package-name`. Coexisting major versions require different names
such as `@acme/flows` and `@acme/flows2`, with matching names in their respective
manifests. An arbitrary consumer alias cannot bypass this identity rule. There
are no Go-style `/v2` import paths.

### Provider-independent distribution

| Source spec | Transport |
| --- | --- |
| `github.com/owner/repo@ref` | Forge tarball endpoint, with git fallback |
| `gitlab.com/owner/repo@ref` | Forge tarball endpoint, with git fallback |
| `codeberg.org/owner/repo@ref` | Forge tarball endpoint, with git fallback |
| `bitbucket.org/owner/repo@ref` | Forge tarball endpoint, with git fallback |
| `git+https://…@ref`, `git+ssh://…@ref`, `git+file://…@ref` | git subprocess; git's credentials apply |
| `./directory`, `../directory` | Local directory, relative to the declaring manifest |

The last `@` separates location from ref, including SSH URLs with a username.
Refs are exact tags, branches, or commits; semver ranges are not supported.
No registry, proxy, or checksum database is required. Vendored source is
committed and reviewed. Tarball URL pins and vanity discovery remain undecided.

### Minimal Version Selection

Each graph contains one version per declared name. Semver git tags are minimum
requirements: select the highest minimum encountered in the transitive graph,
including prerelease ordering. This is deterministic MVS, without a solver or
backtracking to find a compatible release. Transitive requirements encountered
at lower versions contribute to selection. Different source locations for one
name conflict. Non-semver refs must agree exactly, including when mixed with
semver requirements; conflicts report `module/package-version-conflict`.
Local requirements must identify the same directory.

### Vendoring and the lock

Commit `vendor/<name>/…`, including each package's `forma.json` and all `.forma`
files, even unimported files. Compilation reads only these files and declared
relative dependencies. Symlinks are rejected. A local dependency stays in its
relative directory; its source files are also hashed so edits require a lock
refresh before compilation.

`forma.lock` is sorted JSON with this versioned shape:

```json
{
  "version": 1,
  "manifest": "<SHA-256 of root forma.json UTF-8 text>",
  "packages": {
    "@acme/flows": {
      "source": "github.com/acme/flows@v2.1.0",
      "resolved": "v2.1.0",
      "commit": "<full git commit>",
      "files": { "forma.json": "<SHA-256>", "src/index.forma": "<SHA-256>" }
    }
  }
}
```

The selected source spec, resolved ref, commit, and every vendored file hash are
reviewable. Relative packages use `resolved: "local"` and `commit: null`.
The root manifest hash detects any manifest edit, including whitespace.
Verification checks the manifest hash, full dependency closure, identities,
requirements, and missing, extra, or edited vendor files. Lock entries not
reachable from the selected manifests are stale. `forma file` reports
`module/package-integrity` or `module/package-stale` diagnostics before resolving
rather than silently accepting edits. `forma verify` is the planned explicit
check command; no compilation command downloads dependencies.

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

A module inside a dependency package has the ID `pkg:<name>/<path>`, where
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

The Node adapter (`@formalang/ts/node`) finds the nearest `forma.json` above
an entry, verifies its lock and dependency closure, and reads only `vendor/`
and declared relative directories. It never fetches while compiling. Browser
hosts continue to supply a table directly.

## Alternatives considered

- **npm discovery and `package.json` metadata.** Rejected: Forma source packages
  should work without a JavaScript ecosystem or registry, and vendored changes
  should be visible in the consumer's code review. The JavaScript implementation
  is still distributed through npm; that does not define Forma dependencies.
- **Go import-path-as-location.** Rejected: source code should use stable declared
  names rather than hosting URLs. Moving a repository changes its source map,
  not module or contract identity. We adopt vendoring and MVS without `/v2` paths.
- **A dependency solver and version ranges.** Rejected in favor of deterministic
  highest-minimum selection. There is no compatibility backtracking.
- **Version or filesystem location in module IDs.** Rejected because either
  changes identities for unchanged definitions. One version per name avoids
  multiple copies of nominal types in one program.
- **Unrestricted imports of fetched files.** Rejected: declared dependencies and
  explicit exports define the reusable package boundary.

## Implementation stages

1. **Offline resolution and identity (implemented).** Host package tables,
   specifiers, package preludes, session configuration, and verified Node
   consumption of `forma.json`, `forma.lock`, and `vendor/` or relative packages.
   No `package.json` discovery remains.
2. **Dependency commands (planned).** `forma add <name> <spec>`,
   `forma update [name]`, `forma verify`, and lock-based re-materialization.
   A provider adapter fetches known forge archives or uses git; transitive
   resolution applies MVS. Compilation itself remains offline.
3. **Language services and reference packages (planned).** Cross-package language
   server navigation and distributing the repository's reference vocabularies.

## Decisions still required

- Tarball URL sources with SHA-256 pins.
- Go-style `<meta name="go-import">` vanity discovery.
- Export patterns and consumer prelude re-exports.
- How the website playground obtains a package table and sources.

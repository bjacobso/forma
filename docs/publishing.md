# Publishing Forma

`@forma-language/forma` **0.5.0** is the next release, prepared but not yet
published. The canonical repository is
[github.com/bjacobso/forma](https://github.com/bjacobso/forma).
The engine, host, editor and language-server workspaces remain private
`@formalang/*` implementation packages.

## Installing from main

Until publication, consumers can pack a clean checkout of `main`. Use Node 24
and pnpm 10.20.0. Build before packing; source archives do not contain `dist`.

```sh
git clone --branch main --single-branch https://github.com/bjacobso/forma.git forma
cd forma
pnpm install --frozen-lockfile
pnpm exec turbo run build --filter=@forma-language/forma
pnpm --filter @forma-language/forma pack --pack-destination "$PWD"
cd ..
mkdir forma-consumer
cd forma-consumer
npm init -y
npm install ../forma/forma-language-forma-0.5.0.tgz effect@4.1.1
printf '(+ 20 22)\n' > main.lisp
npx forma check main.lisp
npx forma run main.lisp
```

Record the checkout's `git rev-parse HEAD` alongside the tarball: pre-alpha
commits within a release can differ. `pnpm check:tarball` clones the current
commit with `git clone --shared`, performs a frozen install and fresh build,
then installs its tarball plus Effect in an empty npm project. It checks root
imports, `check`, `run`, `test` with `forma:test`, `createLanguage`, and both bins.
It tests committed source, so uncommitted edits are deliberately excluded.
CI runs it after `pnpm pack:check`.

## Public contract and dependency weight

The root exports the embedding facade (`createLanguage`), checking and evaluation
operations, and the default host. These are the retained public subpaths:

| Use | Subpaths |
| --- | --- |
| Checking and source tools | `/engine`, `/reader`, `/modules`, `/diagnostic`, `/formatter`, `/editor-services`, `/analysis`, `/expander`, `/type` |
| Vocabulary and generators | `/descriptor`, `/preludes`, `/mechanics`, `/http-api`, `/rpc`, `/email`, `/elm` |
| Embedding | `/host`, `/host/types`, `/host/json-abi`, `/node` |
| Editor and server adapters | `/editor`, `/editor/codemirror`, `/editor/react`, `/language-server` |

This removes 18 internal subpaths: `/source`, `/session`, `/artifact`,
`/sexpr`, `/evaluator`, `/vm`, `/builtins`, `/core-expr`, `/env`, `/syntax`, `/lsp`,
`/codegen`, `/descriptor-codegen`, `/ontology`, `/authoring`, `/host/default-host`,
`/host/editor` and `/host/ts-host`. These internal entry points
are no longer supported. (The previous manifest had 42 subpaths plus the
root; the retained manifest has 24 plus the root.) Use the root or `/engine` for
checking, `/host` for advanced host operations (including `TsLanguageHost`),
`/host/json-abi` for the process ABI types and schema, and `/analysis` for the
UI-free language-service workspace (`AnalysisWorkspace`).
`/email` and `/elm` remain experimental; the website exercises both generators.

WorldVM's required imports remain public, with these exact symbols (including
its legacy mechanics consumer):

| Subpath | Symbols |
| --- | --- |
| `/reader` | `parse`, `parseManyToSExpr`, `toSExprMany`, `isRedNode`, `RedElement`, `SExpr` |
| `/descriptor` | `bootstrapFromSources`, `elaborateSources`, `BootstrappedPrelude`, `ElaboratedDeclaration`, `SimpleSemanticEnvironment` |
| `/type` | `lowerProgram` |
| `/preludes` | `preludeSource` |
| `/mechanics` | `isMechanicsArtifactForm`, `mechanicsPackageableDeclarations` |

WorldVM must change the package prefix from `@formalang/ts` to
`@forma-language/forma`. Its convergence script still vendors the private engine;
`pnpm --filter @formalang/ts pack` remains supported during this transition.

**Dependency choice:** retain CodeMirror/Lezer, the MCP SDK and LSP libraries as
regular dependencies so both `forma` and `forma-language-server` work after a
plain `npm install @forma-language/forma effect`. These tools load through their
specific subpaths or executables. Root and runtime-neutral subpaths must bundle
without importing those dependencies; `check-distribution.mjs` enforces this,
including MCP. React and React DOM 19 remain optional peers for `/editor/react`.
Effect is the required peer (`^4.1.1`), with 4.1.1 the tested baseline.

Dependency weight is intentionally unchanged: the existing installed checking
closure, excluding optional React roots, has **119 dependency packages,
79,313,133 file bytes before and after**. The baseline tarball adds 2,348,069
uncompressed file bytes (81,661,202 total); the 0.5.0 tarball adds 2,345,942
bytes (81,659,075 total). These are measurements of the
existing workspace's installed dependency closure, not a completed clean
consumer install: offline sandbox installs lacked the CodeMirror markdown
tarball. `pnpm pack:check` prints the actual clean consumer package count and
installed file bytes before adding optional UI peers. File bytes exclude
`node_modules` links and package-manager metadata; disk block usage varies.

## Version rule and release checks

The manifest on `main` names the next release. Pending changesets have been
consumed with `pnpm exec changeset version` into `packages/forma/CHANGELOG.md`
for 0.5.0. Only `@forma-language/forma` belongs in new changesets. Before merging
a later breaking change, add a **Breaking** minor changeset and consume it in
the same PR with `pnpm release:version`, advancing the pre-1.0 minor again.
Keep the manifest, changelog, README version mentions and this page aligned.
Private workspaces are excluded from versioning and tags. The release-plan
check validates pending release names, or requires a changelog entry matching
the manifest when all notes are consumed. This permits a prepared release PR
without requiring another changeset relative to `origin/main`.

```sh
pnpm release:check
pnpm check:tarball
pnpm check:examples
node scripts/check-release-plan.mjs
```

`release:check` runs semantic checks and the distribution pack/install gate,
including declarations, browser boundaries, MCP, bundled libraries and both
executables. Offline CI needs the dependency closure in its pnpm store;
pack/example checks retain `--prefer-offline`. The clean tarball gate also
needs npm's cache or registry access for its ordinary npm consumer install.

## Commands for Ben to publish

Prerequisites: control the `forma-language` npm organization and permission to
publish `@forma-language/forma`; authenticate with an npm account that satisfies
the organization's 2FA policy for the authorized first publication. The old
scope's trusted publishers do not transfer. Bootstrap the package under that
account, then configure its npm trusted publisher for repository `bjacobso/forma`,
workflow `release.yml`, environment `npm-publish`. The release workflow uses
GitHub OIDC with `id-token: write` and npm 11.5.1 or newer. Do not add a persistent
token to CI.

From the reviewed release checkout, Ben runs:

```sh
pnpm install --frozen-lockfile
pnpm release:check
pnpm check:tarball
pnpm check:examples
npm login
pnpm --filter @forma-language/forma publish --access public --no-git-checks
```

Subsequent versioned releases use the gated Changesets `release.yml` workflow;
its publish job requires the `npm-publish` environment approval. The repository
also exposes `pnpm release:publish` (`changeset publish`) for an authorized
maintainer release. Do not publish the private implementation workspaces.

After the new package is published and verified, Ben can deprecate exactly the
old versions with these commands:

```sh
npm deprecate '@formalang/ts@0.3.0' 'Use @forma-language/forma; migrate engine imports to its public subpaths.'
npm deprecate '@formalang/host@0.3.0' 'Use @forma-language/forma; createLanguage is available at the root and advanced host APIs at /host.'
npm deprecate '@formalang/editor@0.3.0' 'Use @forma-language/forma/editor, /editor/codemirror or /editor/react.'
npm deprecate '@formalang/language-server@0.2.1' 'Use @forma-language/forma/language-server and the forma-language-server bin.'
```

No publication, registry setting change or deprecation is performed by local
release preparation. See [RFC 0025](https://github.com/bjacobso/forma/blob/main/docs/rfcs/0025-single-npm-distribution.md)
for the original distribution design.

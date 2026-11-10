# RFC 0025: One npm distribution under @forma-language

| | |
| --- | --- |
| Status | Proposed; not implemented or authorized for publication |
| Created | 2026-11-08 |
| Scope | npm distribution, public JavaScript entry points, migration, and release gates |
| Related | [RFC 0020](./0020-packages.md), [host ABI](./0013-runnable-host.md), [publishing](../publishing.md), [language services](../language-services.md) |
| Decision | Publish only `@forma-language/forma`; preserve internal workspaces and explicit browser/Node boundaries |

## Summary and first principles

An npm package is an installation, versioning, and compatibility unit. A workspace
is an ownership and development boundary. An export is a supported interface. A
bundle is an execution/loading artifact. These are different decisions: one npm
package does not require one source directory, one barrel, or one JavaScript file.

Forma currently ships one cooperating language implementation with host, source
editor, and LSP adapters. There is no demonstrated need for consumers to negotiate
four independently versioned Forma installations. Recommend one public package,
`@forma-language/forma`, with multiple explicit ESM entry points, declarations,
shared internal modules/chunks, and two existing executables. Keep compiler,
host, editor, and language-server implementation workspaces separate and private.
Do not move the Foldworks structural workbench back into this repository.

This consolidates distribution, not all responsibilities or all APIs. It trades
a larger installed tarball and some unused adapter dependencies for one install
and one tested version. Browser loading must still exclude Node and unused UI
code. Measure that tradeoff before publishing; do not claim subpaths reduce npm's
download or dependency installation size.

The requested npm organization URL supplies naming context only. No private npm
settings were accessed. This RFC authorizes no publishing, deprecation, settings
changes, push, merge, or deployment. Implementation and external actions require
separate approval.

## Observed state

Inspected repository revision `997ae4074dd37b41bc1f514c3a171752ab5dd3b5`
and public registry metadata on 2026-11-08. Versions and PR contents are snapshots,
not promises about a later release.

### Workspaces and exports

| Workspace | Local version; explicit export keys including root | Current responsibility and dependency edge |
| --- | --- | --- |
| [`packages/ts`](../../packages/ts/package.json) | 0.3.0; 32 | Reader, expander, HM checking, evaluation/VM, sessions, module linking, descriptors, artifacts, generation, UI-free analysis; Effect peer `^4.1.1` |
| [`packages/host`](../../packages/host/package.json) | 0.3.0; 6 | `LanguageHost`, `TsLanguageHost`, default host, JSON ABI and `forma` bin; depends on ts, same Effect peer |
| [`packages/editor`](../../packages/editor/package.json) | 0.3.0; 3 | CodeMirror and React integrations over host; CodeMirror/Lezer dependencies, Effect and React/React DOM peers |
| [`packages/language-server`](../../packages/language-server/package.json) | 0.2.1; 2 | `FormaWorkspace`, LSP handlers and side-effectful server entry; depends on ts and VS Code LSP libraries |
| [`apps/website`](../../apps/website/package.json) | Private | React/Vite playground; depends on editor and ts; must not become part of the npm distribution |

The runtime dependency graph is editor → host → ts and language-server → ts.
The language server no longer depends on the host package in this checkout.
The root workspace is private. There are no Foldworks dependencies in these
language packages; root development tooling includes Foldkit for target checks.

The ts root is a large namespace barrel; its 31 subpaths expose both high-level
operations and implementation-oriented capabilities. Host has root,
`default-host`, `editor`, `ts-host`, `types`, and `json-abi`. Editor has root,
`codemirror`, and `react`; its root currently imports both UI families. LSP has
root and `server`; importing the latter starts the server, so it is not an inert
library export.

[`tsdown.config.ts`](../../tsdown.config.ts) currently uses unbundled ESM output
and declarations for ts/host, with `platform: "node"`. The editor has its own
[unbundled configuration](../../packages/editor/tsdown.config.ts); the LSP uses
TypeScript emission plus a bin launcher. A Node build-platform setting is not
evidence that every exported graph is Node-only, nor proof of browser safety.

### Consumers and executable/compiler/runtime boundaries

- The [website worker](../../apps/website/src/engine/worker.ts) imports
  `engine`, `mechanics`, and `email`. The playground also consumes reader,
  descriptor/preludes, formatting, module operations, and both editor adapters.
  These are concrete browser consumers, not hypothetical tree-shaking cases.
- The [editor analysis adapter](../../packages/editor/src/analysis-host.ts)
  consumes host/default-host, host/editor, and host/types. The
  [LSP workspace](../../packages/language-server/src/workspace.ts) consumes
  `AnalysisWorkspace`, but loads preludes with Node filesystem APIs. UI-free
  analysis and the Node LSP workspace are not interchangeable environments.
- The [host CLI](../../packages/host/src/cli.ts) supplies `forma request`,
  `daemon`, `file typecheck/evaluate/interface/declarations`, package commands,
  version, and help. Evaluation checks first unless `--unchecked` is supplied.
  JSON ABI session `replSubmit` exists; there is no shipped `forma repl` command.
  The [readline prototype](../../packages/ts/src/cli/repl.ts) is not a declared
  npm bin. Do not accidentally turn it into a second supported CLI.
- [`Engine`](../../packages/ts/src/Engine.ts) owns parse/expand/check/evaluate
  requests and results. Reader, expander, HM inference, interpreter, and VM are
  distinct stages, not separate npm products. `evaluate` must not be relabeled
  as checked execution merely by changing its import path.
- [`Mechanics`](../../packages/ts/src/Mechanics.ts) exposes checked Effect
  elaboration/generation and `makeMechanicsRuntime`; interpreter/VM execution
  and that hosted artifact runtime are different execution interfaces.
  [`Artifact`](../../packages/ts/src/Artifact.ts) exposes validation and emission;
  `canonical-ir` is the implemented session emission backend. Do not invent a
  universal compile/run API or equate artifact emission with every generator.
- [`CodeGen`](../../packages/ts/src/CodeGen.ts) is an S-expression builder and
  printer, not the TypeScript compiler. Descriptor codegen emits schemas,
  TypeScript form hooks, and builders. Mechanics emits Effect TypeScript;
  HTTP API, ontology, email, and Elm have their own adapters. Email and Elm are
  explicitly experimental. Generated TypeScript targets Effect and, for Elm,
  Foldkit: it does not inherently require a Forma runtime installation.
- [`Node`](../../packages/ts/src/Node.ts) owns filesystem bootstrap, module
  resolution, lock verification, and dependency-management APIs. Browser hosts
  supply source strings, resolvers, and package tables instead.

In-repository consumers demonstrate the contracts above. They are not a complete
inventory of external users; no sibling repository or private consumer audit has
been performed. Existing npm installations must be assumed to exist.

### Published state and pending release

Public npm metadata returned latest versions ts/host/editor 0.3.0 and LSP 0.2.1.
Published ts/host/editor still depend on `effect@4.0.0-rc.112`; published LSP
depends on host. Those differ from local manifests and the new implementation.
Do not present a scope rename as the only migration required.

[`@forma-language/forma`](https://registry.npmjs.org/%40forma-language%2Fforma)
returned HTTP 404. This means no public package metadata was available, not that
the name is reserved, writable, or approved for this maintainer. Ownership,
permissions, and trusted-publisher configuration remain unverified.

[Release PR #14](https://github.com/bjacobso/forma/pull/14), inspected at head
`d2d9e2c5f7fb30f2d769db5631ba36485a2d745e`, proposes ts/host/editor 0.4.0 and LSP
0.3.0 under `@formalang`. It consumes pending changesets and generates four
changelogs. Its check rollup was empty; [publishing guidance](../publishing.md)
explains that workflow-token version PRs do not automatically run CI. Neither its
versions nor its green mergeability should be assumed to establish publishability.

The [release workflow](../../.github/workflows/release.yml) runs on main pushes:
select mode → version PR, or release checks/pack → publish in `npm-publish` using
OIDC, followed by tags and GitHub releases. Changesets currently treats all four
workspaces as public, independently versioned (`fixed` and `linked` are empty).
[`check-packages.mjs`](../../scripts/check-packages.mjs) asserts exactly four
public packages, checks archive contents and dependency metadata, installs all
four tarballs, imports library exports except the server, and checks analysis.
Its peer checks already prevent embedding a second Effect runtime.

## Proposed package and supported surface

### Name and root

Use `@forma-language/forma`, not `@forma-language/ts`, `/core`, or an unscoped
`forma` package. The product is Forma; TypeScript is today's implementation, not
the consumer's reason for installing it. The scope provides ownership and
disambiguation; a hypothetical second implementation is not a reason to expose
another package now. Keep bin names `forma` and `forma-language-server`.

The root should explicitly export `parse`, `expand`, `typecheck`, `evaluate`,
their request/result types and diagnostics from Engine, plus
`createDefaultLanguageHost`, `DefaultLanguageHost`, and `LanguageHost` from host.
Use explicit symbol lists to avoid conflicting engine/host projection types.
Retain full advanced operations through subpaths rather than re-exporting every
UI, generator, internal type, and Node adapter from the root. This is a new root
contract, not a compatible replacement for the old ts namespace barrel.

### Explicit subpath map

Paths below are relative to `@forma-language/forma`. Each listed entry gets
`types` and ESM `import` targets; no wildcard `./*`, `src`, or `dist` exports.

| New entry points | Implementation/contract |
| --- | --- |
| `/engine`, `/reader`, `/source`, `/session`, `/modules`, `/diagnostic`, `/formatter` | Corresponding current ts entry points |
| `/analysis`, `/syntax`, `/editor-services`, `/authoring`, `/lsp` | UI-free ts analysis, identity, structural editing, authoring helpers and LSP projections; `/editor-services` replaces ts/editor |
| `/artifact`, `/descriptor`, `/preludes`, `/mechanics`, `/descriptor-codegen`, `/codegen`, `/http-api`, `/ontology` | Current ts artifact, prelude, runtime and generation contracts; preserve distinctions above |
| `/sexpr`, `/expander`, `/evaluator`, `/vm`, `/builtins`, `/type`, `/core-expr`, `/env` | Existing advanced ts interfaces; supported, but not the recommended first integration |
| `/email`, `/elm` | Existing experimental prototypes; retain maturity labels |
| `/node` | Current Node-only filesystem/package APIs |
| `/host`, `/host/default-host`, `/host/editor`, `/host/ts-host`, `/host/types`, `/host/json-abi` | Current host export contracts without CLI startup |
| `/editor` | UI-free editor analysis adapter factories and `EditorAnalysisHost`; deliberately not the old combined UI barrel |
| `/editor/codemirror`, `/editor/react` | Existing editor adapter exports |
| `/language-server` | Existing workspace and handler library, Node-only |

This carries every current ts subpath forward, with one collision resolved:
ts/editor is structural language tooling; editor/codemirror and editor/react
are UI integrations. `/lsp` is still the ts support module, not the server.
No `/runtime` or `/compiler` alias is needed: those names would conflate existing
execution and generation contracts. No `/language-server/server` library export:
startup belongs to the executable, not a module people import for types.

This RFC does not combine migration with a broad API purge. Existing explicitly
exported advanced symbols stay supported through their mapped subpaths, including
types reachable from their declarations. Marking them advanced does not exempt
them from compatibility policy. Unexported implementation files, build chunks,
test helpers, and physical filenames remain private. Narrowing that advanced
surface later requires a separate breaking change and consumer evidence.

### Environment and dependencies

- Publish ESM and declarations only; do not add CommonJS for an unobserved
  consumer. Declare Node `>=24` for executables and Node-only APIs, matching the
  supported repository toolchain. Browser support means modern ESM browsers
  and workers tested by the playground, not a claim of universal browser support.
  Choose an explicit build target from the tested syntax rather than leaving
  an unexplained `esnext` compatibility promise.
- Root and all runtime-neutral subpaths must load without filesystem, process,
  readline, DOM, React, or server-startup dependencies. UI adapters may use the
  DOM; Node and LSP entry points may use Node APIs. Keep Node exports behind a
  Node condition, with their declarations, and no browser fallback that silently
  stubs filesystem behavior. Test both bundler resolution and Node resolution.
- Multi-entry compilation may share private chunks. Do not make the root a
  barrel that eagerly links every adapter. One tarball still installs all its
  files; tree shaking affects loaded bundles, not installation size. Do not set
  `sideEffects: false` globally without auditing initialization and style imports.
- Keep `effect: ^4.1.1` as a required external peer, with repository tests pinned
  to 4.1.1; do not bundle it or add a Forma-specific Effect alias. CLI-only users
  also need that peer resolved; document it in install and execution examples.
  A compatible range is the manifest contract, while 4.1.1 is the initial tested
  baseline. Broader compatibility claims require tests, not just a caret.
- Make `react` and `react-dom` optional peers at `^19.0.0`. They are required
  when importing `/editor/react`, but must not be auto-installed or required
  by language-only and CodeMirror-only consumers. The implementation must test
  missing React in a clean installation, including declaration resolution.
- Initially retain CodeMirror/Lezer and VS Code LSP libraries as ordinary
  external dependencies, unioning the existing adapter requirements. They are
  used by shipped adapters/bins, so optional dependencies that fail silently
  are inappropriate. This increases language-only install weight; record it.
  Verify a single compatible CodeMirror state/view identity when mixed with a
  consumer's extensions, without a speculative peer-dependency redesign.
- Foldkit and React needed by generated applications belong to those
  applications, not unconditional compiler dependencies. Keep generation checks
  in development tooling and document target versions separately. Include
  bundled prelude strings and necessary generated parser assets in the archive.
- No dependency or declaration in the archive may refer to a private Forma
  workspace, an old `@formalang/*` package, a `workspace:` specifier, a sibling
  checkout, or a source-only path. External adapter dependencies are not extra
  public Forma packages.

### Build ownership

Add a small public distribution workspace at `packages/forma`; keep ts, host,
editor and language-server private and retain their internal names initially.
The distribution workspace owns public facades, README, exports, bins, and
version. Existing workspaces continue to own implementations and tests.

Use the existing tsdown toolchain for a multi-entry distribution build, absorbing
the private workspace graphs while keeping Effect/React and declared third-party
dependencies external. Configure workspace inclusion explicitly rather than
relying on workspace dependency externalization defaults. Preserve common modules
and declaration identities across facades. The public manifest contains no
runtime dependency on these private workspaces. Merely marking packages private
and adding a re-export barrel would produce a broken installation.

Retarget the LSP launcher to its packaged server entry and retain CLI shebangs
and executable permissions. Keep server startup out of the library graph.
The website can keep consuming private workspace packages during the build
transition, but must subsequently exercise public facades so private-only imports
do not conceal a broken public product. No flattening or wholesale source move
is required.

## Compatibility and migration

Keep existing registry versions available and immutable. Do not unpublish them,
rename their registry identity, or assume npm redirects old imports. Do not ship
four new-scope wrapper packages: that defeats the one-package goal. Recommend
stopping feature releases under the old scope at cutover, without automatic
deprecation. Any future old-scope maintenance exception or deprecation requires
an explicit maintainer decision and separate authorization.

| Old consumer | Migration |
| --- | --- |
| `@formalang/ts/<path>` | `@forma-language/forma/<path>`, except `editor` → `editor-services` |
| `@formalang/ts` namespace imports | Use explicit new subpaths, e.g. `import * as Reader from "@forma-language/forma/reader"`; new root is intentionally curated |
| `@formalang/host` and its subpaths | `/host` and `/host/<path>` on the new package; default factory also available at root |
| `@formalang/editor/codemirror` or `/react` | `/editor/codemirror` or `/editor/react` on the new package |
| `@formalang/editor` mixed barrel | Split UI imports into the two adapters; analysis factories/types come from `/editor` |
| `@formalang/language-server` | `/language-server` for the Node library; install the new package for its existing bin |
| `@formalang/language-server/server` | Configure and launch `forma-language-server --stdio`, not a side-effectful library import |

For an embedding application, the new installation is
`npm install @forma-language/forma effect@4.1.1`; React editor consumers also
install React/React DOM 19. CLI installation is
`npm install -g @forma-language/forma effect@4.1.1`, followed by the same bin
names. Remove old global bins first to avoid command collisions; record paths
before removal. For one-shot execution, explicitly select the bin and both
packages rather than relying on npm to infer a bin from a two-bin package:
`npm exec --package=@forma-language/forma --package=effect@4.1.1 -- forma help`.
Pin the Forma version in release-specific documentation and reproducible CI.

An npm alias can replace a dependency name, but cannot reproduce the different
old roots and subpaths. Do not advertise it as migration. Migrate each consumer
atomically, remove old package dependencies, regenerate its lock, and check for
duplicate Forma or Effect installations. Mixing scopes can duplicate class,
schema, cache, and session identities even if TypeScript accepts the types.

Registry users also cross already-pending language, numeric, host, LSP, and
Effect changes. Carry the relevant breaking notes from #14 into one consolidated
migration guide; test representative published-version consumers rather than
calling all import rewrites mechanical. Preserve the JSON transport, diagnostic
codes/spans, capability semantics, prelude loading, artifact validation, and
generated program behavior unless a documented pending change already alters
them. Packaging must not silently fix or redefine language semantics.

This npm scope change does not rename Forma source packages, `forma.json`,
vendored sources, module IDs, or contract identities. Those follow RFC 0020,
not the JavaScript registry. It does not rename the repository or website.

## Versioning and release policy

Recommend an initial new-scope version **0.5.0**, explicitly described as a
pre-alpha distribution migration. It avoids suggesting parity with the pending
old-scope 0.4.0 package set; it is not a claim that 0.4.0 was published or that
the scopes share an npm version history. Check availability again before use.

Thereafter one version covers language, host, UI adapters, server, declarations,
CLI and bundled preludes. Public bug fixes are patches; compatible additions are
minors; pre-1.0 breaking changes require a minor plus prominent migration notes,
never an unexplained patch. At 1.0, breaking changes require majors. Experimental
email/Elm APIs may change in minors with explicit notes, not silent patch breaks.
Unexported refactors need no release unless they change the distributed behavior.

Keep host ABI, artifact/wire format, language compatibility, and generated-target
versions distinct from npm version numbers. Capability negotiation remains real;
one package version does not imply every host implements every optional method.
The current host reports `engineVersion: "0.0.0"`: the distribution cutover should
wire the actual build version into that metadata and add an executable check,
without casually changing `hostAbiVersion` or artifact envelope identifiers.

Retain Changesets and the existing gated pack/publish workflow; avoid a second
release system. Only the public facade appears in new changesets. Review and
consolidate pending old-scope changesets into that product's release notes before
privatizing their workspaces; simply ignoring them loses important breaking notes.
Private-workspace changes that affect the public product must still receive a
facade changeset. Adapt CI's coverage check accordingly.

Do not merge #14 unchanged as part of this plan. Recommend superseding its
four-package release plan at cutover rather than publishing an extra old-scope
release just to enable the new one. Keep its generated notes as migration input;
closing/updating the PR is a later authorized action, not something this RFC did.
During implementation, explicitly coordinate the main-push release automation
so intermediate packaging commits cannot accidentally publish the old package set.

The `npm-publish` environment and OIDC workflow are useful existing gates, but
old package trust does not transfer to a new name. At the authorized release
stage, a maintainer must verify org access and the new package's trusted publisher.
Current publishing docs describe a maintainer-authenticated first publication,
then GitHub OIDC setup for `bjacobso/forma`, `release.yml`, `npm-publish`. Recheck
npm's then-current bootstrap options before executing that procedure. Do not add
a long-lived token as an unreviewed shortcut or run workspace-wide first-publish
commands until the publish plan contains exactly the one intended package.

## Release acceptance checks

Extend existing checks rather than replacing them with import-only smoke tests:

1. `pnpm check` stays the semantic baseline, including typechecks, language tests,
   generated-prelude checks, surface goldens and docs. Packaging-only work must
   not update semantic goldens to make a release pass.
2. `pnpm pack:check` must assert one non-private package with the exact new name;
   verify every export/type/bin target, README/license, archive allowlist,
   absence of private/source/workspace references in JS and declarations, and
   no old-scope runtime dependencies. Validate the actual Changesets publish
   plan as well, including private tag/version exclusion.
3. Install only that tarball and declared peers in clean temporary consumers
   outside the workspace. Resolve all inert exports, compile TypeScript samples
   with NodeNext and bundler resolution, check cross-subpath type identity and
   shared Effect resolution. Do not let local workspace links or installing all
   old tarballs mask missing files/dependencies.
4. Exercise parse, a successful and failed check, evaluation and retained session
   state; emit canonical artifacts with source-located failures. Generate a
   representative Effect program and typecheck/execute it against the pinned
   target independently of the compiler install. Keep existing Elm/email target
   checks without treating experimental coverage as a general language guarantee.
5. Run packed `forma help`, `version`, one JSON request, a multi-request daemon
   session, and file check/evaluate success and failure with expected exit codes.
   Verify package help/version identity, offline `verify`, and package-command
   fixtures using local git sources, not production/network writes.
6. Drive the packed LSP bin through stdio initialize, document diagnostics/hover,
   shutdown and exit. Import `/language-server` without starting a connection.
   Importing the root must neither start a server nor read stdin.
7. Bundle root and representative worker/compiler/generator entries for a browser
   without Node polyfills; assert no Node builtin, React, CodeMirror, or LSP
   server graph is pulled into a language-only entry. Measure output bytes and
   compare with the same old-subpath workload, not the entire tarball. Verify
   Node-only entry rejection by browser resolution.
8. Prove a clean language-only install/import/typecheck without React, then
   CodeMirror without React and React adapter with its peers. Test integration
   with consumer CodeMirror extensions. Build/test the playground using the new
   facades; run existing `pnpm website:build`, `pnpm test:site` and visual checks
   for the integration change, with no manual deployment.
9. Record packed/unpacked size and installed dependency tree before/after for
   language-only and editor consumers. Archive the migration smoke results and
   review any increased browser payload, duplicated runtime, or declaration
   leakage before publication. Establish budgets from this baseline rather than
   inventing an unsupported size claim now.

## Practical phased plan

| Phase | Local work and review gate | Exit condition |
| --- | --- | --- |
| 0. Agree on the contract | Review this RFC, name/root/subpath map, 0.5.0 policy and #14 supersession; inventory at least the known external integrations with their owners | Explicit migration agreement; no registry writes |
| 1. Build the distribution | Add `packages/forma`, facades, multi-entry build, declarations and bin packaging; retain existing implementation ownership; test with scratch tarballs before changing release eligibility | Self-contained single archive; root/browser/Node and peer-isolation checks pass |
| 2. Migrate and privatize | Move website/public examples and integration fixtures to the new surface; mark four implementation packages private; consolidate changesets and release notes; update pack-count assertion, release-plan guards, publishing docs, README and `docs/agents.md` | Exactly one publish candidate; no private dependencies leak; full checks and consumer matrix pass |
| 3. Prepare the cutover | Review a new single-package version PR and migration guide; coordinate/supersede #14 and release automation only with authorization; record artifact digest, version and supported target versions | Reviewed release commit and exact archive; no accidental four-package plan |
| 4. Authorized first publication | Maintainer separately approves and performs org/trust bootstrap and first release; verify registry tarball, bins, provenance and fresh consumer installs before recommending adoption | New package works outside the repository; old versions remain available |
| 5. Maintain one product | Changesets bumps only the facade; adapters and implementation remain private; monitor actual consumer migration issues | One install/version remains sufficient; split only against the criteria below |

Phases 1–3 are proposed follow-up implementation, not changes made by this RFC.
Phase 4 contains external actions and must never run merely because this document
is merged. Roll back local preparation before release by reverting the packaging
change. After a published defect, prefer a forward patch; never overwrite or
unpublish an installed version. An authorized dist-tag rollback is a separate
external action and does not undo already-installed versions.

## When another public package is justified

Require a concrete consumer need and evidence that a subpath/private module is
insufficient. A follow-up RFC must identify an owner, independent contract,
compatibility matrix, migration path, release/check cost and measured benefit.
At least one of these needs must hold:

- **Independent runtime distribution:** generated applications demonstrably need
  a small shared Forma runtime at execution time without the compiler, and
  tree-shaking/subpaths cannot solve deployment or installation constraints.
  Today's generated Effect/Foldkit modules do not establish that need.
- **Incompatible platform/install requirements:** a native, WASM, binary, or
  platform-specific adapter forces downloads/install scripts or mandatory
  dependencies on unrelated consumers that cannot reasonably remain isolated.
- **Material installation cost:** real consumers exceed an agreed tarball or
  installed-dependency budget because of an optional subsystem (most plausibly
  editor/LSP), even though browser graphs are isolated. Record measurements and
  an attempted simpler dependency/subpath remedy before a split.
- **Independent compatibility/lifecycle:** an adapter has real consumers needing
  a different release cadence or incompatible framework peer range, and one
  product release can no longer support them reasonably. The second package
  must have a narrow dependency on a supported contract, not private compiler
  paths or an accidental duplicate engine.

Directory count, another generator target, different output files, or a desire
for a smaller browser bundle alone is not enough. Neither is hypothetical future
complexity. Revisit splitting only when these facts exist.

## Alternatives and outstanding approval points

Renaming all four packages to the new scope preserves today's installation
complexity without evidence that consumers need it. Publishing only the engine
and withdrawing editor/LSP distribution reduces functionality. One mega-barrel
or concatenated bundle weakens environment boundaries. Compatibility wrappers
add permanent release units; physical source flattening adds churn unrelated
to the npm contract. These are not recommended.

The intentional costs are retaining a broad advanced API during migration and
installing non-React adapter dependencies for language-only users. The proposed
checks make those costs visible; neither is concealed by the phrase "one package."

Approval is still needed for the proposed public name/surface and migration
policy. Org access, name eligibility, first-publish authentication and trusted
publisher settings are unverified. External consumer inventory and measured
package/browser size baselines belong to implementation, not assertions of this
planning RFC. The document proposes a product boundary; it does not establish
1.0 stability or implement any planned language feature.

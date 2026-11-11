# Publishing Forma

The repository is prepared for one public npm package,
`@forma-language/forma` at version 0.5.0. It has not been published.
The engine, host, editor and language-server workspaces keep their internal
`@formalang/*` names and are private. Existing registry releases remain
available; no deprecations or registry changes are part of this preparation.

## Release preparation

Only `@forma-language/forma` belongs in changesets, including when an
implementation workspace changes distributed behavior. Pending old-scope notes
have been retargeted to the facade with their breaking notes preserved.
Pre-1.0 breaking changes require a minor and explicit migration notes.
Do not merge the old four-package version PR #14 unchanged.

Run `pnpm release:check` before release review. It runs the semantic checks and
packs the single distribution, checks its archive and publish eligibility,
installs it offline in a clean consumer, imports the exports, checks declaration
resolution and browser boundaries, and exercises both executables.
The machine must have the dependency closure in its pnpm store.

Changesets retains the version-PR and gated pack/publish workflow. Version PRs
opened with the workflow token do not automatically run CI; check out the
revision and run the release checks before merging. Private workspaces are
excluded from versioning and tags. Release automation must never publish an
intermediate four-package plan.

## Consumer migration

After publication, install `@forma-language/forma` and `effect@4.1.1`.
Effect is a required external peer (`^4.1.1`); 4.1.1 is the tested baseline.
React and React DOM 19 are optional peers needed only for `/editor/react`.
CodeMirror/Lezer and LSP dependencies are installed even for language-only use.

Old engine subpaths move to the new package, with `/editor` renamed to
`/editor-services`. The new root is curated; replace old namespace-root imports
with explicit subpaths. Host imports move to `/host` and `/host/<path>`.
The mixed editor root splits into UI-free `/editor`, `/editor/codemirror` and
`/editor/react`. Use `/language-server` for the Node library and the
`forma-language-server --stdio` bin for startup. Source files use `.lisp`;
`forma.json` and `forma.lock` keep their names. Review the consolidated pending
notes for language, host, numeric and Effect changes as well as import rewrites.

Local installs expose `pnpm exec forma help`; global installs require both the
Forma package and Effect on the global installation. One-shot execution after
publication selects the bin explicitly:

```sh
npm exec --package=@forma-language/forma@0.5.0 --package=effect@4.1.1 -- forma help
```

## First publication gate

Publication requires separate maintainer authorization. Verify scope ownership,
name availability and npm's current first-publication procedure before doing it.
The existing old-scope trusted publishers do not transfer to the new name.
Configure GitHub OIDC for `bjacobso/forma`, workflow `release.yml`, environment
`npm-publish`, after the authorized bootstrap. Do not introduce a persistent
npm token. Do not publish the old workspaces, merge PR #14, change npm settings,
or deprecate packages as part of local preparation.

See [RFC 0025](https://github.com/bjacobso/forma/blob/main/docs/rfcs/0025-single-npm-distribution.md)
for the complete distribution contract and release acceptance matrix.

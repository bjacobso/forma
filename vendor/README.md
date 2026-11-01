# Vendored Foldworks primitives

Forma installs these committed package archives with `pnpm install
--frozen-lockfile`. No sibling repository, build, link hook, or npm publication
is needed. `pnpm-workspace.yaml` overrides every direct and transitive
`@foldworks/*` dependency used by the workbench with a repository-relative file.
`manifest.json` records package versions, source paths, the full Git revision,
and SHA-256 hashes. Each archive contains upstream built exports, README, and
MIT license, packed by pnpm without source changes.

The pinned source is Foldworks
[`7b60eb4342773cbd532f27ebcfd87ca9d7555356`](https://github.com/bjacobso/foldworks/commit/7b60eb4342773cbd532f27ebcfd87ca9d7555356),
`main` at the time of refresh. It uses Effect 4.1.1 and Foldkit 0.170.0,
matching Forma. This replaces the former CI pin `695695e` and its Foldworks
peer exceptions. Package version numbers still predate the intended releases
in the workbench manifests; the overrides deliberately select source snapshots.

## Refresh from a local checkout

Use Node.js 24 and pnpm 10.20. Select the current Foldworks `main` deliberately
and keep its source clean; the refresh refuses a dirty checkout. It builds
only the required packages and their dependency graph, then uses upstream
`pnpm pack` (including its prepack build). It does not install or modify
Foldworks source, skip its build checks, or patch packages. If upstream cannot
build or pack, fix it upstream before refreshing Forma.

```sh
# In your local Foldworks checkout, select the desired main revision, then:
pnpm install --frozen-lockfile
# In Forma:
FOLDWORKS_DIR=../foldworks pnpm vendor:foldworks
pnpm install --no-frozen-lockfile
pnpm check
pnpm test:e2e:workbench
pnpm website:build
pnpm test:site
pnpm --filter @formalang/ts build
```

Review and commit the tarballs, manifest, generated override block, and complete
lockfile together. The refresh validates exported files, licenses, portable
runtime dependency specifiers, and the vendored Foldworks dependency closure
before replacing the existing archives. It records a clean full source revision
and removes obsolete Foldworks archives. Install never runs the refresh script.

For local development, commit your Foldworks changes in that checkout, refresh,
install, and run `pnpm workbench`. Repeat after further upstream changes; this
uses snapshots of package exports, without a live source link. To discard an
experiment, restore `vendor/`, `pnpm-workspace.yaml`, and `pnpm-lock.yaml` from
Git and run `pnpm install --frozen-lockfile` again. Older workspaces using the
retired link script should first remove their generated `.pnpmfile.cjs` and
`.foldworks/` directory.
